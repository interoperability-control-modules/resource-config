"""A small VUI look-alike: enough of volttron-lib-web's REST API (extra_fixes shapes) for the client and the UI to be
exercised without a platform. Served in-process through httpx.ASGITransport."""
from __future__ import annotations

import csv
import io
import json

from fastapi import FastAPI, Header, HTTPException, Request, Response

USER, PASSWORD = 'admin', 'secret'
PLATFORM = 'site1'

DEVICE = {'driver_type': 'modbus', 'driver_role': 'client', 'registry_config': 'config://registry_configs/sunspec_client.csv',
          'interval': 2, 'publish_depth_first_multi': True,
          'driver_config': {'device_address': '127.0.0.1', 'port': 15020, 'unit_id': 1, 'transport_protocol': 'tcp'}}
REGISTRY = 'Point Name,Address,Data Type,Table,Writable,Data Source,Units\n701_W,40084,int16,holding,FALSE,short_poll,W\n701_W_SF,40092,sunssf,holding,FALSE,poll_once,\n'
SERVICE = {'mappings': [
    {'uai': ['matrix', 'SunSpec', 'client'], 'resource_type': 'canonical',
     'resource': {'data_format': 'sunspec_client', 'owner': 'platform.driver', 'publication_topic': 'devices/matrix/SunSpec/client/multi',
                  'rpc_topic': 'devices/matrix/SunSpec/client', 'parameters': {'mrid': '7d1a2b3c-0000-4000-8000-000000000001', 'name': 'PV inverter 1'}}},
    {'uai': ['openfmb', 'solarmodule', 'SolarReadingProfile', '7d1a2b3c-0000-4000-8000-000000000001'], 'resource_type': 'alias',
     'resource': {'data_format': 'openfmb.solar.reading', 'owner': 'platform.driver', 'references': ['matrix', 'SunSpec', 'client'], 'encoding': 'protobuf', 'edition': '2.2'}},
    {'uai': ['openfmb', 'solarmodule', 'SolarControlProfile', '7d1a2b3c-0000-4000-8000-000000000001'], 'resource_type': 'alias',
     'resource': {'data_format': 'openfmb.solar.control', 'owner': 'platform.driver', 'references': ['matrix', 'SunSpec', 'client'], 'encoding': 'protobuf', 'edition': '2.2'}},
    {'uai': ['matrix', 'DNP3', 'served'], 'resource_type': 'canonical',
     'resource': {'data_format': 'dnp3_served', 'owner': 'platform.driver', 'publication_topic': 'devices/matrix/DNP3/served/all', 'rpc_topic': 'devices/matrix/DNP3/served'}},
], 'formats': {'sunspec_client': {'hub': False, 'scaling': 'transform', 'fields': ['701_W', '701_W_SF']},
               'dnp3_served': {'hub': False, 'fields': ['AI_1']}},
    'transforms': [{'input_format': 'sunspec_client', 'output_format': 'sunspec', 'pattern': {'#': 'transform(device_values())'}}]}
BRIDGE = {'bridges': [
    {'source': ['matrix', 'SunSpec', 'client'], 'target': ['matrix', 'DNP3', 'served']},
    {'source': {'uai': ['openfmb', 'solarmodule', 'SolarControlProfile', '7d1a2b3c-0000-4000-8000-000000000001'], 'bus': True}, 'target': ['matrix', 'SunSpec', 'client']}]}
BUS = {'bus_type': 'mqtt', 'adapters': [{'name': 'site_broker', 'host': '127.0.0.1', 'port': 1883,
                                        'local_subscriptions': ['openfmb/solarmodule/SolarReadingProfile/7d1a2b3c-0000-4000-8000-000000000001'],
                                        'remote_subscriptions': ['openfmb/solarmodule/SolarControlProfile/7d1a2b3c-0000-4000-8000-000000000001']}]}
RTC = {'hub_topic': 'matrix/RTC/control', 'status_topic': 'devices/matrix/SunSpec/client'}


