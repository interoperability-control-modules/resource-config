"""The platform's config store as the UI sees it: a snapshot of every entry, refreshed by polling, with change
events for the browser. Change detection compares content hashes, since neither platform tells a third party when
an entry changes (the VUI metadata plan adds validators that make the poll cheaper; they are used when present)."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from .platform.base import ConfigEntry, PlatformClient, PlatformError, serialize_config

_log = logging.getLogger(__name__)


class Store:
    def __init__(self):
        self.entries: dict[tuple[str, str], ConfigEntry] = {}
        self.version = 0
        self.last_refresh: float | None = None
        self.last_error: str | None = None
        self._listeners: set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()

    # ---------------------------------------------------------------- reading
    def snapshot(self) -> dict:
        out: dict[str, dict[str, Any]] = {}
        for (identity, name), entry in sorted(self.entries.items()):
            out.setdefault(identity, {})[name] = {'type': entry.type, 'etag': entry.etag, 'modified': entry.modified,
                                                   'data': entry.data}
        return {'version': self.version, 'refreshed': self.last_refresh, 'error': self.last_error, 'identities': out}

    def get(self, identity: str, name: str) -> ConfigEntry | None:
        return self.entries.get((identity, name))

    def entries_of(self, identity: str) -> dict[str, ConfigEntry]:
        return {name: e for (i, name), e in self.entries.items() if i == identity}

    # ---------------------------------------------------------------- refreshing
    async def refresh(self, client: PlatformClient) -> list[dict]:
        """Re-read every entry and return the change events. One request per entry: the platform offers no cheaper
        way until it sends validators, which get_config honours when present."""
        async with self._lock:
            events: list[dict] = []
            try:
                identities = await client.list_stores()
                seen: set[tuple[str, str]] = set()
                for identity in identities:
                    listing = await client.list_configs_with_metadata(identity) if hasattr(client, 'list_configs_with_metadata') else None
                    names = list(listing) if listing is not None else await client.list_configs(identity)
                    for name in names:
                        key = (identity, name)
                        seen.add(key)
                        old = self.entries.get(key)
                        # A listing with validators settles "unchanged" without a request per entry.
                        if listing is not None and old is not None and old.etag and listing[name].get('etag') == old.etag:
                            continue
                        try:
                            entry = await client.get_config(identity, name, known=old)
                        except PlatformError as e:
                            _log.warning('could not read %s/%s: %s', identity, name, e)
                            continue
                        if entry is None:          # 304: unchanged
                            continue
                        if old is None:
                            events.append({'kind': 'added', 'identity': identity, 'name': name})
                        elif old.hash != entry.hash:
                            events.append({'kind': 'changed', 'identity': identity, 'name': name})
                        self.entries[key] = entry
                for key in [k for k in self.entries if k not in seen]:
                    identity, name = key
                    del self.entries[key]
                    events.append({'kind': 'removed', 'identity': identity, 'name': name})
                self.last_error = None
            except PlatformError as e:
                self.last_error = str(e)
                _log.warning('store refresh failed: %s', e)
            self.last_refresh = time.time()
            if events:
                self.version += 1
                self._notify({'type': 'store', 'version': self.version, 'events': events})
            return events

    # ---------------------------------------------------------------- writing
    async def put(self, client: PlatformClient, identity: str, name: str, kind: str, data: Any,
                  text: str | None = None) -> ConfigEntry:
        text = text if text is not None else serialize_config(kind, data)
        await client.put_config(identity, name, kind, text)
        entry = await client.get_config(identity, name)
        key = (identity, name)
        kind_event = 'changed' if key in self.entries else 'added'
        self.entries[key] = entry
        self.version += 1
        self._notify({'type': 'store', 'version': self.version, 'events': [{'kind': kind_event, 'identity': identity, 'name': name}]})
        return entry

    async def delete(self, client: PlatformClient, identity: str, name: str) -> None:
        await client.delete_config(identity, name)
        if self.entries.pop((identity, name), None) is not None:
            self.version += 1
            self._notify({'type': 'store', 'version': self.version, 'events': [{'kind': 'removed', 'identity': identity, 'name': name}]})

    # ---------------------------------------------------------------- events
    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._listeners.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._listeners.discard(queue)

    def _notify(self, message: dict) -> None:
        for queue in list(self._listeners):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                self._listeners.discard(queue)

    async def run_poller(self, sessions, interval: float, stop: asyncio.Event) -> None:
        """Poll with the credentials of the most recent login; idle while nobody is logged in."""
        while not stop.is_set():
            session = sessions.any()
            if session is not None:
                try:
                    await self.refresh(session.client)
                except Exception as e:  # the poller must survive anything
                    _log.exception('store poller: %s', e)
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass
