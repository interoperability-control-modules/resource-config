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
    return build_model(store.snapshot(), request.app.state.settings, agents)
