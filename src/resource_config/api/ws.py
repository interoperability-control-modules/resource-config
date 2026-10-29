"""Store change events to the browser."""
import asyncio

from fastapi import WebSocket, WebSocketDisconnect

from ..auth import COOKIE


async def store_events(websocket: WebSocket):
    sessions = websocket.app.state.sessions
    if sessions.resolve(websocket.cookies.get(COOKIE)) is None:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    store = websocket.app.state.store
    queue = store.subscribe()
    try:
        await websocket.send_json({'type': 'hello', 'version': store.version})
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=30)
            except asyncio.TimeoutError:
                message = {'type': 'ping', 'version': store.version}
            await websocket.send_json(message)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        store.unsubscribe(queue)
