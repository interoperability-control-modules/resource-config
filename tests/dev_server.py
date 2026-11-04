"""Run the UI against the in-process fake platform, for development and browser checks.

    python tests/dev_server.py [port]

Adds one route that the product does not have: GET /dev/login signs in as the fake platform's admin and redirects to
the UI, so a headless browser can load a page without filling the login form."""
import asyncio
import sys
from pathlib import Path

import httpx
import uvicorn
from fastapi import Request
from fastapi.responses import RedirectResponse

sys.path.insert(0, str(Path(__file__).parent))
from fake_vui import PASSWORD, USER, make_fake_vui  # noqa: E402

from resource_config.app import create_app  # noqa: E402
from resource_config.auth import COOKIE  # noqa: E402
from resource_config.platform.vui import VUIClient  # noqa: E402
from resource_config.settings import Settings  # noqa: E402

fake = make_fake_vui()
settings = Settings(platform_url='http://platform.test', secret_key='dev-secret-key-not-for-production', poll_interval=2)
app = create_app(settings, client_factory=lambda s: VUIClient(s, transport=httpx.ASGITransport(app=fake)))


@app.get('/dev/login', include_in_schema=False)
async def dev_login(request: Request):
    client = app.state.client_factory(settings)
    await client.login(USER, PASSWORD)
    session, cookie = app.state.sessions.create(USER, client)
    response = RedirectResponse(request.query_params.get('next', '/ui/'))
    response.set_cookie(COOKIE, cookie, httponly=True, samesite='strict')
    return response


@app.get('/dev/check', include_in_schema=False)
async def dev_check():
    # A page that drives the UI in an iframe and prints what it finds, for headless browser checks.
    from fastapi.responses import HTMLResponse
    return HTMLResponse((Path(__file__).parent / 'dev_check.html').read_text())


if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=int(sys.argv[1]) if len(sys.argv) > 1 else 8600, log_level='warning')
