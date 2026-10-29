from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from ..auth import COOKIE, current_session
from ..platform import make_client
from ..platform.base import AuthError, PlatformError

router = APIRouter(tags=['session'])


class Login(BaseModel):
    username: str
    password: str


@router.post('/login')
async def login(body: Login, request: Request, response: Response):
    settings = request.app.state.settings
    client = request.app.state.client_factory(settings)
    try:
        await client.login(body.username, body.password)
    except AuthError as e:
        await client.close()
        raise HTTPException(401, str(e))
    except PlatformError as e:
        await client.close()
        raise HTTPException(e.status if e.status >= 400 else 502, str(e))
    session, cookie = request.app.state.sessions.create(body.username, client)
    response.set_cookie(COOKIE, cookie, httponly=True, samesite='strict', max_age=request.app.state.sessions.max_age,
                        secure=request.url.scheme == 'https')
    request.app.state.store_dirty.set()
    return {'user': session.user, **client.capabilities()}


@router.post('/logout')
async def logout(request: Request, response: Response):
    await request.app.state.sessions.drop(request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE)
    return {'ok': True}


@router.get('/session')
async def session_info(request: Request):
    session = current_session(request)
    return {'user': session.user, **session.client.capabilities(), 'store_version': request.app.state.store.version}
