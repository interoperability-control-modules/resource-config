"""Devices: tooltips, the topic as segments, registry display names, Transform validation, add and discover."""
import re
from urllib.parse import quote

from playwright.sync_api import expect

from conftest import PRODUCT_NAME

SUNSPEC = '#/devices?topic=' + quote('matrix/SunSpec/client', safe='')
DNP3 = '#/devices?topic=' + quote('matrix/DNP3/served', safe='')
SEP2 = '#/devices?topic=' + quote('matrix/SEP2/client', safe='')


def test_labels_have_css_tooltips_not_title_attributes(ui):
    ui.go('#/devices')
    tip = ui.page.locator('#main .tip[data-tip]').first
    expect(tip).to_be_visible()
    assert tip.get_attribute('title') is None
    assert ui.pseudo_content(tip, '::after') not in ('none', ''), 'the tooltip is drawn by a CSS pseudo-element'


def test_edit_topic_is_segments_with_slashes_drawn_between(ui):
    ui.go(SUNSPEC + '&edit=1')
    segs = ui.page.locator('#main input.seg')
    expect(segs).to_have_count(3)
    wraps = ui.page.locator('#main .segs.slash .segw')
    assert ui.pseudo_content(wraps.nth(0), '::before') == 'none'
    assert '/' in ui.pseudo_content(wraps.nth(1), '::before')
    segs.first.fill('averyveryverylongsegmentname')
    scroll, client = segs.first.evaluate('e => [e.scrollWidth, e.clientWidth]')
    assert scroll <= client + 1, f'a long segment is clipped: {scroll} vs {client}'
    ui.button('Cancel').click()
    expect(ui.page.locator('#main input.seg')).to_have_count(0)


def test_registry_point_name_column_shows_a_neutral_header_and_keeps_the_file_header_as_title(ui):
    ui.go(DNP3)
    headers = ui.page.locator('#main .grid-table th')
    texts = [h.inner_text().strip() for h in headers.all()]
    assert 'Point Name' in texts
    assert not any(PRODUCT_NAME.search(t) for t in texts)
    assert any((h.get_attribute('title') or '').startswith('Volttron Point Name') for h in headers.all())


def test_transform_cells_are_checked_against_the_library(ui):
    """sunssf(701_W_SF) reads a point of this registry; 701_Hz_SF is not in it, so that cell and the checks card warn."""
    ui.go(SUNSPEC)
    cells = ui.page.locator('#main td.transform')
    expect(cells).to_have_count(3)      # one per row; the scale factor's own cell is empty and stays unmarked
    expect(cells.nth(0)).to_have_class(re.compile(r'\bok\b'))
    assert 'reads: 701_W_SF' in cells.nth(0).get_attribute('title')
    expect(cells.nth(1)).to_have_text('')
    expect(cells.nth(1)).not_to_have_class(re.compile(r'\b(ok|warn|err)\b'))
    expect(cells.nth(2)).to_have_class(re.compile(r'\bwarn\b'))
    assert 'not in this registry: 701_Hz_SF' in cells.nth(2).get_attribute('title')
    checks = ui.page.locator('#ctx .card', has=ui.page.locator('h4', has_text='Checks'))
    expect(checks).to_contain_text('transforms read points not in this registry: 701_Hz_SF')


def test_transform_functions_dialog_lists_the_library(ui):
    ui.go(SUNSPEC)
    ui.button('Functions ▸').click()
    dialog = ui.dialog
    expect(dialog.locator('h4')).to_have_text('Transform functions')
    expect(dialog.locator('tr', has_text='sunssf')).to_have_count(1)
    expect(dialog.locator('tr', has_text='scale(')).not_to_have_count(0)
    ui.button('Close', dialog).click()
    expect(dialog).to_have_count(0)