def initial_store() -> dict[str, dict[str, tuple[str, str]]]:
    return {
        'platform.driver': {'devices/matrix/SunSpec/client': ('json', json.dumps(DEVICE)),
                            'registry_configs/sunspec_client.csv': ('csv', REGISTRY),
                            'devices/matrix/DNP3/served': ('json', json.dumps({'driver_type': 'dnp3', 'driver_role': 'outstation', 'publish_depth_first_all': True,
                                                                                'registry_config': 'config://registry_configs/dnp3_served.csv'})),
                            'registry_configs/dnp3_served.csv': ('csv', 'Point Name,Index,Data Source\nAI_1,1,server\n')},
        'platform.presentation': {'config': ('json', json.dumps(SERVICE))},
        'platform.resource_bridge': {'config': ('json', json.dumps(BRIDGE))},
        'platform.bus_adapter': {'config': ('json', json.dumps(BUS))},
        'der.rtc': {'config': ('json', json.dumps(RTC))},
    }


AGENTS = {
    'platform.driver': {'uuid': 'u1', 'name': 'volttron-platform-driver-2.0.0rc8', 'tag': 'driver', 'priority': '50', 'running': True, 'enabled': True, 'pid': 100, 'exit_code': None},
    'platform.presentation': {'uuid': 'u2', 'name': 'interoperability-service-0.2', 'tag': None, 'priority': '50', 'running': True, 'enabled': True, 'pid': 101, 'exit_code': None},
    'platform.resource_bridge': {'uuid': 'u3', 'name': 'volttron-resource-bridge-2.0.0rc0', 'tag': None, 'priority': None, 'running': False, 'enabled': False, 'pid': None, 'exit_code': 0},
    'platform.bus_adapter': {'uuid': 'u4', 'name': 'volttron-message-bus-adapter-2.0.0rc0', 'tag': None, 'priority': '50', 'running': True, 'enabled': True, 'pid': 103, 'exit_code': None},
    'der.rtc': {'uuid': 'u5', 'name': 'volttron-realtime-control-0.2', 'tag': 'rtc', 'priority': '50', 'running': True, 'enabled': True, 'pid': 104, 'exit_code': None},
}


