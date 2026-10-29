"""Wrappers over the interoperability service's RPCs. Only the service and the Resource Bridge are reachable; the
platform's own services are never proxied (the web service refuses them anyway)."""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..auth import Session, current_session
from ..platform.base import PlatformError

router = APIRouter(tags=['interop'])


class Resolve(BaseModel):
    uai: list[str] | str
    as_format: str | None = None
    direction: str = 'read'
    strict: bool = False


class Call(BaseModel):
    identity: str
    method: str
    args: list[Any] = []
    kwargs: dict[str, Any] = {}


@router.post('/interop/resolve')
async def resolve(body: Resolve, request: Request, session: Session = Depends(current_session)):
    settings = request.app.state.settings
    uai = body.uai if isinstance(body.uai, list) else [s for s in body.uai.split('/') if s]
    try:
        return await session.client.rpc(settings.presentation_identity, 'resolve', uai, body.as_format, body.strict,
                                        None, body.direction)
    except PlatformError as e:
        raise HTTPException(e.status, str(e))


@router.post('/interop/rpc')
async def call(body: Call, request: Request, session: Session = Depends(current_session)):
    settings = request.app.state.settings
    if body.identity not in (settings.presentation_identity, settings.resource_bridge_identity):
        raise HTTPException(403, 'only the interoperability service and the Resource Bridge may be called')
    try:
        return await session.client.rpc(body.identity, body.method, *body.args, **body.kwargs)
    except PlatformError as e:
        raise HTTPException(e.status, str(e))
