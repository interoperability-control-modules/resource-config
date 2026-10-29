from fastapi import APIRouter

from . import auth, catalog, interop, model, pending, platform, store, ws


def api_router() -> APIRouter:
    router = APIRouter(prefix='/api')
    for module in (auth, platform, store, catalog, model, interop, pending):
        router.include_router(module.router)
    return router


__all__ = ['api_router', 'ws']
