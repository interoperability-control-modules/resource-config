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
