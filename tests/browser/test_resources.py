"""Resources: the segment input, dialog keyboard handling, the two layouts, prefilled edit forms, deleting with dependents."""
import re
from urllib.parse import quote

from playwright.sync_api import expect

CANONICAL = '#/resources?uai=' + quote('matrix/SunSpec/client', safe='')
ALIAS = '#/resources?alias=' + quote('openfmb/solarmodule/SolarReadingProfile/7d1a2b3c-0000-4000-8000-000000000001', safe='')


def chips(dialog):
    return [c.input_value() for c in dialog.locator('input.seg').all()]


def test_segment_input_splits_on_separators_and_follows_the_keyboard(ui):
    ui.button('+ Resource').click()
    dialog = ui.dialog
    seg = dialog.locator('input.seg')
    expect(seg).to_have_count(1)
    seg.first.click()
    ui.page.keyboard.type('devices/pnnl,seb')
    assert chips(dialog) == ['devices', 'pnnl', 'seb']
    ui.page.keyboard.press('Tab')          # on a filled last chip: a new empty chip, focused
    expect(seg).to_have_count(4)
    expect(seg.last).to_be_focused()
    ui.page.keyboard.press('Backspace')    # on the empty chip: removed, the previous one focused
    expect(seg).to_have_count(3)
    expect(seg.last).to_be_focused()
    assert seg.last.input_value() == 'seb'
    assert dialog.locator('[data-tip]').count() >= 4, 'the form labels carry tooltips'
    ui.cancel()


def test_dialog_keyboard_focus_enter_and_escape(ui):
    ui.button('+ Resource').click()
    dialog = ui.dialog
    expect(dialog.locator('input.seg').first).to_be_focused()
    assert all(b.get_attribute('tabindex') == '0' for b in dialog.locator('.btn').all()), 'dialog buttons are tabbable'
    ui.page.keyboard.press('Enter')        # runs the primary action: validation fails, the dialog stays
    expect(ui.toast('UAI and format are required')).to_be_visible()
    expect(dialog).to_have_count(1)
    ui.page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)


def test_tabbed_layout_highlights_the_chosen_tab_and_stacked_starts_open(ui):
    ui.page.evaluate("localStorage.setItem('rc:layout', 'tabs')")
    ui.open(CANONICAL)
    bar = ui.page.locator('.ctabs')
    tab = lambda label: bar.locator('span', has_text=label)  # noqa: E731
    tab('Parameters').click()
    expect(tab('Parameters')).to_have_class(re.compile(r'\bon\b'))
    expect(tab('Aliases')).not_to_have_class(re.compile(r'\bon\b'))
    expect(ui.page.locator('.rc .rsec.col')).to_have_count(0)
    expect(ui.page.locator('.rc .rsec h5').first).to_be_visible()
    tab('Consumers').click()
    expect(tab('Consumers')).to_have_class(re.compile(r'\bon\b'))
    expect(tab('Parameters')).not_to_have_class(re.compile(r'\bon\b'))
    ui.page.evaluate("localStorage.setItem('rc:layout', 'stacked')")
    ui.open(CANONICAL)
    triangles = ui.page.locator('.rc .rsec.col .tri')
    assert triangles.count() > 0
    assert all(t.inner_text().strip() == '▾' for t in triangles.all()), 'stacked sections start open'


def test_edit_canonical_opens_the_prefilled_form(ui):
    ui.go(CANONICAL)
    ui.button('Edit', ui.page.locator('.rc')).click()
    dialog = ui.dialog
    expect(dialog.locator('h4')).to_have_text(re.compile(r'^Edit'))
    assert chips(dialog) == ['matrix', 'SunSpec', 'client']
    assert dialog.locator('select').first.input_value(), 'the format is prefilled'
    ui.cancel()


def test_edit_alias_is_prefilled_without_delivery(ui):
    ui.go(ALIAS)
    ui.button('Edit', ui.page.locator('.rc')).click()
    dialog = ui.dialog
    expect(dialog.locator('h4')).to_have_text(re.compile(r'^Edit alias'))
    assert len(chips(dialog)) == 4
    assert dialog.locator('select').first.input_value()
    expect(dialog).not_to_contain_text('a remote topic on a bus')
    ui.cancel()


def test_add_alias_offers_parameters_delivery_and_save(ui):
    ui.go(CANONICAL)
    ui.button('+ Alias', ui.page.locator('#side')).click()
    dialog = ui.dialog
    expect(dialog.locator('input[placeholder*="mrid"]')).to_be_visible()
    expect(dialog.locator('input.seg').first).to_be_visible()
    expect(dialog).to_contain_text('a remote topic on a bus')
    expect(ui.button('Save', dialog)).to_be_visible()
    ui.cancel()


def test_delete_with_dependents_needs_a_decision_per_row_and_approval_for_kept_ones(ui):
    ui.go(CANONICAL)
    ui.button('⋯', ui.page.locator('.rc')).click()
    ui.page.locator('.menu2 div', has_text='Delete').click()
    dialog = ui.dialog
    expect(dialog.locator('h4')).to_contain_text('Delete')
    assert dialog.locator('tr').count() - 1 >= 3, 'every dependent is listed'
    delete = ui.button('Delete', dialog)
    expect(delete).to_have_class(re.compile(r'\bdis\b'))
    for radio in dialog.locator('label.chk', has_text='keep').locator('input.rad').all():
        radio.check()
    approval = dialog.locator('label.chk:has(input.box)')
    expect(approval).to_be_visible()
    expect(delete).to_have_class(re.compile(r'\bdis\b'))
    approval.locator('input.box').check()
    expect(delete).not_to_have_class(re.compile(r'\bdis\b'))
    ui.cancel()
    expect(ui.button('⋯', ui.page.locator('.rc'))).to_be_visible()


