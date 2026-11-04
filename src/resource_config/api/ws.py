"""Store change events to the browser."""
import asyncio

from fastapi import WebSocket, WebSocketDisconnect

from ..auth import COOKIE


async def store_events(websocket: WebSocket):
    sessions = websocket.app.state.sessions
    # Accept before refusing: a close before accept reaches the browser as a bare failure (and is logged as a 403),
    # while a close code after accept tells the page the session is gone so it stops reconnecting and shows the login.
    await websocket.accept()
    if sessions.resolve(websocket.cookies.get(COOKIE)) is None:
        await websocket.close(code=4401, reason='not signed in')
        return
    store = websocket.app.state.store
    queue = store.subscribe()
    # The page never sends anything, but only a pending receive() notices the connection going away (the browser
    # leaving, or uvicorn closing it at shutdown). Without it this task lingered until its next send, which held the
    # server's shutdown up for as long as the ping interval.
    gone = asyncio.create_task(_until_disconnect(websocket))
    try:
        await websocket.send_json({'type': 'hello', 'version': store.version})
        while not gone.done():
            getter = asyncio.create_task(queue.get())
            done, _ = await asyncio.wait({getter, gone}, timeout=30, return_when=asyncio.FIRST_COMPLETED)
            if getter in done:
                message = getter.result()
            else:
                getter.cancel()    # Queue.get loses nothing when cancelled before it returns
                if gone in done:
                    break
                message = {'type': 'ping', 'version': store.version}
            await websocket.send_json(message)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        gone.cancel()
        store.unsubscribe(queue)


async def _until_disconnect(websocket: WebSocket) -> None:
    try:
        while True:
            if (await websocket.receive())['type'] == 'websocket.disconnect':
                return
    except (WebSocketDisconnect, RuntimeError):
        return
