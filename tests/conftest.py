import httpx
import pytest
from fastapi.testclient import TestClient

from resource_config.app import create_app
from resource_config.platform.vui import VUIClient
from resource_config.settings import Settings

from fake_vui import PASSWORD, USER, make_fake_vui


@pytest.fixture
def fake_platform():
    return make_fake_vui()


@pytest.fixture
def settings():
    return Settings(platform_url='http://platform.test', secret_key='test-secret-key-that-is-long-enough', poll_interval=0.5)


@pytest.fixture
def client_factory(fake_platform):
    def factory(settings):
        return VUIClient(settings, transport=httpx.ASGITransport(app=fake_platform))
    return factory


@pytest.fixture
async def vui(settings, client_factory):
    client = client_factory(settings)
    await client.login(USER, PASSWORD)
    yield client
    await client.close()


@pytest.fixture
def ui(settings, client_factory):
    app = create_app(settings, client_factory=client_factory, poll=False)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def logged_in(ui):
    response = ui.post('/api/login', json={'username': USER, 'password': PASSWORD})
    assert response.status_code == 200, response.text
    return ui
