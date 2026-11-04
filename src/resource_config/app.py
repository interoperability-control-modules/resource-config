"""The FastAPI application: API under /api, store events on /ws, the browser application under /ui."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .api import api_router, ws
from .auth import Sessions
from .catalog import build_catalog
from .platform import make_client
from .settings import Settings
from .store import Store

STATIC = Path(__file__).parent / 'static'
_log = logging.getLogger(__name__)


def create_app(settings: Settings | None = None, client_factory=make_client, poll: bool = True) -> FastAPI:
    settings = settings or Settings.load()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        stop = asyncio.Event()
        app.state.store_dirty = asyncio.Event()
        task = asyncio.create_task(app.state.store.run_poller(app.state.sessions, settings.poll_interval, stop)) if poll else None
        try:
            yield
        finally:
            stop.set()
            if task:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
            await app.state.sessions.close_all()

    app = FastAPI(title='resource-config', version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.client_factory = client_factory
    app.state.sessions = Sessions(settings.secret_key, settings.session_hours * 3600)
    app.state.store = Store()
    app.state.catalog = build_catalog()
    app.state.pending = []
    app.state.store_dirty = asyncio.Event()
    app.include_router(api_router())
    app.add_api_websocket_route('/ws', ws.store_events)
    app.mount('/ui', StaticFiles(directory=str(STATIC), html=True), name='ui')

    @app.get('/', include_in_schema=False)
    async def root():
        return RedirectResponse('/ui/')

    return app
