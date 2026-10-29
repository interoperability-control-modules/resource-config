"""Discover: run the service's discovery RPC and turn its answer into pending entries. The service returns the
driver's registry rows and device entry and a service-config *fragment*; the fragment is merged here into the
current service configuration so the pending set holds whole entries."""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..auth import Session, current_session
from ..platform.base import PlatformError
from ..relations import topic_of, uai_of

router = APIRouter(tags=['discover'])


class Discover(BaseModel):
    protocol: str
    options: dict[str, Any] = {}


def merge_fragment(current: dict | None, fragment: dict) -> dict:
    """The service configuration with a generator's fragment folded in: formats and transforms by key, mappings by
    UAI (a generator re-run replaces its own entries)."""
    data = dict(current or {})
    data['formats'] = {**(data.get('formats') or {}), **(fragment.get('formats') or {})}
    transforms = [t for t in (data.get('transforms') or [])
                  if not any(t.get('input_format') == n.get('input_format') and t.get('output_format') == n.get('output_format') for n in fragment.get('transforms') or [])]
    data['transforms'] = transforms + list(fragment.get('transforms') or [])
    new_topics = {topic_of(uai_of(m.get('uai'))) for m in fragment.get('mappings') or []}
    data['mappings'] = [m for m in (data.get('mappings') or []) if topic_of(uai_of(m.get('uai'))) not in new_topics] + list(fragment.get('mappings') or [])
    return data


@router.post('/discover')
async def discover(body: Discover, request: Request, session: Session = Depends(current_session)):
    settings, store = request.app.state.settings, request.app.state.store
    if store.last_refresh is None:
        await store.refresh(session.client)       # the fragment merges into the service configuration as it stands
    try:
        result = await session.client.rpc(settings.presentation_identity, 'discover', body.protocol, body.options)
    except PlatformError as e:
        raise HTTPException(e.status, str(e))
    entries = []
    for entry in result.get('entries', []):
        if 'fragment' in entry:
            current = store.get(entry['identity'], entry['name'])
            merged = merge_fragment(current.data if current and isinstance(current.data, dict) else None, entry['fragment'])
            entries.append({'identity': entry['identity'], 'name': entry['name'], 'type': 'json', 'data': merged,
                            'summary': f"format {', '.join((entry['fragment'].get('formats') or {}).keys())}, {len(entry['fragment'].get('transforms') or [])} transforms, {len(entry['fragment'].get('mappings') or [])} mappings"})
        else:
            summary = f"{len(entry.get('data') or [])} points" if entry.get('type') == 'csv' else 'device entry'
            entries.append({**entry, 'summary': summary})
    return {**{k: v for k, v in result.items() if k != 'entries'}, 'entries': entries}
