"""The der-control-fastlib dialect (``derhost``): its REST config store, RPC call endpoint and JWT login.

Routes: ``POST /authenticate`` (username, password -> access and refresh tokens), ``GET /config-store/list``,
``GET|PUT|DELETE /config-store/<agent>/<name>``, ``POST /api/rpc/call`` and ``GET /connections`` for the connected
agents. fastlib has no agent lifecycle (containers are the lifecycle), so ``set_running`` and ``set_enabled`` raise.
The exact request bodies of the RPC and list endpoints are verified against a running fastlib before this dialect is
used; until then it is the shape of the interface, not a tested client.
"""
from __future__ import annotations

from typing import Any

import httpx

from .base import AgentInfo, AuthError, ConfigEntry, PlatformError, CONFIG_TYPES


class DerhostClient:
    dialect = 'derhost'

    def __init__(self, settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.platform = settings.platform_name or 'fastlib'
        self._http = httpx.AsyncClient(base_url=settings.platform_url.rstrip('/'), verify=settings.verify_tls,
                                       timeout=settings.request_timeout, transport=transport)
        self.access_token: str | None = None
        self.username: str | None = None

    async def login(self, username: str, password: str) -> None:
        response = await self._http.post('/authenticate', json={'username': username, 'password': password})
        if response.status_code in (401, 403):
            raise AuthError('Wrong username or password')
        if response.status_code >= 400:
            raise PlatformError(f'login: {response.status_code}', response.status_code)
        self.access_token = response.json().get('access_token')
        self.username = username

    async def close(self) -> None:
        await self._http.aclose()

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        if not self.access_token:
            raise AuthError('Not logged in')
        headers = dict(kwargs.pop('headers', {}) or {})
        headers['Authorization'] = f'Bearer {self.access_token}'
        try:
            response = await self._http.request(method, path, headers=headers, **kwargs)
        except httpx.HTTPError as e:
            raise PlatformError(f'Platform unreachable: {e}', 502) from e
        if response.status_code in (401, 403):
            raise AuthError()
        if response.status_code >= 400:
            raise PlatformError(f'{method} {path}: {response.status_code} {response.text[:200]}', response.status_code)
        return response

    async def list_platforms(self) -> list[str]:
        return [self.platform]

    async def list_agents(self) -> list[AgentInfo]:
        response = await self._request('GET', '/connections')
        body = response.json()
        connections = body.get('connections', body) if isinstance(body, dict) else body
        agents = []
        for item in connections:
            identity = item.get('identity') if isinstance(item, dict) else str(item)
            agents.append(AgentInfo(identity=identity, running=True, enabled=None))
        return agents

    async def set_running(self, identity: str, running: bool, restart: bool = False) -> None:
        raise PlatformError('fastlib has no agent lifecycle; start or stop the container', 501)

    async def set_enabled(self, identity: str, enabled: bool, priority: str = '50') -> None:
        raise PlatformError('fastlib has no agent lifecycle; start or stop the container', 501)

    async def list_stores(self) -> list[str]:
        response = await self._request('GET', '/config-store/list')
        body = response.json()
        return sorted({(e.get('agent_id') if isinstance(e, dict) else str(e).split('/')[0]) for e in (body if isinstance(body, list) else body.get('configs', []))})

    async def list_configs(self, identity: str) -> list[str]:
        response = await self._request('GET', '/config-store/list')
        body = response.json()
        entries = body if isinstance(body, list) else body.get('configs', [])
        names = []
        for e in entries:
            if isinstance(e, dict) and e.get('agent_id') == identity:
                names.append(e.get('config_name'))
            elif isinstance(e, str) and e.startswith(identity + '/'):
                names.append(e[len(identity) + 1:])
        return names

    async def get_config(self, identity: str, name: str, known: ConfigEntry | None = None) -> ConfigEntry:
        response = await self._request('GET', f'/config-store/{identity}/{name}')
        declared = response.headers.get('Config-Type')
        return ConfigEntry.from_text(identity, name, response.text, declared, response.headers.get('ETag'),
                                     response.headers.get('Last-Modified'))

    async def put_config(self, identity: str, name: str, kind: str, text: str) -> None:
        if kind not in CONFIG_TYPES:
            raise PlatformError(f'unknown config type {kind}', 400)
        content_type = {'json': 'application/json', 'csv': 'text/csv', 'raw': 'text/plain'}[kind]
        await self._request('PUT', f'/config-store/{identity}/{name}', content=text.encode('utf-8'),
                            headers={'Content-Type': content_type})

    async def delete_config(self, identity: str, name: str) -> None:
        await self._request('DELETE', f'/config-store/{identity}/{name}')

    async def rpc(self, identity: str, method: str, *args, **kwargs) -> Any:
        response = await self._request('POST', '/api/rpc/call', json={'agent': identity, 'method': method, 'args': list(args), 'kwargs': kwargs})
        body = response.json()
        return body.get('result', body) if isinstance(body, dict) else body

    def capabilities(self) -> dict:
        return {'dialect': self.dialect, 'lifecycle': False, 'metadata_headers': False, 'platform': self.platform,
                'user': self.username}