def test_sep2_edit_shows_the_tool_default_where_the_driver_default_names_the_platform(ui):
    ui.go(SEP2 + '&edit=1')
    ui.expand_advanced()
    placeholders = [p for p in ui.page.locator('#main input').evaluate_all('es => es.map((e) => e.placeholder)') if p]
    assert 'ICM' in placeholders
    assert not any(PRODUCT_NAME.search(p) for p in placeholders)


def test_add_device_needs_a_topic(ui):
    ui.go('#/devices')
    ui.button('+ Device').click()
    dialog = ui.dialog
    expect(dialog.locator('h4')).to_have_text('Add a device')
    expect(dialog.locator('input.seg').first).to_be_visible()
    ui.button('Create', dialog).click()
    expect(ui.toast('a topic is required')).to_be_visible()
    expect(dialog).to_have_count(1)
    ui.cancel()


def test_add_device_from_a_registry_file(ui):
    """The create dialog takes the registry as a file (the default), an existing registry or an empty one; a CSV file
    becomes the device's registry under the chosen name and the device opens in edit mode with its rows."""
    ui.go('#/devices')
    ui.button('+ Device').click()
    dialog = ui.dialog
    expect(dialog.locator('label.chk', has_text='from a file').locator('input.rad')).to_be_checked()
    dialog.locator('input.seg').first.click()
    ui.page.keyboard.type('site9/filed')
    ui.button('Create', dialog).click()
    expect(ui.toast('choose a registry file')).to_be_visible()
    csv = 'Point Name,Address,Data Type,Writable,Data Source,Units\nW,40084,int16,FALSE,short_poll,W\nHz,40094,uint16,FALSE,short_poll,Hz\n'
    dialog.locator('input[type=file]').set_input_files({'name': 'filed.csv', 'mimeType': 'text/csv', 'buffer': csv.encode()})
    dialog.locator('input[placeholder^="registry_configs/"]').fill('filed_points.csv')
    ui.page.keyboard.press('Tab')
    ui.button('Create', dialog).click()
    expect(ui.toast('device created')).to_be_visible()
    expect(ui.page.locator('#main .rc .row1')).to_contain_text('devices/site9/filed')
    expect(ui.page.locator('#main .rsec', has_text='Registry')).to_contain_text('filed_points.csv')
    expect(ui.page.locator('#main .grid-table tr')).to_have_count(3)
    ui.button('Cancel').click()
    ui.go('#/devices')
    ui.button('+ Device').click()
    expect(ui.dialog.locator('label.chk', has_text='an existing registry')).to_be_visible()
    ui.cancel()


def test_discover_reviews_then_fills_and_applies_the_pending_set(ui):
    ui.go('#/devices?discover=1')
    dialog = ui.dialog
    expect(dialog.locator('h4')).to_have_text('Discover a device')
    expect(dialog.locator('.k', has_text='Scale factors applied by:')).to_be_visible()
    expect(dialog.locator('select:has(option[value="service"])')).to_have_value('driver')
    dialog.locator('input[placeholder="192.168.1.20"]').fill('10.0.0.21')
    ui.page.keyboard.press('Tab')
    dialog.locator('input[placeholder="site1/feeder1/pv_inverter"]').fill('site9/pv_test')
    ui.page.keyboard.press('Tab')
    ui.button('Scan and review ▸', dialog).click()
    review = ui.dialog
    expect(review.locator('.steps .on')).to_have_text('2 Review')
    expect(review).to_contain_text('SunSpecTest')
    expect(review.locator('td', has_text='registry_configs/pv_test.csv')).to_be_visible()
    expect(review.locator('td', has_text='devices/site9/pv_test')).to_be_visible()
    ui.button('Add to pending changes ▸', review).click()
    expect(ui.toast('added to the pending set')).to_be_visible()
    expect(ui.page.locator('#tabs a.on')).to_have_count(0)
    assert ui.page.evaluate('location.hash') == '#/pending'
    expect(ui.dialog).to_have_count(0)     # the Discover dialog must not reopen once its route flag has been consumed
    expect(ui.page.locator('#tabs .pill')).to_have_text('3')
    expect(ui.page.locator('#main table tr')).to_have_count(4)
    ui.button('Apply in order').click()
    expect(ui.toast('applied 3 entries')).to_be_visible()
    expect(ui.page.locator('#tabs .pill')).to_have_text('0')
    ui.go('#/devices?topic=' + quote('site9/pv_test', safe=''))
    expect(ui.page.locator('#main .rc .row1')).to_contain_text('devices/site9/pv_test')
    expect(ui.page.locator('#side .leaf', has_text='pv_test')).to_be_visible()
    # the discovered entry keeps its remote settings under remote_config; the card and its edit form show them
    expect(ui.page.locator('#main')).to_contain_text('10.0.0.21')
    ui.button('Edit', ui.page.locator('.rc')).click()
    expect(ui.button('Save')).to_be_visible()     # the edit form has rendered (the route change is asynchronous)
    assert '10.0.0.21' in ui.page.locator('#main input').evaluate_all('es => es.map((e) => e.value)'), 'the edit form is filled from remote_config'
    ui.button('Cancel').click()


