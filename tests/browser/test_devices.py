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


def test_discover_reviews_then_fills_and_applies_the_pending_set(ui):
    ui.go('#/devices?discover=1')
    dialog = ui.dialog
    expect(dialog.locator('h4')).to_have_text('Discover a device')
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
