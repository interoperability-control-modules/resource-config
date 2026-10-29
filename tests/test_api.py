from fake_vui import PASSWORD, USER


def test_login_required(ui):
    assert ui.get('/api/store').status_code == 401
    assert ui.post('/api/login', json={'username': USER, 'password': 'bad'}).status_code == 401


def test_session_store_and_model(logged_in):
    ui = logged_in
    assert ui.get('/api/session').json()['user'] == USER
    snapshot = ui.get('/api/store').json()
    assert 'platform.driver' in snapshot['identities'] and snapshot['identities']['platform.driver']['registry_configs/sunspec_client.csv']['type'] == 'csv'
    model = ui.get('/api/model').json()
    assert {c['topic'] for c in model['resources']['canonical']} == {'matrix/SunSpec/client', 'matrix/DNP3/served'}
    assert any(a['identity'] == 'platform.driver' and a['type'] == 'driver' for a in model['agents'])
    assert ui.get('/api/catalog').json()['schemas']


def test_entry_write_and_delete(logged_in, fake_platform):
    ui = logged_in
    response = ui.put('/api/store/platform.driver/devices/new', json={'type': 'json', 'data': {'driver_type': 'fake', 'interval': 1}})
    assert response.status_code == 200 and fake_platform.state.store['platform.driver']['devices/new'][0] == 'json'
    entry = ui.get('/api/store/platform.driver/devices/new').json()
    assert entry['data']['interval'] == 1 and entry['text'].startswith('{')
    assert ui.put('/api/store/platform.driver/registry_configs/n.csv', json={'type': 'csv', 'data': [{'Point Name': 'a', 'Address': '1'}]}).status_code == 200
    assert fake_platform.state.store['platform.driver']['registry_configs/n.csv'][1] == 'Point Name,Address\na,1\n'
    assert ui.delete('/api/store/platform.driver/devices/new').status_code == 200
    assert 'devices/new' not in fake_platform.state.store['platform.driver']


def test_lifecycle_and_resolve(logged_in, fake_platform):
    ui = logged_in
    assert ui.post('/api/agents/platform.resource_bridge/start').status_code == 200
    assert fake_platform.state.agents['platform.resource_bridge']['running'] is True
    result = ui.post('/api/interop/resolve', json={'uai': 'openfmb/solarmodule/SolarReadingProfile/x', 'as_format': 'openfmb.solar.reading'}).json()
    assert result['retention'] == 0.58
    assert ui.post('/api/interop/rpc', json={'identity': 'config.store', 'method': 'get_config'}).status_code == 403


def test_pending_set_applies_in_order(logged_in, fake_platform):
    ui = logged_in
    entries = [{'identity': 'platform.resource_bridge', 'name': 'config', 'type': 'json', 'data': {'bridges': []}},
               {'identity': 'platform.driver', 'name': 'devices/site1/pv', 'type': 'json', 'data': {'driver_type': 'modbus'}},
               {'identity': 'platform.driver', 'name': 'registry_configs/pv.csv', 'type': 'csv', 'text': 'Point Name,Address\nW,1\n'},
               {'identity': 'platform.presentation', 'name': 'config', 'type': 'json', 'data': {'mappings': []}}]
    assert len(ui.post('/api/pending', json=entries).json()['entries']) == 4
    applied = ui.post('/api/pending/apply').json()['applied']
    assert [a['identity'] for a in applied] == ['platform.driver', 'platform.driver', 'platform.presentation', 'platform.resource_bridge']
    assert applied[0]['name'] == 'registry_configs/pv.csv'                  # the registry before the device that names it
    assert ui.get('/api/pending').json()['entries'] == []
    assert fake_platform.state.store['platform.driver']['devices/site1/pv'][0] == 'json'


def test_websocket_requires_session_and_sends_hello(logged_in):
    with logged_in.websocket_connect('/ws') as socket:
        assert socket.receive_json()['type'] == 'hello'


def test_discover_returns_pending_entries_with_the_fragment_merged(logged_in):
    ui = logged_in
    result = ui.post('/api/discover', json={'protocol': 'sunspec', 'options': {'topic': 'site1/feeder1/pv', 'host': '10.0.0.21'}}).json()
    assert result['remote_id'] == ['tcp', '10.0.0.21', '502', '1']
    registry, device, service = result['entries']
    assert registry['name'] == 'registry_configs/pv.csv' and registry['type'] == 'csv' and 'points' in registry['summary']
    assert device['name'] == 'devices/site1/feeder1/pv'
    assert service['identity'] == 'platform.presentation' and 'pv' in service['data']['formats']
    topics = ['/'.join(m['uai']) for m in service['data']['mappings']]
    assert 'devices/site1/feeder1/pv' in topics and 'matrix/SunSpec/client' in topics      # merged, not replaced
    assert ui.post('/api/pending', json=result['entries']).status_code == 200


def test_model_is_enriched_from_the_running_agents(logged_in):
    model = logged_in.get('/api/model').json()
    assert model['formats_live'] and model['transforms_live'] and model['statistics_live']
    kinds = {t['kind'] for t in model['transforms']}
    assert 'bundled' in kinds and 'local' in kinds
    bridge = next(b for b in model['bridges'] if b['name'] == 'matrix/SunSpec/client>matrix/DNP3/served')
    assert bridge['stats']['messages'] == 12
    report = logged_in.post('/api/interop/chain_report', json={'input_format': 'sunspec_client', 'output_format': 'openfmb.solar.reading'}).json()
    assert report['hops'][0]['kept'] == 104