def test_discover_dnp3_scans_an_outstation_or_takes_a_profile_file(ui):
    """DNP3 has no self-description, but IEEE 1815.2 fixes the point map: the dialog scans a reachable outstation by
    default and offers a profile file as the alternative; the link addresses are asked in both cases."""
    ui.go('#/devices?discover=1')
    dialog = ui.dialog
    dialog.locator('select').first.select_option('dnp3')
    expect(dialog.locator('label.chk', has_text='a reachable outstation').locator('input.rad')).to_be_checked()
    expect(dialog.locator('input[type=file]')).to_have_count(0)
    expect(dialog.locator('input[placeholder="20000"]')).to_be_visible()
    expect(dialog.locator('input[placeholder="2"]')).to_be_visible()
    ui.button('Scan and review ▸', dialog).click()
    expect(ui.toast('a topic is required')).to_be_visible()
    dialog.locator('input[placeholder="site1/feeder1/pv_inverter"]').fill('site9/der')
    ui.page.keyboard.press('Tab')
    ui.button('Scan and review ▸', dialog).click()
    expect(ui.toast('an outstation address is required')).to_be_visible()
    dialog.locator('label.chk', has_text='profile file').locator('input.rad').check()
    expect(dialog.locator('input[type=file]')).to_have_count(1)
    ui.button('Scan and review ▸', dialog).click()
    expect(ui.toast('choose a profile file')).to_be_visible()
    ui.cancel()


def test_discover_2030_5_asks_for_the_device_to_mirror_and_explains_when_there_is_none(ui):
    """The 2030.5 client represents another device towards the server; its registry comes from that device's resource
    format. With resources present the dialog offers them; the controls stay inside their column."""
    ui.go('#/devices?discover=1')
    dialog = ui.dialog
    dialog.locator('select').first.select_option('ieee2030_5')
    mirror = dialog.locator('select').nth(1)
    expect(mirror).to_be_visible()
    options = mirror.locator('option').all_inner_texts()
    assert 'matrix/SunSpec/client' in options and options[0] == 'choose…'
    expect(dialog.locator('[data-tip*="discover the device first"]')).to_have_count(1)
    left_column = dialog.locator('.two > div').first
    column_box, select_box = left_column.bounding_box(), mirror.bounding_box()
    assert select_box['x'] + select_box['width'] <= column_box['x'] + column_box['width'] + 1, 'the choice box does not run into the right column'
    ui.cancel()


def test_discover_dnp3_addresses_have_their_own_labelled_rows(ui):
    ui.go('#/devices?discover=1')
    dialog = ui.dialog
    dialog.locator('select').first.select_option('dnp3')
    labels = [' '.join(k.inner_text().split()) for k in dialog.locator('.two > div').first.locator('.k').all()]
    assert 'Master id ⓘ' in labels and 'Outstation id ⓘ' in labels and 'Outstation address' in labels and 'Port' in labels
    master_label = dialog.locator('.k', has_text='Master id')
    master_box = dialog.locator('input[placeholder="2"]')
    assert abs(master_label.bounding_box()['y'] - master_box.bounding_box()['y']) < 12, 'label and box share a row'
    ui.cancel()


