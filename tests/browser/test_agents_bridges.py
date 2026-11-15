"""Bridges and Agents: prefilled bridge form, the bus adapter's typed editor and settings dialog, the agent list and cards."""
import re

from playwright.sync_api import expect


def test_bridge_edit_is_prefilled(ui):
    ui.go('#/bridges')
    ui.button('Edit', ui.page.locator('.rc')).click()
    dialog = ui.dialog
    expect(dialog.locator('h4')).to_have_text('Edit the device bridge')
    values = dialog.locator('select').evaluate_all('es => es.map((e) => e.value)')
    assert values and all(values), f'every select is prefilled: {values}'
    expect(dialog.locator('input[placeholder="empty: all points"]')).to_be_visible()
    ui.cancel()


def test_bridges_gear_opens_the_bus_adapter_settings(ui):
    ui.go('#/bridges')
    ui.page.locator('#side .hd', has_text='⚙ bus adapter').click()
    dialog = ui.dialog
    expect(dialog.locator('h4')).to_contain_text('platform.bus_adapter')
    assert 'mqtt' in dialog.locator('select').evaluate_all('es => es.map((e) => e.value)')
    ui.cancel()


def test_agents_are_listed_with_their_state(ui):
    ui.go('#/agents')
    assert ui.page.locator('#side .tree > div').count() >= 4
    expect(ui.page.locator('#main .empty')).to_have_count(0)
    expect(ui.page.locator('#ctx')).to_contain_text(re.compile(r'pid\s*10\d'))


def test_bus_adapter_editor_is_typed_by_bus_type(ui):
    ui.go('#/agents?identity=platform.bus_adapter&edit=1')
    type_select = ui.page.locator('#main select:has(option[value="mqtt"])')
    expect(type_select).to_have_value('mqtt')
    assert '127.0.0.1' in ui.page.locator('#main input').evaluate_all('es => es.map((e) => e.value)')
    expect(ui.button('+ Bus')).to_be_visible()
    ui.expand_advanced()
    assert ui.page.locator('#main input[type=password]').count() >= 1, 'credentials are masked'


def test_service_card_shows_its_lists_with_links_and_no_editor(ui):
    ui.go('#/agents?identity=platform.presentation')
    expect(ui.button('Open Resources ▸').first).to_be_visible()
    expect(ui.button('Edit', ui.page.locator('.rc .r'))).to_have_count(0)
    expect(ui.page.locator('#main pre')).to_have_count(0)


def test_package_is_shown_as_a_neutral_name_with_version(ui):
    ui.go('#/agents?identity=platform.driver')
    package = ui.page.locator('#main .mb', has_text='package')
    assert ' '.join(package.inner_text().split()) == 'package Platform Driver 2.0.0rc8'


def test_agent_edit_and_cancel_round_trip(ui):
    ui.go('#/agents?identity=platform.resource_bridge')
    ui.button('Edit', ui.page.locator('.rc')).click()
    expect(ui.button('Save')).to_be_visible()
    expect(ui.page.locator('#main .grid.kv1 input, #main .grid.kv1 select, #main textarea').first).to_be_visible()
    ui.button('Cancel').click()
    expect(ui.button('Save')).to_have_count(0)


def test_remote_topic_dialog_leads_to_the_bus_adapter_settings(ui):
    """The bus row of the remote-topic dialog offers the adapter's buses and a way to add one: the gear closes the
    dialog and opens the bus adapter's settings, where buses are managed."""
    ui.go('#/bridges')
    ui.button('+ Remote topic').click()
    dialog = ui.dialog
    expect(dialog.locator('h4')).to_have_text('Add a remote topic')
    assert 'site_broker' in ' '.join(dialog.locator('select').first.locator('option').all_inner_texts())
    ui.button('⚙ buses', dialog).click()
    expect(ui.page.locator('.dialog h4')).to_contain_text('platform.bus_adapter')
    expect(ui.button('+ Bus', ui.page.locator('.dialog'))).to_be_visible()
    ui.cancel()
    key = ui.page.locator('#side fieldset.key')
    expect(key.locator('legend')).to_have_text('Key')
    expect(key).to_contain_text('a device as a bridge end')
    expect(key).to_contain_text('inbound, bus → local')


def test_bridges_page_shows_the_first_remote_topic_when_there_is_no_bridge(ui):
    """With no device bridge but a remote topic configured, the Bridges tab must not claim there is nothing."""
    entry = ui.page.request.get(f'{ui.url}/api/store/platform.resource_bridge/config').json()
    cleared = {**entry['data'], 'bridges': []}
    assert ui.page.request.put(f'{ui.url}/api/store/platform.resource_bridge/config', data={'type': 'json', 'data': cleared}).ok
    try:
        ui.page.locator('#statusbar').get_by_text('refresh now').click()
        ui.go('#/bridges')
        expect(ui.page.locator('#main .empty')).to_have_count(0)
        expect(ui.page.locator('#main .rc')).to_contain_text('Relay')
    finally:
        ui.page.request.put(f'{ui.url}/api/store/platform.resource_bridge/config', data={'type': 'json', 'data': entry['data']})
