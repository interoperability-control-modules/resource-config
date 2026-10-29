from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..auth import Session, current_session
from ..platform.base import CONFIG_TYPES, PlatformError

router = APIRouter(tags=['store'])


class EntryWrite(BaseModel):
    type: str = 'json'
    data: Any = None            # the parsed value (json: object; csv: rows; raw: text)
    text: str | None = None     # or the stored text verbatim


@router.get('/store')
async def store_snapshot(request: Request, refresh: bool = False, session: Session = Depends(current_session)):
    store = request.app.state.store
    if refresh or store.last_refresh is None:
        await store.refresh(session.client)
    return store.snapshot()


@router.get('/store/{identity}/{name:path}')
async def get_entry(identity: str, name: str, request: Request, session: Session = Depends(current_session)):
    entry = request.app.state.store.get(identity, name)
    if entry is None:
        try:
            entry = await session.client.get_config(identity, name)
        except PlatformError as e:
            raise HTTPException(e.status, str(e))
    return {'identity': entry.identity, 'name': entry.name, 'type': entry.type, 'etag': entry.etag, 'modified': entry.modified,
            'data': entry.data, 'text': entry.text}


@router.put('/store/{identity}/{name:path}')
async def put_entry(identity: str, name: str, body: EntryWrite, request: Request, session: Session = Depends(current_session)):
    if body.type not in CONFIG_TYPES:
        raise HTTPException(400, f'type must be one of {CONFIG_TYPES}')
    try:
        entry = await request.app.state.store.put(session.client, identity, name, body.type, body.data, body.text)
    except PlatformError as e:
        raise HTTPException(e.status, str(e))
    return {'identity': entry.identity, 'name': entry.name, 'type': entry.type, 'etag': entry.etag, 'data': entry.data}


@router.delete('/store/{identity}/{name:path}')
async def delete_entry(identity: str, name: str, request: Request, session: Session = Depends(current_session)):
    try:
        await request.app.state.store.delete(session.client, identity, name)
    except PlatformError as e:
        raise HTTPException(e.status, str(e))
    return {'ok': True}