def test_edit_form_shows_role_gated_fields_when_the_entry_has_no_role(ui):
    """A discovered DNP3 client carries no driver_role; the driver's default (master) must gate the form the way it
    gates the card, so the outstation address is editable."""
    entry = {'driver_type': 'dnp3', 'registry_config': 'config://registry_configs/dnp3_served.csv', 'publish_depth_first_multi': True,
             'remote_config': {'driver_type': 'dnp3', 'outstation_ip': '10.0.0.9', 'port': 20000, 'master_id': 2, 'outstation_id': 1}}
    response = ui.page.request.put(f'{ui.url}/api/store/platform.driver/devices/matrix/DNP3/scanned', data={'type': 'json', 'data': entry})
    assert response.ok, response.text()
    ui.page.locator('#statusbar').get_by_text('refresh now').click()
    ui.go('#/devices?topic=' + quote('matrix/DNP3/scanned', safe='') + '&edit=1')
    expect(ui.page.locator('#main .rc .row1')).to_contain_text('devices/matrix/DNP3/scanned')
    values = ui.page.locator('#main input:visible').evaluate_all('es => es.map((e) => e.value)')
    assert '10.0.0.9' in values, f'the outstation address field is shown and filled: {values}'
    labels = [' '.join(k.inner_text().split()) for k in ui.page.locator('#main .k:visible').all()]
    assert any(l.startswith('Outstation ip') for l in labels) and not any(l.startswith('Bind host') for l in labels)
    ui.button('Cancel').click()


def test_device_health_card_shows_the_remotes_report(ui):
    """The Health card on a device is the driver's own report of that remote: status, polls, last success, errors."""
    ui.go(SUNSPEC)
    card = ui.page.locator('#ctx .card', has=ui.page.locator('h4', has_text='Health'))
    expect(card).to_contain_text('remote health')
    expect(card.locator('.hrow', has_text='remote health').locator('.ok')).to_have_text('GOOD')
    expect(card).to_contain_text(re.compile(r'\d+ · 2 failed'))
    expect(card).to_contain_text('device_address 127.0.0.1')
    expect(card).to_contain_text('recovered')             # a past failure on a healthy remote is not shown as an error
    expect(card).not_to_contain_text('last error')
    ui.go(DNP3)
    card = ui.page.locator('#ctx .card', has=ui.page.locator('h4', has_text='Health'))
    expect(card.locator('.hrow', has_text='remote health').locator('.err')).to_have_text('BAD')
    expect(card).to_contain_text('no master connected')
    expect(card).to_contain_text('failing points')


def test_live_state_is_re_read_on_a_timer_but_not_under_an_edit(ui):
    """Health, status and statistics change without store events: the model is re-read every few seconds and the page
    drawn again, except while a dialog, an edit form or a focused field would be disturbed."""
    ui.page.evaluate("localStorage.setItem('rc:live', '400')")
    ui.open(SUNSPEC)
    card = ui.page.locator('#ctx .card', has=ui.page.locator('h4', has_text='Health'))
    polls = card.locator('.hrow', has_text='polls')
    first = polls.inner_text()
    expect(polls).not_to_have_text(first, timeout=5000)
    expect(ui.page.locator('#statusbar')).to_contain_text('live every 0 s')
    ui.button('Edit', ui.page.locator('.rc')).click()
    expect(ui.button('Save')).to_be_visible()
    interval = ui.page.locator('#main input[placeholder="60"]')
    interval.fill('7')
    ui.page.wait_for_timeout(1200)
    assert interval.input_value() == '7', 'an edit form is left alone by the live refresh'
    ui.button('Cancel').click()
