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
    #: A generator's addition to a shared entry (the service's formats, transforms and mappings). Folded into the entry
    #: as it stands when the set is applied, so two discoveries pending at once both land; ``data`` is only a preview.
    fragment: dict | None = None


def fragment_summary(fragment: dict) -> str:
    return (f"format {', '.join((fragment.get('formats') or {}).keys())}, {len(fragment.get('transforms') or [])} transforms, "
            f"{len(fragment.get('mappings') or [])} mappings")


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
    from .discover import merge_fragment
    current = request.app.state.pending
    for e in entries:
        same = next((c for c in current if c.identity == e.identity and c.name == e.name), None)
        if same is not None and same.fragment and e.fragment:
            # Two generators adding to one entry (the service's config): one pending entry carrying both additions.
            e.fragment = merge_fragment(same.fragment, e.fragment)
            e.data = merge_fragment(same.data if isinstance(same.data, dict) else None, e.fragment)
            e.summary = fragment_summary(e.fragment)
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
    from .discover import merge_fragment
    applied, failed = [], None
    if any(e.fragment for e in request.app.state.pending):
        await store.refresh(session.client)       # a fragment folds into the shared entry as it stands now, not as it stood at discovery
    for entry in sorted(request.app.state.pending, key=rank):
        try:
            if entry.delete:
                await store.delete(session.client, entry.identity, entry.name)
            elif entry.fragment:
                current = store.get(entry.identity, entry.name)
                merged = merge_fragment(current.data if current and isinstance(current.data, dict) else None, entry.fragment)
                await store.put(session.client, entry.identity, entry.name, 'json', merged, None)
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
