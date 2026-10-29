"""The VOLTTRON web service dialect: the VUI REST API of volttron-lib-web (the extra_fixes line and later).

Routes used (all under ``/vui/platforms/<platform>``): ``/agents`` with ``agent-state`` and ``include-hidden``,
``/agents/-/status``, ``/agents/-/health``, ``/agents/<id>/running`` (GET, PUT, DELETE), ``/agents/<id>/enabled``
(PUT with ``priority``, DELETE), ``/agents/<id>/configs`` (GET list, POST create), ``/agents/<id>/configs/<name>``
(GET with Accept negotiation, PUT, DELETE), ``/agents/-/configs`` (the identities with a store) and
``/agents/<id>/rpc/<method>`` (POST ``{"args": [...], **kwargs}``). Login is ``POST /authenticate`` for a refresh and
an access token; ``PUT /authenticate`` with the refresh token renews the access token.

When the web service sends the metadata headers of the config-metadata plan (``ETag``, ``Last-Modified``,
``Config-Type``) they are used; otherwise the stored text is fetched and typed locally.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from .base import AgentInfo, AuthError, ConfigEntry, PlatformError

_log = logging.getLogger(__name__)

CONTENT_TYPES = {'json': 'application/json', 'csv': 'text/csv', 'raw': 'text/plain'}


class VUIClient:
    dialect = 'vui'

    def __init__(self, settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.platform: str | None = settings.platform_name
        self._http = httpx.AsyncClient(base_url=settings.platform_url.rstrip('/'), verify=settings.verify_tls,
                                       timeout=settings.request_timeout, transport=transport)
        self.access_token: str | None = None
        self.refresh_token: str | None = None
        self.username: str | None = None
        self._metadata_headers_seen = False

    # ---------------------------------------------------------------- session
    async def login(self, username: str, password: str) -> None:
        response = await self._http.post('/authenticate', json={'username': username, 'password': password})
        if response.status_code == 401:
            raise AuthError('Wrong username or password')
        self._raise_for(response, 'login')
        body = response.json()
        self.access_token, self.refresh_token = body.get('access_token'), body.get('refresh_token')
        if not self.access_token:
            raise PlatformError('The web service returned no access token', 502)
        self.username = username
        if not self.platform:
            platforms = await self.list_platforms()
            if not platforms:
                raise PlatformError('The web service lists no platform', 502)
            self.platform = platforms[0]

    async def _renew(self) -> bool:
        if not self.refresh_token:
            return False
        response = await self._http.put('/authenticate', headers={'Authorization': f'Bearer {self.refresh_token}'},
                                        json={'current_access_token': self.access_token})
        if response.status_code != 200:
            return False
        self.access_token = response.json().get('access_token')
        return bool(self.access_token)

    async def close(self) -> None:
        await self._http.aclose()

    # ---------------------------------------------------------------- requests
    async def _request(self, method: str, path: str, *, retry: bool = True, **kwargs) -> httpx.Response:
        if not self.access_token:
            raise AuthError('Not logged in')
        headers = dict(kwargs.pop('headers', {}) or {})
        headers['Authorization'] = f'Bearer {self.access_token}'
        try:
            response = await self._http.request(method, path, headers=headers, **kwargs)
        except httpx.HTTPError as e:
            raise PlatformError(f'Platform unreachable: {e}', 502) from e
        if response.status_code == 401 and retry and await self._renew():
            return await self._request(method, path, retry=False, headers=kwargs.pop('headers', None) or {}, **kwargs)
        return response

    def _p(self, path: str) -> str:
        return f'/vui/platforms/{self.platform}{path}'

    @staticmethod
    def _raise_for(response: httpx.Response, what: str) -> None:
        if response.status_code in (401, 403):
            raise AuthError(_error_text(response) or f'{what}: not authorized')
        if response.status_code >= 400:
            raise PlatformError(f'{what}: {_error_text(response) or response.status_code}', response.status_code)

    # ---------------------------------------------------------------- platform and agents
    async def list_platforms(self) -> list[str]:
        response = await self._request('GET', '/vui/platforms')
        self._raise_for(response, 'list platforms')
        return list(response.json().get('links', {}))

    async def list_agents(self) -> list[AgentInfo]:
        installed = await self._request('GET', self._p('/agents'), params={'agent-state': 'installed', 'include-hidden': 'true'})
        self._raise_for(installed, 'list agents')
        identities = list(installed.json().get('links', {}))
        status = await self._request('GET', self._p('/agents/-/status'))
        statuses = status.json() if status.status_code == 200 else {}
        health_response = await self._request('GET', self._p('/agents/-/health'))
        health = health_response.json() if health_response.status_code == 200 else {}
        agents = []
        for identity in identities:
            s = statuses.get(identity) or {}
            agents.append(AgentInfo(identity=identity, name=s.get('name'), uuid=s.get('uuid'), tag=s.get('tag'),
                                    priority=s.get('priority'), running=s.get('running'), enabled=s.get('enabled'),
                                    pid=s.get('pid'), exit_code=s.get('exit_code'), hidden=identity not in statuses,
                                    health=health.get(identity) or {}))
        return agents

    async def set_running(self, identity: str, running: bool, restart: bool = False) -> None:
        if running:
            response = await self._request('PUT', self._p(f'/agents/{identity}/running'), params={'restart': str(restart).lower()})
        else:
            response = await self._request('DELETE', self._p(f'/agents/{identity}/running'))
        self._raise_for(response, f'{"start" if running else "stop"} {identity}')

    async def set_enabled(self, identity: str, enabled: bool, priority: str = '50') -> None:
        if enabled:
            response = await self._request('PUT', self._p(f'/agents/{identity}/enabled'), params={'priority': priority})
        else:
            response = await self._request('DELETE', self._p(f'/agents/{identity}/enabled'))
        self._raise_for(response, f'{"enable" if enabled else "disable"} {identity}')

    # ---------------------------------------------------------------- config store
    async def list_stores(self) -> list[str]:
        response = await self._request('GET', self._p('/agents/-/configs'))
        self._raise_for(response, 'list stores')
        body = response.json()
        return list(body.get('links', body)) if isinstance(body, dict) else list(body)

    async def list_configs(self, identity: str) -> list[str]:
        response = await self._request('GET', self._p(f'/agents/{identity}/configs'))
        if response.status_code == 400 and 'No configuration' in (_error_text(response) or ''):
            return []
        self._raise_for(response, f'list configs of {identity}')
        return list(response.json().get('links', {}))

    async def get_config(self, identity: str, name: str) -> ConfigEntry:
        """Fetch the stored text (``Accept: text/plain`` returns the text of any entry) and type it locally unless the
        web service declares the type and validator in its headers."""
        response = await self._request('GET', self._p(f'/agents/{identity}/configs/{name}'), headers={'Accept': 'text/plain'})
        self._raise_for(response, f'get {identity}/{name}')
        declared = response.headers.get('Config-Type') or response.headers.get('X-Config-Type')
        etag, modified = response.headers.get('ETag'), response.headers.get('Last-Modified')
        self._metadata_headers_seen = self._metadata_headers_seen or bool(declared or etag)
        return ConfigEntry.from_text(identity, name, response.text, declared, etag, modified)

    async def put_config(self, identity: str, name: str, kind: str, text: str) -> None:
        response = await self._request('PUT', self._p(f'/agents/{identity}/configs/{name}'), content=text.encode('utf-8'),
                                       headers={'Content-Type': CONTENT_TYPES[kind]})
        self._raise_for(response, f'store {identity}/{name}')

    async def delete_config(self, identity: str, name: str) -> None:
        response = await self._request('DELETE', self._p(f'/agents/{identity}/configs/{name}'))
        self._raise_for(response, f'delete {identity}/{name}')

    # ---------------------------------------------------------------- rpc
    async def rpc(self, identity: str, method: str, *args, **kwargs) -> Any:
        body: dict = {'args': list(args), **kwargs}
        response = await self._request('POST', self._p(f'/agents/{identity}/rpc/{method}'), json=body)
        self._raise_for(response, f'{identity}.{method}')
        return response.json()

    def capabilities(self) -> dict:
        return {'dialect': self.dialect, 'lifecycle': True, 'metadata_headers': self._metadata_headers_seen,
                'platform': self.platform, 'user': self.username}


def _error_text(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return response.text[:200] or None
    if isinstance(body, dict):
        return str(body.get('error') or body.get('Error') or body)
    return str(body)
