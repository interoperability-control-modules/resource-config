"""A small VUI look-alike: enough of volttron-lib-web's REST API (extra_fixes shapes) for the client and the UI to be
exercised without a platform. Served in-process through httpx.ASGITransport."""
from __future__ import annotations

import csv
import fnmatch
import io
import json
import re

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
                            'registry_configs/dnp3_served.csv': ('csv', 'Volttron Point Name,Index,Data Source\nAI_1,1,server\n')},
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
    app.state.metadata = True          # the web service sends ETag/Config-Type and answers metadata=true (extra_fixes)
    app.state.not_modified = 0

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

    def selection(request: Request) -> list[str]:
        # Like the real VUI: the wildcard identity requires a tag or regex filter.
        tag, regex = request.query_params.get('tag'), request.query_params.get('regex')
        if tag is None and regex is None:
            raise HTTPException(400, {'error': "The wildcard identity '-' requires a tag or regex query parameter."})
        return [i for i, a in app.state.agents.items() if (regex is None or re.search(regex, i)) and (tag is None or fnmatch.fnmatchcase(str(a.get('tag')), tag))]

    @app.get(f'/vui/platforms/{PLATFORM}/agents/-/status')
    async def status(request: Request, authorization: str | None = Header(default=None)):
        check(authorization)
        return {i: app.state.agents[i] for i in selection(request)}

    @app.get(f'/vui/platforms/{PLATFORM}/agents/-/health')
    async def health(request: Request, authorization: str | None = Header(default=None)):
        check(authorization)
        return {i: {'status': 'GOOD', 'context': 'polling'} for i in selection(request) if i == 'platform.driver'}

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

    def etag_of(kind: str, text: str) -> str:
        import hashlib
        return '"' + hashlib.sha256(f'{kind}\n{text}'.encode()).hexdigest()[:32] + '"'

    @app.get(f'/vui/platforms/{PLATFORM}/agents/{{identity}}/configs')
    async def configs(identity: str, request: Request, authorization: str | None = Header(default=None)):
        check(authorization)
        if identity not in app.state.store:
            raise HTTPException(400, {'error': f'No configuration store for {identity}'})
        body = links(f'/vui/platforms/{PLATFORM}/agents/{identity}/configs', list(app.state.store[identity]))
        if request.query_params.get('metadata') == 'true' and app.state.metadata:
            body['configs'] = {name: {'type': kind, 'modified': None, 'etag': etag_of(kind, text), 'size': len(text), 'link': body['links'][name]}
                               for name, (kind, text) in app.state.store[identity].items()}
        return body

    @app.api_route(f'/vui/platforms/{PLATFORM}/agents/{{identity}}/configs/{{name:path}}', methods=['GET', 'PUT', 'DELETE'])
    async def config(identity: str, name: str, request: Request, authorization: str | None = Header(default=None)):
        check(authorization)
        store = app.state.store.setdefault(identity, {})
        if request.method == 'GET':
            if name not in store:
                raise HTTPException(400, {'error': f'No configuration file "{name}"'})
            kind, text = store[name]
            headers = {'ETag': etag_of(kind, text), 'Config-Type': kind} if app.state.metadata else {}
            if app.state.metadata and request.headers.get('if-none-match') == headers['ETag']:
                app.state.not_modified += 1
                return Response(status_code=304, headers=headers)
            accept = request.headers.get('accept', 'application/json')
            if 'text/plain' in accept:
                return Response(text, media_type='text/plain', headers=headers)
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
        if method == 'chain_report':
            return {'path': ['sunspec_client', 'sunspec', '61850', 'openfmb.solar', 'openfmb.solar.reading'], 'retention': 0.58,
                    'hops': [{'input': 'sunspec_client', 'output': 'sunspec', 'in': 112, 'kept': 104, 'lost': 8, 'lost_fields': ['701_ID'], 'retention': 0.93}],
                    'targets': [{'target': 'readingMMXU.W.net.cVal.mag', 'source': 'W', 'fidelity': 1.0, 'functions': []}],
                    'unmapped_targets': [{'target': 'readingMMXU.Hz.mag', 'lost_at': '61850 → openfmb.solar'}]}
        if method == 'list_formats':
            return {'61850': {'hub': True, 'declared': False, 'proto': None, 'scaling': None, 'universe': 400, 'edges_out': ['sunspec'], 'edges_in': ['sunspec']},
                    'sunspec_client': {'hub': False, 'declared': True, 'proto': None, 'scaling': 'transform', 'universe': 2, 'edges_out': ['sunspec'], 'edges_in': []}}
        if method == 'list_transforms':
            return [{'input': 'sunspec', 'output': '61850', 'origin': 'bundled', 'retention': 0.7, 'lossiness_override': None, 'fields': 87, 'unmapped_targets': 3},
                    {'input': 'sunspec_client', 'output': 'sunspec', 'origin': 'local', 'retention': 0.93, 'lossiness_override': None, 'fields': 2, 'unmapped_targets': 0}]
        if method == 'describe_transform':
            return {'input': body['args'][0], 'output': body['args'][1], 'pattern': {'#': 'transform(device_values())'}, 'retention': 0.9, 'weight': 1,
                    'fields': 1, 'unmapped_targets': [], 'lossiness_override': None, 'universe': 2, 'mappings': [{'target': 'W', 'source': '701_W', 'fidelity': 1.0, 'functions': []}], 'source_universe': ['701_W']}
        if method == 'compile_pattern':
            return {'ok': True, 'mappings': [], 'unmapped_targets': [], 'unknown_functions': [], 'warnings': []}
        if method == 'statistics':
            return {'matrix/SunSpec/client>matrix/DNP3/served': {'messages': 12, 'writes': 3, 'publishes': 0, 'points_written': 6, 'points_skipped': 18, 'points_refused': 0,
                                                              'transform_errors': 0, 'last_message': 1793000000.0, 'last_write': 1793000000.0, 'last_error': None, 'enabled': True, 'drifted': {}}}
        if method == 'discover':
            options = body.get('kwargs', {}).get('options') or (body['args'][1] if len(body.get('args', [])) > 1 else {})
            topic = options.get('topic', 'site1/pv')
            return {'protocol': body['args'][0], 'source': '10.0.0.21:502 unit 1', 'identity': {'Mn': 'SunSpecTest'}, 'remote_id': ['tcp', '10.0.0.21', '502', '1'], 'models': [1, 701], 'points': 2, 'notes': [],
                    'entries': [{'identity': 'platform.driver', 'name': f'registry_configs/{topic.split("/")[-1]}.csv', 'type': 'csv', 'data': [{'volttron_point_name': '701_W', 'address': 40084, 'data_type': 'int16', 'data_source': 'short_poll'}]},
                                {'identity': 'platform.driver', 'name': f'devices/{topic}', 'type': 'json', 'data': {'driver_type': 'modbus', 'remote_config': {'driver_type': 'modbus', 'device_address': '10.0.0.21'}, 'registry_config': f'config://registry_configs/{topic.split("/")[-1]}.csv', 'publish_depth_first_multi': True}},
                                {'identity': 'platform.presentation', 'name': 'config', 'type': 'json', 'fragment': {'formats': {'pv': {'hub': False, 'fields': ['701_W']}}, 'transforms': [{'input_format': 'pv', 'output_format': 'sunspec', 'pattern': {}}],
                                                                                                                      'mappings': [{'uai': ['devices', *topic.split('/')], 'resource_type': 'canonical', 'resource': {'data_format': 'pv', 'owner': 'platform.driver', 'publication_topic': f'devices/{topic}/multi', 'rpc_topic': f'devices/{topic}'}}]}}]}
        return {'echo': {'identity': identity, 'method': method, 'body': body}}

    return app
