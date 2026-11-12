"""Browser tests: the UI in Chromium over the in-process fake platform.

The server is the one `tests/dev_server.py` runs, started here in a thread on a free port; `/dev/login` signs the
browser in without the form. Every test gets its own browser context, so layout preferences and the session do not
leak between tests. The fake platform's store is shared for the session: tests that write create their own objects.

Needs the `dev` extra and a browser: `python -m playwright install chromium`. Without pytest-playwright installed
this directory collects nothing, so `pytest` still runs the API tests."""
import asyncio
import re
import socket
import sys
import threading
import time
from pathlib import Path
from urllib.parse import quote

import pytest

try:
    from playwright.sync_api import Locator, Page, expect
except ImportError:  # pragma: no cover - the browser extra is optional
    collect_ignore_glob = ['test_*.py']

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # tests/: fake_vui and dev_server
from fake_vui import PASSWORD, USER  # noqa: E402,F401


def pytest_collection_modifyitems(items):
    here = Path(__file__).parent
    for item in items:
        if here in Path(str(item.fspath)).parents:
            item.add_marker(pytest.mark.browser)


@pytest.fixture(scope='session')
def ui_url():
    """The UI served over the fake platform, for the whole session."""
    import uvicorn
    from dev_server import app
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='warning'))
    thread = threading.Thread(target=lambda: asyncio.run(server.serve()), daemon=True)   # serve(), not run(): no signal handlers off the main thread
    thread.start()
    deadline = time.monotonic() + 15
    while not server.started:
        if time.monotonic() > deadline or not thread.is_alive():
            raise RuntimeError('the UI server did not start')
        time.sleep(0.05)
    yield f'http://127.0.0.1:{port}'
    server.should_exit = True
    thread.join(5)


class UI:
    """The signed-in UI in one page, with the few helpers every test wants."""

    def __init__(self, page: 'Page', url: str):
        self.page = page
        self.url = url

    def go(self, hash_: str) -> None:
        """Switch to a page by its hash route and wait for the main pane to render."""
        self.page.evaluate('h => { location.hash = h; }', hash_)
        self.rendered()

    def open(self, hash_: str) -> None:
        """Load the UI afresh at a route: a real reload, since a hash-only change would stay in the same document."""
        self.page.goto(f'{self.url}/ui/{hash_}')
        self.page.reload()
        self.rendered()

    def rendered(self) -> None:
        """Wait for a page's content: a card or an empty-state, not the shell's initial "Loading…" placeholder."""
        self.page.locator('#main .rc, #main .card, #main .empty').filter(has_not_text='Loading').first.wait_for()

    def button(self, label: str, within: 'Locator | None' = None) -> 'Locator':
        """A button by its exact label. Buttons are spans with role=button."""
        return (within or self.page).get_by_role('button', name=label, exact=True)

    @property
    def dialog(self) -> 'Locator':
        return self.page.locator('.dialog')

    def cancel(self) -> None:
        self.button('Cancel', self.dialog).click()
        expect(self.dialog).to_have_count(0)

    def toast(self, text: str) -> 'Locator':
        return self.page.locator('.toast', has_text=text)

    def expand_advanced(self) -> None:
        """Open every collapsed section in the main pane (the advanced fields live there)."""
        for head in self.page.locator('#main .rsec.col h5').all():
            if head.locator('.tri').inner_text().strip() == '▸':
                head.click()

    def pseudo_content(self, locator: 'Locator', pseudo: str) -> str:
        return locator.evaluate('(e, p) => getComputedStyle(e, p).content', pseudo)


@pytest.fixture
def ui(page: 'Page', ui_url: str):
    """A page signed in through /dev/login, on Resources. Fails the test if the page raised an uncaught error."""
    errors: list[str] = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_viewport_size({'width': 1400, 'height': 900})
    page.goto(f'{ui_url}/dev/login?next={quote("/ui/#/resources", safe="")}')
    page.locator('#main .rc').first.wait_for()
    yield UI(page, ui_url)
    assert errors == [], f'uncaught errors in the page: {errors}'


PRODUCT_NAME = re.compile(r'volttron', re.IGNORECASE)
