"""Settings: where the platform is, how to reach it, and how this process serves."""
from __future__ import annotations

import json
import os
import secrets
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

ENV_PREFIX = 'RESOURCE_CONFIG_'


class Settings(BaseModel):
    """Read from a JSON file named by ``RESOURCE_CONFIG_FILE`` and then from ``RESOURCE_CONFIG_<FIELD>`` environment
    variables, which win. Nothing here is a local path of one machine; a deployment names its platform explicitly."""
    platform_url: str = Field(default='https://localhost:8443', description='Base URL of the platform web service.')
    platform_name: str | None = Field(default=None, description='VUI platform name; default: the first the web service lists.')
    dialect: Literal['vui', 'derhost'] = Field(default='vui', description='vui: VOLTTRON web service; derhost: der-control-fastlib.')
    verify_tls: bool | str = Field(default=True, description='True, False, or the path of a CA bundle.')
    secret_key: str = Field(default_factory=lambda: secrets.token_urlsafe(32),
                            description='Signs the session cookie. Generated per start when unset, so sessions do not survive a restart.')
    session_hours: float = Field(default=12.0, description='Lifetime of a login session.')
    poll_interval: float = Field(default=5.0, ge=0.5, description='Seconds between store polls for change detection.')
    host: str = '127.0.0.1'
    port: int = 8600
    presentation_identity: str = 'platform.presentation'
    driver_identity: str = 'platform.driver'
    resource_bridge_identity: str = 'platform.resource_bridge'
    bus_adapter_identity: str = 'platform.bus_adapter'
    request_timeout: float = Field(default=15.0, description='Seconds to wait for one platform request.')

    @classmethod
    def load(cls, path: str | os.PathLike | None = None, environ: dict | None = None) -> 'Settings':
        environ = os.environ if environ is None else environ
        values: dict = {}
        path = path or environ.get(f'{ENV_PREFIX}FILE')
        if path:
            values.update(json.loads(Path(path).read_text(encoding='utf-8')))
        for name, field in cls.model_fields.items():
            raw = environ.get(f'{ENV_PREFIX}{name.upper()}')
            if raw is None:
                continue
            values[name] = _coerce(raw, field.annotation)
        return cls(**values)


def _coerce(raw: str, annotation):
    text = str(annotation)
    if 'bool' in text and raw.lower() in ('true', 'false', '1', '0', 'yes', 'no'):
        return raw.lower() in ('true', '1', 'yes')
    if annotation in (int, float) or 'int' in text or 'float' in text:
        try:
            return float(raw) if '.' in raw or 'float' in text else int(raw)
        except ValueError:
            return raw
    return raw
