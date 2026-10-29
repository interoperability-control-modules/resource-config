"""Platform clients: one interface, two dialects (VUI for VOLTTRON's web service, derhost for der-control-fastlib)."""
from .base import AgentInfo, AuthError, ConfigEntry, PlatformClient, PlatformError  # noqa: F401
from .vui import VUIClient  # noqa: F401
from .derhost import DerhostClient  # noqa: F401


def make_client(settings) -> PlatformClient:
    if settings.dialect == 'derhost':
        return DerhostClient(settings)
    return VUIClient(settings)
