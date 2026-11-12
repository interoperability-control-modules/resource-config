"""The shell: sign-in, tabs, status bar, and the product-neutral wording of everything drawn."""
import re
from urllib.parse import quote

from playwright.sync_api import expect

from conftest import PASSWORD, PRODUCT_NAME, USER


def test_login_form_signs_in(page, ui_url):
    page.goto(f'{ui_url}/ui/')
    expect(page).to_have_title('Interoperability Control · Configure')
    login = page.locator('#login')
    expect(login).to_be_visible()
    page.fill('#loginform [name=username]', USER)
    page.fill('#loginform [name=password]', 'not-the-password')
    page.click('#loginform button[type=submit]')
    expect(page.locator('#loginerror')).not_to_be_empty()
    expect(login).to_be_visible()
    page.fill('#loginform [name=password]', PASSWORD)
    page.click('#loginform button[type=submit]')
    expect(login).to_be_hidden()
    expect(page.locator('#topright')).to_contain_text(USER)
    expect(page.locator('#main .rc').first).to_be_visible()


def test_sign_out_returns_to_the_form(ui):
    ui.page.locator('#topright a', has_text='sign out').click()
    expect(ui.page.locator('#login')).to_be_visible()


def test_tabs_navigate_and_highlight(ui):
    for label, route in [('Devices', '#/devices'), ('Formats', '#/formats'), ('Transforms', '#/transforms'),
                         ('Bridges', '#/bridges'), ('Agents', '#/agents'), ('Resources', '#/resources')]:
        ui.page.locator('#tabs a').get_by_text(label, exact=True).click()
        expect(ui.page.locator('#tabs a.on')).to_have_text(label)
        assert ui.page.evaluate('location.hash') == route
    ui.page.locator('#tabs .badge').click()
    assert ui.page.evaluate('location.hash') == '#/pending'
    expect(ui.page.locator('#main .rc')).to_contain_text('Pending changes')


def test_status_bar_reports_the_store_and_refreshes(ui):
    bar = ui.page.locator('#statusbar')
    expect(bar).to_contain_text('store version')
    bar.get_by_text('refresh now').click()
    expect(bar).to_contain_text(re.compile(r'refreshed \d+ s ago'))


def test_pane_rails_collapse_and_reopen(ui):
    ui.page.locator('#side .hd', has_text='collapse').first.click()
    expect(ui.page.locator('#panes')).to_have_class(re.compile(r'\bno-side\b'))
    expect(ui.page.locator('#side .rail .vt')).to_have_text('Resources')
    ui.page.locator('#side .rail span').first.click()
    expect(ui.page.locator('#panes')).not_to_have_class(re.compile(r'\bno-side\b'))


def test_unknown_route_falls_back_to_resources(ui):
    ui.open('#/nonsense')
    expect(ui.page.locator('#tabs a.on')).to_have_text('Resources')


COLLECT_TEXTS = """() => {
  const texts = [document.querySelector('#main').textContent, (document.querySelector('#side') || {}).textContent || ''];
  texts.push(...[...document.querySelectorAll('[placeholder]')].map((e) => e.getAttribute('placeholder')));
  texts.push(...[...document.querySelectorAll('[data-tip]')].map((e) => e.getAttribute('data-tip')));
  texts.push(...[...document.querySelectorAll('[title]')].filter((e) => !e.closest('.grid-table')).map((e) => e.getAttribute('title')));
  return texts.filter(Boolean);
}"""


def test_no_page_text_tooltip_or_title_names_the_product(ui):
    """The data keeps its real names (registry headers, package names); what is drawn never shows the platform's name."""
    leaks = []
    for route in ['#/resources', '#/bridges', '#/formats', '#/transforms', '#/pending',
                  '#/devices?topic=' + quote('matrix/DNP3/served', safe=''), '#/devices?topic=' + quote('matrix/SEP2/client', safe='') + '&edit=1',
                  '#/agents?identity=platform.bus_adapter&edit=1', '#/agents?identity=platform.resource_bridge&edit=1', '#/agents?identity=platform.driver']:
        ui.go(route)
        ui.expand_advanced()
        for text in ui.page.evaluate(COLLECT_TEXTS):
            if PRODUCT_NAME.search(text):
                leaks.append(f'{route}: {" ".join(text.split())[:80]}')
    assert leaks == []
