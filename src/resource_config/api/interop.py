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


class Chain(BaseModel):
    input_format: str
    output_format: str
    fields: list[str] | None = None


class Pattern(BaseModel):
    pattern: Any
    input_format: str | None = None


@router.post('/interop/chain_report')
async def chain_report(body: Chain, request: Request, session: Session = Depends(current_session)):
    try:
        return await session.client.rpc(request.app.state.settings.presentation_identity, 'chain_report', body.input_format, body.output_format, body.fields)
    except PlatformError as e:
        raise HTTPException(e.status, str(e))


@router.post('/interop/describe_transform')
async def describe_transform(body: Chain, request: Request, session: Session = Depends(current_session)):
    try:
        return await session.client.rpc(request.app.state.settings.presentation_identity, 'describe_transform', body.input_format, body.output_format)
    except PlatformError as e:
        raise HTTPException(e.status, str(e))


@router.post('/interop/compile_pattern')
async def compile_pattern(body: Pattern, request: Request, session: Session = Depends(current_session)):
    try:
        return await session.client.rpc(request.app.state.settings.presentation_identity, 'compile_pattern', body.pattern, body.input_format)
    except PlatformError as e:
        raise HTTPException(e.status, str(e))


class Transforms(BaseModel):
    texts: list[str]
    missing_reference: str = 'hold'


def _transform_tools():
    try:
        from icm.transforms import UnknownFunction, compile_value_transform, registry
    except ImportError as e:                                                   # pragma: no cover - a UI without the library
        raise HTTPException(503, f'icm-lib-transforms is not installed beside the UI: {e}')
    return UnknownFunction, compile_value_transform, registry


@router.post('/interop/validate_transforms')
async def validate_transforms(body: Transforms, request: Request, session: Session = Depends(current_session)):
    """Compile each registry Transform cell with the library the driver framework uses, so a cell is validated exactly as
    the driver will read it: one function call or a transform(...) sequence. Per text: ``ok``, the functions it calls,
    the other points it references, its result type, the functions without an inverse, whether it defines the point's
    value from other registers, or the error."""
    UnknownFunction, compile_value_transform, _ = _transform_tools()
    out = {}
    for text in dict.fromkeys(body.texts):
        try:
            t = compile_value_transform(text, missing_reference=body.missing_reference)
        except UnknownFunction as e:
            out[text] = {'ok': False, 'error': str(e), 'unknown_function': e.name}
        except ValueError as e:
            out[text] = {'ok': False, 'error': str(e)}
        else:
            out[text] = {'ok': True, 'functions': list(t.functions), 'references': sorted(t.references),
                         'result_type': t.result_type.__name__ if t.result_type else None, 'invertible': t.invertible,
                         'non_invertible': list(t.non_invertible), 'defines_value': t.defines_value, 'fidelity': t.fidelity}
    return out


@router.get('/interop/transform_functions')
async def transform_functions(request: Request, session: Session = Depends(current_session)):
    """Every function a Transform cell may call, with its aliases, the first line of its documentation, the type it
    yields and its fidelity: what an editor offers as completions."""
    _, _, registry = _transform_tools()
    import inspect
    out = []
    for entry in registry.entries():
        doc = inspect.getdoc(entry.factory) or ''
        try:
            signature = str(inspect.signature(entry.factory))
        except (TypeError, ValueError):
            signature = '(...)'
        out.append({'name': entry.name, 'aliases': list(entry.aliases), 'signature': signature,
                    'doc': doc.strip().splitlines()[0] if doc.strip() else '', 'fidelity': entry.fidelity,
                    'result_type': entry.result_type.__name__ if entry.result_type else None, 'package': entry.package})
    return out


@router.post('/interop/rpc')
async def call(body: Call, request: Request, session: Session = Depends(current_session)):
    settings = request.app.state.settings
    if body.identity not in (settings.presentation_identity, settings.resource_bridge_identity):
        raise HTTPException(403, 'only the interoperability service and the Resource Bridge may be called')
    try:
        return await session.client.rpc(body.identity, body.method, *body.args, **body.kwargs)
    except PlatformError as e:
        raise HTTPException(e.status, str(e))