def make_fake_vui() -> FastAPI:
    app = FastAPI()
    app.state.store = initial_store()
    app.state.agents = {k: dict(v) for k, v in AGENTS.items()}
    app.state.rpc_calls = []
    app.state.access_tokens = {'access-1'}
    app.state.refresh_tokens = {'refresh-1'}
    app.state.rotations = 0

    def check(authorization: str | None):
        token = (authorization or '').removeprefix('Bearer ').removeprefix('BEARER ').strip()
        if token not in app.state.access_tokens:
            raise HTTPException(401, {'error': 'Not Authorized'})

    def links(path: str, names):
        return {'links': {n: f'{path}/{n}' for n in names}}

    @app.post('/authenticate')
    async def authenticate(request: Request):
        body = await request.json()
        if body.get('username') != USER or body.get('password') != PASSWORD:
            raise HTTPException(401, {'error': 'Not Authorized'})
        return {'refresh_token': 'refresh-1', 'access_token': 'access-1'}

    @app.put('/authenticate')
    async def renew(authorization: str | None = Header(default=None)):
        token = (authorization or '').removeprefix('Bearer ').strip()
        if token not in app.state.refresh_tokens:
            raise HTTPException(401, {'error': 'Not Authorized'})
        app.state.rotations += 1
        new = f'access-{app.state.rotations + 1}'
        app.state.access_tokens.add(new)
        return {'access_token': new}

    @app.get('/vui/platforms')
    async def platforms(authorization: str | None = Header(default=None)):
        check(authorization)
        return links('/vui/platforms', [PLATFORM])

    @app.get(f'/vui/platforms/{PLATFORM}/agents')
    async def agents(request: Request, authorization: str | None = Header(default=None)):
        check(authorization)
        names = list(app.state.agents)
        if request.query_params.get('include-hidden') == 'true':
            names += ['platform.web', 'config.store']
        return links(f'/vui/platforms/{PLATFORM}/agents', names)

    @app.get(f'/vui/platforms/{PLATFORM}/agents/-/status')
    async def status(authorization: str | None = Header(default=None)):
        check(authorization)
        return app.state.agents

    @app.get(f'/vui/platforms/{PLATFORM}/agents/-/health')
    async def health(authorization: str | None = Header(default=None)):
        check(authorization)
        return {'platform.driver': {'status': 'GOOD', 'context': 'polling'}}

    @app.api_route(f'/vui/platforms/{PLATFORM}/agents/{{identity}}/running', methods=['GET', 'PUT', 'DELETE'])
    async def running(identity: str, request: Request, authorization: str | None = Header(default=None)):
        check(authorization)
        agent = app.state.agents.get(identity)
        if agent is None:
            raise HTTPException(400, {'error': f'Agent "{identity}" not found.'})
        if request.method == 'GET':
            return {'running': agent['running']}
        agent['running'] = request.method == 'PUT'
        return Response(status_code=204)

    @app.api_route(f'/vui/platforms/{PLATFORM}/agents/{{identity}}/enabled', methods=['GET', 'PUT', 'DELETE'])
    async def enabled(identity: str, request: Request, authorization: str | None = Header(default=None)):
        check(authorization)
        agent = app.state.agents[identity]
        if request.method == 'GET':
            return {'enabled': agent['enabled'], 'priority': agent['priority']}
        agent['enabled'] = request.method == 'PUT'
        agent['priority'] = request.query_params.get('priority', '50') if request.method == 'PUT' else None
        return Response(status_code=204)

    @app.get(f'/vui/platforms/{PLATFORM}/agents/-/configs')
    async def stores(authorization: str | None = Header(default=None)):
        check(authorization)
        return list(app.state.store)

    @app.get(f'/vui/platforms/{PLATFORM}/agents/{{identity}}/configs')
    async def configs(identity: str, authorization: str | None = Header(default=None)):
        check(authorization)
        if identity not in app.state.store:
            raise HTTPException(400, {'error': f'No configuration store for {identity}'})
        return links(f'/vui/platforms/{PLATFORM}/agents/{identity}/configs', list(app.state.store[identity]))

    @app.api_route(f'/vui/platforms/{PLATFORM}/agents/{{identity}}/configs/{{name:path}}', methods=['GET', 'PUT', 'DELETE'])
    async def config(identity: str, name: str, request: Request, authorization: str | None = Header(default=None)):
        check(authorization)
        store = app.state.store.setdefault(identity, {})
        if request.method == 'GET':
            if name not in store:
                raise HTTPException(400, {'error': f'No configuration file "{name}"'})
            kind, text = store[name]
            accept = request.headers.get('accept', 'application/json')
            if 'text/plain' in accept:
                return Response(text, media_type='text/plain')
            if 'text/csv' in accept:
                if kind != 'csv':
                    raise HTTPException(406, {'Error': 'not csv'})
                return Response(text, media_type='text/csv')
            if kind == 'json':
                return json.loads(text)
            if kind == 'csv':
                return list(csv.DictReader(io.StringIO(text)))
            return text
        if request.method == 'PUT':
            ctype = request.headers.get('content-type', '')
            body = (await request.body()).decode('utf-8')
            kind = 'json' if 'json' in ctype else 'csv' if 'csv' in ctype else 'raw'
            if kind == 'json':
                json.loads(body)
            store[name] = (kind, body)
            return Response(status_code=204)
        store.pop(name, None)
        return Response(status_code=204)

    @app.post(f'/vui/platforms/{PLATFORM}/agents/{{identity}}/rpc/{{method}}')
    async def rpc(identity: str, method: str, request: Request, authorization: str | None = Header(default=None)):
        check(authorization)
        body = await request.json()
        app.state.rpc_calls.append((identity, method, body))
        if identity in ('config.store', 'platform.driver', 'platform.web', 'platform.auth'):
            raise HTTPException(403, {'error': 'refused by the rpc proxy policy'})
        if method == 'resolve':
            uai = body['args'][0] if body.get('args') else []
            return {'canonical_uai': ['matrix', 'SunSpec', 'client'], 'alias_uais': [uai] if uai[:1] == ['openfmb'] else [],
                    'data_format': 'sunspec_client', 'target_format': body['args'][1] if len(body.get('args', [])) > 1 else None,
                    'path': ['sunspec_client', 'sunspec', '61850', 'openfmb.solar', 'openfmb.solar.reading'], 'retention': 0.58,
                    'parameters': {'mrid': '7d1a2b3c-0000-4000-8000-000000000001'}, 'encoding': 'protobuf'}
        return {'echo': {'identity': identity, 'method': method, 'body': body}}

    return app
