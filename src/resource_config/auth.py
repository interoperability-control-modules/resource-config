"""Single operator login: the operator logs in with the platform web user's credentials; the backend exchanges them
for platform tokens, keeps them server-side and hands the browser a signed session cookie."""
from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field

from fastapi import HTTPException, Request
from itsdangerous import BadSignature, URLSafeTimedSerializer

from .platform.base import PlatformClient

COOKIE = 'resource_config_session'


@dataclass
class Session:
    sid: str
    user: str
    client: PlatformClient
    created: float = field(default_factory=time.time)


class Sessions:
    def __init__(self, secret_key: str, max_age_seconds: float):
        self._serializer = URLSafeTimedSerializer(secret_key, salt='resource-config-session')
        self._max_age = int(max_age_seconds)
        self._sessions: dict[str, Session] = {}

    def create(self, user: str, client: PlatformClient) -> tuple[Session, str]:
        sid = secrets.token_urlsafe(24)
        session = Session(sid, user, client)
        self._sessions[sid] = session
        return session, self._serializer.dumps(sid)

    def resolve(self, cookie: str | None) -> Session | None:
        if not cookie:
            return None
        try:
            sid = self._serializer.loads(cookie, max_age=self._max_age)
        except BadSignature:
            return None
        return self._sessions.get(sid)

    async def drop(self, cookie: str | None) -> None:
        session = self.resolve(cookie)
        if session:
            self._sessions.pop(session.sid, None)
            await session.client.close()

    def any(self) -> Session | None:
        """The most recent live session, for background work (the store poller) that needs platform credentials."""
        return max(self._sessions.values(), key=lambda s: s.created) if self._sessions else None

    @property
    def max_age(self) -> int:
        return self._max_age


def current_session(request: Request) -> Session:
    session = request.app.state.sessions.resolve(request.cookies.get(COOKIE))
    if session is None:
        raise HTTPException(401, 'Not logged in')
    return session
