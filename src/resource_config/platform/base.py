"""What the UI asks of a platform, independent of which web API answers."""
from __future__ import annotations

import csv
import hashlib
import io
import json
from dataclasses import dataclass, field
from typing import Any, Protocol

CONFIG_TYPES = ('json', 'csv', 'raw')


class PlatformError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


class AuthError(PlatformError):
    def __init__(self, message: str = 'Not authorized'):
        super().__init__(message, 401)


@dataclass
class ConfigEntry:
    """One config store entry as the UI holds it: the stored text, its type, the parsed value and a content hash."""
    identity: str
    name: str
    type: str                      # json | csv | raw
    text: str                      # the stored text
    data: Any = None               # parsed: dict/list for json, list[dict] for csv, the text for raw
    etag: str | None = None        # the platform's validator when it sends one, else our hash
    modified: str | None = None    # ISO 8601 when the platform sends it

    @classmethod
    def from_text(cls, identity: str, name: str, text: str, declared_type: str | None = None,
                  etag: str | None = None, modified: str | None = None) -> 'ConfigEntry':
        kind, data = parse_config_text(text, declared_type)
        return cls(identity, name, kind, text, data, etag or content_hash(kind, text), modified)

    @property
    def hash(self) -> str:
        return content_hash(self.type, self.text)


def content_hash(kind: str, text: str) -> str:
    """The same validator the VUI metadata plan defines: a hash over the stored type and text."""
    return '"' + hashlib.sha256(f'{kind}\n{text}'.encode('utf-8')).hexdigest()[:32] + '"'


def parse_config_text(text: str, declared_type: str | None = None) -> tuple[str, Any]:
    """Decide what a stored text is when the platform does not say: JSON if it parses, CSV if it has a header row
    and every row the same width, raw otherwise. A declared type (from a metadata header or the caller) wins."""
    if declared_type == 'json' or declared_type is None:
        try:
            return 'json', json.loads(text)
        except (ValueError, TypeError):
            if declared_type == 'json':
                return 'json', None
    if declared_type == 'csv' or (declared_type is None and looks_like_csv(text)):
        rows = list(csv.DictReader(io.StringIO(text)))
        return 'csv', rows
    return 'raw', text


def looks_like_csv(text: str) -> bool:
    lines = [l for l in text.splitlines() if l.strip()]
    if len(lines) < 2 or ',' not in lines[0]:
        return False
    try:
        rows = list(csv.reader(io.StringIO('\n'.join(lines[:50]))))
    except csv.Error:
        return False
    widths = {len(r) for r in rows}
    return len(widths) == 1 and len(rows[0]) > 1


def serialize_config(kind: str, data: Any) -> str:
    """The stored text for a value the UI edited."""
    if kind == 'json':
        return json.dumps(data, indent=2, sort_keys=False)
    if kind == 'csv':
        if isinstance(data, str):
            return data
        rows = list(data or [])
        out = io.StringIO()
        if rows:
            writer = csv.DictWriter(out, fieldnames=list(rows[0].keys()), lineterminator='\n')
            writer.writeheader()
            writer.writerows(rows)
        return out.getvalue()
    return data if isinstance(data, str) else json.dumps(data)


@dataclass
class AgentInfo:
    identity: str
    name: str | None = None         # the installed package or agent name
    uuid: str | None = None
    tag: str | None = None
    priority: str | None = None
    running: bool | None = None
    enabled: bool | None = None
    pid: int | None = None
    exit_code: int | None = None
    hidden: bool = False            # a platform service rather than an installed agent
    health: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}


class PlatformClient(Protocol):
    """Everything the UI does to a platform. Implementations raise PlatformError (AuthError for 401/403)."""
    dialect: str
    platform: str | None

    async def login(self, username: str, password: str) -> None: ...
    async def close(self) -> None: ...
    async def list_platforms(self) -> list[str]: ...
    async def list_agents(self) -> list[AgentInfo]: ...
    async def set_running(self, identity: str, running: bool, restart: bool = False) -> None: ...
    async def set_enabled(self, identity: str, enabled: bool, priority: str = '50') -> None: ...
    async def list_stores(self) -> list[str]: ...
    async def list_configs(self, identity: str) -> list[str]: ...
    async def get_config(self, identity: str, name: str, known: 'ConfigEntry | None' = None) -> 'ConfigEntry | None': ...
    async def put_config(self, identity: str, name: str, kind: str, text: str) -> None: ...
    async def delete_config(self, identity: str, name: str) -> None: ...
    async def rpc(self, identity: str, method: str, *args, **kwargs) -> Any: ...
    def capabilities(self) -> dict: ...
