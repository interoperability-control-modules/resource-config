"""The pending set: entries a multi-entry action produced, applied in dependency order (driver, then service
mappings, then Resource Bridge and bus adapter, then other agents). Kept in memory per process."""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..auth import Session, current_session
from ..platform.base import CONFIG_TYPES, PlatformError

router = APIRouter(tags=['pending'])


class PendingEntry(BaseModel):
    identity: str
    name: str
    type: str = 'json'
    data: Any = None
    text: str | None = None
    delete: bool = False
    summary: str | None = None


def _order(settings):
    return [settings.driver_identity, settings.presentation_identity, settings.resource_bridge_identity, settings.bus_adapter_identity]


@router.get('/pending')
async def pending(request: Request, session: Session = Depends(current_session)):
    return {'entries': [e.model_dump() for e in request.app.state.pending]}


@router.post('/pending')
async def add(entries: list[PendingEntry], request: Request, session: Session = Depends(current_session)):
    for e in entries:
        if e.type not in CONFIG_TYPES:
            raise HTTPException(400, f'type must be one of {CONFIG_TYPES}')
    current = request.app.state.pending
    current[:] = [c for c in current if not any(c.identity == e.identity and c.name == e.name for e in entries)] + entries
    return {'entries': [e.model_dump() for e in current]}


@router.delete('/pending')
async def discard(request: Request, session: Session = Depends(current_session)):
    request.app.state.pending.clear()
    return {'entries': []}


@router.delete('/pending/{identity}/{name:path}')
async def discard_one(identity: str, name: str, request: Request, session: Session = Depends(current_session)):
    request.app.state.pending[:] = [e for e in request.app.state.pending if not (e.identity == identity and e.name == name)]
    return {'entries': [e.model_dump() for e in request.app.state.pending]}


@router.post('/pending/apply')
async def apply(request: Request, session: Session = Depends(current_session)):
    settings, store = request.app.state.settings, request.app.state.store
    order = _order(settings)
    rank = lambda e: (order.index(e.identity) if e.identity in order else len(order), 0 if e.name.startswith('registry') else 1, e.name)
    applied, failed = [], None
    for entry in sorted(request.app.state.pending, key=rank):
        try:
            if entry.delete:
                await store.delete(session.client, entry.identity, entry.name)
            else:
                await store.put(session.client, entry.identity, entry.name, entry.type, entry.data, entry.text)
            applied.append({'identity': entry.identity, 'name': entry.name})
        except PlatformError as e:
            failed = {'identity': entry.identity, 'name': entry.name, 'error': str(e)}
            break
    request.app.state.pending[:] = [e for e in request.app.state.pending if {'identity': e.identity, 'name': e.name} not in applied]
    if failed:
        raise HTTPException(502, {'applied': applied, 'failed': failed})
    return {'applied': applied}
