from fastapi import APIRouter, Depends, Request

from ..auth import Session, current_session
from ..platform.base import PlatformError
from ..relations import build_model
from .platform import list_agents

router = APIRouter(tags=['model'])


@router.get('/model')
async def model(request: Request, refresh: bool = False, session: Session = Depends(current_session)):
    store = request.app.state.store
    if refresh or store.last_refresh is None:
        await store.refresh(session.client)
    try:
        agents = await list_agents(session)
    except PlatformError as e:
        agents = []
        store.last_error = str(e)
    model = build_model(store.snapshot(), request.app.state.settings, agents)
    await enrich_from_platform(model, session, request.app.state.settings)
    return model


async def enrich_from_platform(model: dict, session: Session, settings) -> None:
    """What only the running agents know: the service's view of formats and every registered transform (bundled
    ones included), and the Resource Bridge's statistics. Each is optional; an agent that is down or lacks the RPC
    leaves its part of the model as the store alone describes it."""
    rpc = session.client.rpc
    try:
        formats = await rpc(settings.presentation_identity, 'list_formats')
        known = {f['name']: f for f in model['formats']}
        for name, info in formats.items():
            f = known.get(name) or {'name': name, 'kind': 'hub' if info.get('hub') else 'other', 'declared': info.get('declared', False), 'standard': 'local', 'resources': [], 'devices': []}
            f.update(live=True, hub=info.get('hub'), universe=info.get('universe'), proto=f.get('proto') or info.get('proto'), scaling=f.get('scaling') or info.get('scaling'),
                     edges_out=info.get('edges_out', []), edges_in=info.get('edges_in', []))
            if info.get('hub'):
                f['kind'] = 'hub'
            elif f.get('proto'):
                f['kind'] = 'bus'
            known[name] = f
        model['formats'] = list(known.values())
        model['formats_live'] = True
    except PlatformError as e:
        model['formats_live'] = False
        model.setdefault('warnings', []).append(f'list_formats: {e}')
    try:
        transforms = await rpc(settings.presentation_identity, 'list_transforms')
        local = {(t['input'], t['output']): t for t in model['transforms']}
        merged = []
        for t in transforms:
            entry = {'input': t['input'], 'output': t['output'], 'kind': t.get('origin', 'local'), 'retention': t.get('retention'),
                     'fields': t.get('fields'), 'unmapped_targets': t.get('unmapped_targets'), 'pattern': (local.get((t['input'], t['output'])) or {}).get('pattern')}
            merged.append(entry)
        model['transforms'] = merged
        model['transforms_live'] = True
    except PlatformError as e:
        model['transforms_live'] = False
        model.setdefault('warnings', []).append(f'list_transforms: {e}')
    try:
        stats = await rpc(settings.resource_bridge_identity, 'statistics')
        for bridge in model['bridges']:
            bridge['stats'] = stats.get(bridge['name'])
        model['statistics_live'] = True
    except PlatformError as e:
        model['statistics_live'] = False
        model.setdefault('warnings', []).append(f'statistics: {e}')