def test_chain_report_dialog_opens_from_an_alias(ui):
    ui.go(ALIAS)
    ui.button('Chain report ▸').click()
    dialog = ui.dialog
    expect(dialog.locator('h4')).to_contain_text('Chain report')
    expect(dialog.locator('fieldset legend').first).to_have_text('Per hop')
    ui.button('Close', dialog).click()
    expect(dialog).to_have_count(0)


def test_openfmb_alias_fills_the_uai_from_the_format_and_the_mrid_once(ui):
    """Choosing an OpenFMB profile format fills the UAI prefix from the format's module and profile; the mRID is typed
    or generated once and lands both as the UAI's last segment and as parameters.mrid."""
    ui.go(CANONICAL)
    ui.button('+ Alias', ui.page.locator('#side')).click()
    dialog = ui.dialog
    expect(dialog.locator('.k', has_text='mRID')).to_be_hidden()
    dialog.locator('select').first.select_option('openfmb.solar.reading')
    expect(dialog.locator('.k', has_text='mRID')).to_be_visible()
    # this device already has an mRID (its existing alias), so the UAI is complete at once
    assert chips(dialog) == ['openfmb', 'solarmodule', 'SolarReadingProfile', '7d1a2b3c-0000-4000-8000-000000000001']
    ui.button('new mRID', dialog).click()
    segments = chips(dialog)
    assert len(segments) == 4 and len(segments[3]) == 36 and segments[3] != '7d1a2b3c-0000-4000-8000-000000000001', segments
    import json
    assert json.loads(dialog.locator('input[placeholder^=\'{"mrid"\']').input_value()) == {'mrid': segments[3]}
    dialog.locator('input[placeholder="device mRID, a UUID"]').fill('7d1a2b3c-0000-4000-8000-000000000011')
    ui.page.keyboard.press('Tab')
    assert chips(dialog)[3] == '7d1a2b3c-0000-4000-8000-000000000011'
    assert '0000000011' in dialog.locator('input[placeholder^=\'{"mrid"\']').input_value()
    ui.cancel()


def test_alias_card_links_each_transform_on_its_path(ui):
    """"How this resolves" names every hop of the chain as a link to that transform, instead of one button that
    opened the Transforms tab on whatever came first."""
    ui.go(ALIAS)
    section = ui.page.locator('.rc .rsec', has_text='How this resolves')
    expect(ui.button('Open transform ▸')).to_have_count(0)
    hops = section.locator('a.mono')
    expect(hops.first).to_be_visible()
    first = hops.first.inner_text()
    hops.first.click()
    assert ui.page.evaluate('location.hash').startswith('#/transforms?input=')
    expect(ui.page.locator('#side .tree .sel')).to_have_text(first)


def test_saving_an_alias_with_a_delivery_goes_to_pending_changes(ui):
    """An alias with a delivery is several agents' entries, so it is staged; the dialog says so and shows the cart."""
    ui.go(CANONICAL)
    ui.button('+ Alias', ui.page.locator('#side')).click()
    dialog = ui.dialog
    dialog.locator('input.seg').first.click()
    ui.page.keyboard.type('site9/staged_alias')
    dialog.locator('select').first.select_option('openfmb.solar.reading')
    dialog.locator('label.chk', has_text='a remote topic on a bus').locator('input.rad').check()
    # a device-sourced resource: the bridge that publishes the alias is part of the delivery, on by default
    expect(dialog.locator('label.chk', has_text='publish it from device')).to_be_visible()
    dialog.locator('label.chk', has_text='inbound').locator('input.rad').check()
    expect(dialog.locator('label.chk', has_text='write it to device')).to_be_visible()
    expect(dialog.locator('input[placeholder="empty: all points"]')).to_be_visible()
    dialog.locator('label.chk', has_text='outbound').locator('input.rad').check()
    ui.button('Save', dialog).click()
    expect(ui.toast('staged in Pending changes')).to_be_visible()
    expect(ui.page).to_have_url(re.compile(r'#/pending$'))      # after the model refresh that follows the staging
    table = ui.page.locator('#main table')
    expect(table).to_contain_text('platform.bus_adapter')
    expect(table).to_contain_text('platform.resource_bridge')
    expect(table).to_contain_text('bridge publishing')
    ui.button('Discard all').click()


def test_a_second_openfmb_alias_starts_from_the_devices_mrid(ui):
    """The mRID identifies the device: a new OpenFMB alias of a canonical that already has one offers the same mRID, in
    the UAI and in the parameters, so reading and control profiles name one device."""
    ui.go(CANONICAL)
    ui.button('+ Alias', ui.page.locator('#side')).click()
    dialog = ui.dialog
    dialog.locator('select').first.select_option('openfmb.solar.control')
    mrid = dialog.locator('input[placeholder="device mRID, a UUID"]')
    expect(mrid).to_have_value('7d1a2b3c-0000-4000-8000-000000000001')      # the fake's reading alias of this device
    assert chips(dialog) == ['openfmb', 'solarmodule', 'SolarControlProfile', '7d1a2b3c-0000-4000-8000-000000000001']
    expect(dialog).to_contain_text("the device's mRID")
    import json
    assert json.loads(dialog.locator('input[placeholder^=\'{"mrid"\']').input_value()) == {'mrid': '7d1a2b3c-0000-4000-8000-000000000001'}
    ui.cancel()
