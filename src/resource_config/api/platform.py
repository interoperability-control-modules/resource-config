from fastapi import APIRouter, Depends, HTTPException

from ..auth import Session, current_session
from ..platform.base import PlatformError

router = APIRouter(tags=['platform'])

AGENT_TYPES = [('platform-driver', 'driver'), ('platform_driver', 'driver'), ('interoperability', 'service'), ('presentation', 'service'),
               ('resource-bridge', 'resource bridge'), ('resource_bridge', 'resource bridge'), ('bus-adapter', 'bus adapter'),
               ('bus_adapter', 'bus adapter'), ('realtime-control', 'rtc'), ('rt_control', 'rtc'), ('historian', 'historian'),
               ('scheduler', 'scheduler'), ('listener', 'listener'), ('web', 'web')]


def agent_type(info) -> str:
    text = f'{info.name or ""} {info.identity}'.lower()
    for needle, label in AGENT_TYPES:
        if needle in text:
            return label
    return 'platform' if info.hidden else 'agent'


async def list_agents(session: Session) -> list[dict]:
    agents = await session.client.list_agents()
    return [{**a.as_dict(), 'type': agent_type(a)} for a in agents]


@router.get('/platform')
async def platform_info(session: Session = Depends(current_session)):
    return session.client.capabilities()


@router.get('/agents')
async def agents(session: Session = Depends(current_session)):
    try:
        return await list_agents(session)
    except PlatformError as e:
        raise HTTPException(e.status, str(e))


@router.post('/agents/{identity}/{action}')
async def lifecycle(identity: str, action: str, session: Session = Depends(current_session)):
    try:
        if action == 'start':
            await session.client.set_running(identity, True)
        elif action == 'stop':
            await session.client.set_running(identity, False)
        elif action == 'restart':
            await session.client.set_running(identity, True, restart=True)
        elif action == 'enable':
            await session.client.set_enabled(identity, True)
        elif action == 'disable':
            await session.client.set_enabled(identity, False)
        else:
            raise HTTPException(404, f'unknown action {action}')
    except PlatformError as e:
        raise HTTPException(e.status, str(e))
    return {'ok': True}
