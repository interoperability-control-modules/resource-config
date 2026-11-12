import pytest

from fake_vui import PASSWORD, USER
from resource_config.platform.base import AuthError, PlatformError


async def test_login_and_platform_discovery(vui):
    assert vui.access_token == 'access-1' and vui.platform == 'site1'
    assert vui.capabilities()['user'] == USER


async def test_wrong_password_is_auth_error(settings, client_factory):
    client = client_factory(settings)
    with pytest.raises(AuthError):
        await client.login(USER, 'nope')
    await client.close()


async def test_agents_with_status_health_and_hidden(vui):
    agents = {a.identity: a for a in await vui.list_agents()}
    assert agents['platform.driver'].running and agents['platform.driver'].name.startswith('volttron-platform-driver')
    assert agents['platform.driver'].health == {'status': 'GOOD', 'context': 'polling'}
    assert agents['platform.resource_bridge'].running is False and agents['platform.resource_bridge'].exit_code == 0
    assert agents['platform.web'].hidden and not agents['platform.driver'].hidden


async def test_lifecycle(vui, fake_platform):
    await vui.set_running('platform.resource_bridge', True)
    assert fake_platform.state.agents['platform.resource_bridge']['running'] is True
    await vui.set_enabled('platform.resource_bridge', True, priority='40')
    assert fake_platform.state.agents['platform.resource_bridge']['priority'] == '40'
    await vui.set_running('platform.resource_bridge', False)
    assert fake_platform.state.agents['platform.resource_bridge']['running'] is False
    with pytest.raises(PlatformError):
        await vui.set_running('nobody', True)


async def test_config_entries_are_typed_from_their_text(vui):
    assert set(await vui.list_stores()) >= {'platform.driver', 'platform.presentation'}
    names = await vui.list_configs('platform.driver')
    assert 'devices/matrix/SunSpec/client' in names
    device = await vui.get_config('platform.driver', 'devices/matrix/SunSpec/client')
    assert device.type == 'json' and device.data['driver_type'] == 'modbus' and device.etag.startswith('"')
    registry = await vui.get_config('platform.driver', 'registry_configs/sunspec_client.csv')
    assert registry.type == 'csv' and registry.data[0]['Point Name'] == '701_W' and len(registry.data) == 3


async def test_put_and_delete_round_trip(vui, fake_platform):
    await vui.put_config('platform.driver', 'devices/new', 'json', '{"driver_type": "fake"}')
    assert fake_platform.state.store['platform.driver']['devices/new'] == ('json', '{"driver_type": "fake"}')
    entry = await vui.get_config('platform.driver', 'devices/new')
    assert entry.data == {'driver_type': 'fake'}
    await vui.put_config('platform.driver', 'registry_configs/x.csv', 'csv', 'a,b\n1,2\n')
    assert (await vui.get_config('platform.driver', 'registry_configs/x.csv')).type == 'csv'
    await vui.delete_config('platform.driver', 'devices/new')
    assert 'devices/new' not in fake_platform.state.store['platform.driver']


async def test_rpc_body_shape_and_refusal(vui, fake_platform):
    result = await vui.rpc('platform.presentation', 'resolve', ['matrix', 'SunSpec', 'client'], 'openfmb.solar.reading', False, None, 'read')
    assert result['path'][0] == 'sunspec_client'
    identity, method, body = fake_platform.state.rpc_calls[-1]
    assert (identity, method) == ('platform.presentation', 'resolve') and body['args'][1] == 'openfmb.solar.reading'
    with pytest.raises(AuthError):
        await vui.rpc('config.store', 'get_config', 'platform.driver', 'x')


async def test_expired_access_token_is_renewed_once(vui, fake_platform):
    fake_platform.state.access_tokens.discard('access-1')
    assert 'platform.driver' in await vui.list_stores()
    assert vui.access_token == 'access-2'
