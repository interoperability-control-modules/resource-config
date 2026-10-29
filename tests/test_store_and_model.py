import json

from resource_config.relations import build_model
from resource_config.store import Store


async def test_refresh_reports_added_changed_removed(vui, fake_platform):
    store = Store()
    events = await store.refresh(vui)
    assert all(e['kind'] == 'added' for e in events) and len(events) == len(store.entries) >= 7
    fake_platform.state.store['platform.driver']['devices/matrix/SunSpec/client'] = ('json', json.dumps({'driver_type': 'modbus', 'interval': 5}))
    del fake_platform.state.store['der.rtc']['config']
    fake_platform.state.store['platform.driver']['devices/extra'] = ('json', '{}')
    events = await store.refresh(vui)
    kinds = {(e['kind'], e['name']) for e in events}
    assert ('changed', 'devices/matrix/SunSpec/client') in kinds and ('removed', 'config') in kinds and ('added', 'devices/extra') in kinds
    assert await store.refresh(vui) == []


async def test_put_notifies_subscribers(vui):
    store = Store()
    await store.refresh(vui)
    queue = store.subscribe()
    await store.put(vui, 'platform.driver', 'devices/x', 'json', {'driver_type': 'fake'})
    message = queue.get_nowait()
    assert message['events'] == [{'kind': 'added', 'identity': 'platform.driver', 'name': 'devices/x'}]
    assert store.get('platform.driver', 'devices/x').data == {'driver_type': 'fake'}


async def test_model_derives_sources_aliases_deliveries_and_consumers(vui, settings):
    store = Store()
    await store.refresh(vui)
    model = build_model(store.snapshot(), settings, agents=[{'identity': 'der.rtc', 'type': 'rtc'}])
    canonical = {c['topic']: c for c in model['resources']['canonical']}
    inverter = canonical['matrix/SunSpec/client']
    assert inverter['source']['kind'] == 'device' and inverter['source']['device'] == 'matrix/SunSpec/client'
    assert inverter['source']['publishes'] == 'multi' and inverter['source']['driver_role'] == 'client'
    assert len(inverter['aliases']) == 2 and inverter['parameters']['name'] == 'PV inverter 1'
    kinds = {c['kind'] for c in inverter['consumers']}
    assert 'bridge' in kinds and 'agent' in kinds                       # bridged to the outstation; the RTC names its topic
    aliases = {a['topic']: a for a in model['resources']['aliases']}
    reading = aliases['openfmb/solarmodule/SolarReadingProfile/7d1a2b3c-0000-4000-8000-000000000001']
    assert reading['canonical'] == 'matrix/SunSpec/client' and reading['encoding'] == 'protobuf' and reading['edition'] == '2.2'
    assert [d['kind'] for d in reading['deliveries']] == ['remote_topic'] and reading['deliveries'][0]['direction'] == 'outbound'
    control = aliases['openfmb/solarmodule/SolarControlProfile/7d1a2b3c-0000-4000-8000-000000000001']
    delivery_kinds = sorted(d['kind'] for d in control['deliveries'])
    assert delivery_kinds == ['device', 'remote_topic']                 # inbound topic, and a bridge writes the inverter
    devices = {d['topic']: d for d in model['devices']}
    assert devices['matrix/SunSpec/client']['registry'] == 'registry_configs/sunspec_client.csv'
    assert devices['matrix/SunSpec/client']['registry_rows'][1]['Data Source'] == 'poll_once'
    assert devices['matrix/SunSpec/client']['remote_config']['port'] == 15020
    assert devices['matrix/DNP3/served']['publishes'] == 'all' and devices['matrix/DNP3/served']['driver_role'] == 'outstation'
    assert canonical['matrix/DNP3/served']['source']['kind'] == 'device'
    formats = {f['name']: f for f in model['formats']}
    assert formats['61850']['kind'] == 'hub' and formats['sunspec_client']['kind'] == 'device' and formats['openfmb.solar.reading']['kind'] == 'bus'
    assert model['remote_topics'][0]['bus'] == 'site_broker' and model['bridges'][1]['source']['bus'] is True


async def test_refresh_uses_validators_when_the_platform_sends_them(vui, fake_platform):
    store = Store()
    await store.refresh(vui)                       # first pass reads everything
    before = fake_platform.state.not_modified
    assert await store.refresh(vui) == []          # second pass: the listing's etags settle every entry
    assert fake_platform.state.not_modified == before        # not even a 304 was needed
    fake_platform.state.metadata = False           # an older web service: fall back to reading the text
    store2 = Store()
    await store2.refresh(vui)
    assert len(store2.entries) == len(store.entries) and store2.get('platform.driver', 'devices/matrix/SunSpec/client').etag.startswith('"')
