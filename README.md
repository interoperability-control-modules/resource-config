# resource-config

The configuration UI of the interoperability control framework: resources, devices, formats, transforms, bridges and agents
on a VOLTTRON platform (through the web service's VUI REST API) or on der-control-fastlib (through its REST API).
The design is `plans_and_analysis/CONFIGURATION_UI_DESIGN_V3.md` in the der_control_modules workspace.

## Run

```bash
pip install -e .
resource-config --platform-url https://platform.example:8443 --platform-name site1
```

Open `http://127.0.0.1:8600/`, sign in with the platform web user (the one `vctl web create-admin` made). The UI
holds no VIP identity of its own: it exchanges the login for the web service's tokens and keeps them server-side.

Settings come from `RESOURCE_CONFIG_<FIELD>` environment variables or a JSON file named by `RESOURCE_CONFIG_FILE`
(or `--config`): `platform_url`, `platform_name`, `dialect` (`vui` or `derhost`), `verify_tls`, `secret_key`,
`session_hours`, `poll_interval`, `host`, `port`, `request_timeout`, and the identities of the service, driver,
Resource Bridge and bus adapter (`presentation_identity`, `driver_identity`, `resource_bridge_identity`,
`bus_adapter_identity`). `platform_name` must equal the platform's `instance-name`; when unset, the first platform the
web service lists is used.

## Setting up a VOLTTRON platform for the UI

A minimal platform (the web service, the Platform Driver with the fake interface, the interoperability service)
covers Resources, Devices, Formats, Transforms, Agents and Pending changes; the Resource Bridge and the Message Bus
Adapter add the Bridges tab and the Activity card; the protocol interfaces and proxies add Discover and real devices.

### 1. Install the platform and the agents in one Python environment

The modular platform installs agents from the environment that runs it, so install everything into one virtual
environment (Python 3.10 or later) before starting the platform.

| Package | Why the UI needs it |
|---|---|
| `volttron-core`, `volttron-lib-zmq`, `volttron-lib-auth` | the platform (ZMQ bus, credential auth) |
| `volttron-lib-web` | the VUI REST API the UI talks to, including its configuration-store endpoints |
| `volttron-platform-driver`, `volttron-lib-base-driver` | devices and registries; the Agents tab's driver form |
| `volttron-lib-fake-driver` | a device with no hardware, enough to exercise the Devices tab |
| `volttron-lib-modbus-driver`, `volttron-lib-dnp3-driver`, `volttron-lib-bacnet-driver`, `volttron-lib-ieee2030_5-driver` | real protocols; their remote-config models carry the layout hints the device card renders |
| `protocol-proxy` and `protocol-proxy-modbus`, `-dnp3`, `-bacnet`, `-ieee2030_5`, `-mqtt` | the proxy subprocesses the interfaces and the bus adapter launch. After installing, run `protocol-proxy-manifests export` once so the manager finds the manifests, or set `PROTOCOL_PROXY_MANIFESTS` to a directory holding them (`protocol-proxy-manifests list` shows what is found) |
| `interoperability-service[discovery,openfmb]` | formats, transforms, resources, chain reports, pattern checks and Discover (`discovery` brings `pysunspec2` for SunSpec discovery; `openfmb` brings `protobuf` for the OpenFMB formats) |
| `volttron-resource-bridge` | the Bridges tab's device bridges and the Activity card (`statistics` RPC) |
| `volttron-message-bus-adapter` | the Bridges tab's remote topics; needs an MQTT broker to connect to (for example `eclipse-mosquitto:2` in docker) |
| `resource-config` | this UI. Install it in the same environment, or in its own with the `models` extra, so the schema catalog reads the live pydantic models; otherwise the bundled `catalog.json` is used |

```bash
python -m venv .venv && . .venv/bin/activate
pip install volttron-core volttron-lib-zmq volttron-lib-auth volttron-lib-web \
            volttron-platform-driver volttron-lib-base-driver volttron-lib-fake-driver \
            protocol-proxy protocol-proxy-modbus volttron-lib-modbus-driver      # add the other protocols as needed
pip install -e path/to/interoperability-service[discovery,openfmb] \
            -e path/to/resource-bridge -e path/to/message-bus-adapter -e path/to/resource-config
protocol-proxy-manifests export
```

Poetry must be on the path as well: the platform records the environment in a poetry project in `VOLTTRON_HOME` on
first start, which takes a minute or two.

### 2. Configure the platform

Choose a home for the platform and export it in every shell that runs `volttron`, `vctl` or the commands below;
without it the platform reads `~/.volttron/config`, which may belong to another installation:

```bash
export VOLTTRON_HOME=~/volttron_homes/site1
mkdir -p $VOLTTRON_HOME
```

`$VOLTTRON_HOME/config` needs an instance name, auth on, and a `[web]` section. The instance name is the
`platform_name` the UI uses. Option names are the platform's option names with hyphens (`messagebus`, not
`message-bus`).

```ini
[volttron]
instance-name = site1
messagebus = zmq
auth-enabled = True
agent-isolation-mode = False

[web]
bind-web-address = https://0.0.0.0:8443
web-ssl-cert = /home/volttron/volttron_homes/site1/certs/web.crt
web-ssl-key = /home/volttron/volttron_homes/site1/certs/web.key
rpc-allow-list =
    platform.presentation: resolve, list_formats, list_transforms, describe_transform, chain_report, compile_pattern, edge_report, preview, check_references, discover
    platform.resource_bridge: statistics
```

The web service needs a PEM certificate and private key for `https`. The key must be RSA: the web service signs its
login tokens with it and only accepts RSA keys for that (an EC key is accepted at start-up but every login then fails
with `Invalid Key type for RSAAlgorithm`). Use a pair issued by your CA where you have one; for a test platform, make a
self-signed pair before the first start, for the names the browser and the UI will use to reach the platform:

```bash
mkdir -p $VOLTTRON_HOME/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -keyout $VOLTTRON_HOME/certs/web.key -out $VOLTTRON_HOME/certs/web.crt
chmod 600 $VOLTTRON_HOME/certs/web.key
```

Add the host name or address the UI will use to `subjectAltName`. Without `openssl`, the same pair comes from Python's
`cryptography` package, which the platform environment already has:

```bash
python - <<'EOF'
import datetime, ipaddress, os
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
d = os.path.join(os.environ['VOLTTRON_HOME'], 'certs'); os.makedirs(d, exist_ok=True)
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'localhost')])
now = datetime.datetime.now(datetime.timezone.utc)
cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now).not_valid_after(now + datetime.timedelta(days=825))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'), x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
        .sign(key, hashes.SHA256()))
open(os.path.join(d, 'web.key'), 'wb').write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
os.chmod(os.path.join(d, 'web.key'), 0o600)
open(os.path.join(d, 'web.crt'), 'wb').write(cert.public_bytes(serialization.Encoding.PEM))
EOF
```

Point `web-ssl-cert` and `web-ssl-key` at the two files. A self-signed certificate is unknown to the UI's HTTP client,
so start the UI with `RESOURCE_CONFIG_VERIFY_TLS=$VOLTTRON_HOME/certs/web.crt` in its environment (the certificate is
its own CA bundle) or with `--no-verify-tls`; browsers ask once to trust it. A platform that already has a root CA in
its certificate store can sign the web server's certificate with `vctl cert create --type server` instead; that
requires the platform to be running.

Without TLS, use an `http://` bind address and add `web-secret-key = <32 or more random bytes, for example the output
of python -c "import secrets; print(secrets.token_hex(32))">`.

The `rpc-allow-list` is what lets the UI call the service and the Resource Bridge: the web service's RPC proxy forwards
nothing it does not name (globs; one entry per line). The config store, the driver and the control service's lifecycle
are on the proxy's fixed deny-list and are reached only through their dedicated VUI endpoints, which the allow-list
does not govern. The agents themselves need no change: their exported RPCs carry no capability requirement.

### 3. Start the platform, create the web user, grant the web service write access

```bash
export VOLTTRON_HOME=~/volttron_homes/site1   # the same home as in step 2
volttron -vv -l volttron.log &
vctl status                                   # until it answers
```

```bash
vctl web create-admin                         # prompts for username and password; groups admin and vui
vctl authz add agent platform.web --role-names default_rpc_capabilities
```

The last line matters: the platform gives `platform.web` only the `control.*` capabilities by default, so the UI can
start and stop agents but every save from Pending changes returns 403 until the web service may write the config store.
`default_rpc_capabilities` is the platform's own role for the config-store RPCs (`initialize_configs`, `set_config`,
`delete_config`, `delete_store`); assigned this way it is not restricted to one identity, so the web service can write
any agent's configuration. It also silences the `initialize_configs` authorization error the web service logs at
startup.

### 4. Install the agents

The identities below are the UI's defaults (`RESOURCE_CONFIG_*_IDENTITY` changes them).

```bash
vctl install volttron-platform-driver           --vip-identity platform.driver          --tag driver          --start --enable
vctl install path/to/interoperability-service   --vip-identity platform.presentation    --tag interop         --start --enable
vctl install path/to/resource-bridge            --vip-identity platform.resource_bridge --tag resource_bridge --start --enable
vctl install path/to/message-bus-adapter        --vip-identity platform.bus_adapter     --tag bus_adapter     --start --enable
```

`--start` runs an agent once; `--enable` makes the platform start it again after every restart. `path/to/...` must be an
existing directory (or a wheel): a path that does not exist is sent to the platform as a PyPI package name and fails
with `Unable to get agent or library name`.

Then give them something to show:

- Service: store its configuration (`vctl config store platform.presentation config sample_config.json`, from the
  service repository) or create formats, transforms and resources from the UI; the bundled formats and transforms
  appear without any configuration.
- Driver: store a registry and a device from the Devices tab (Discover for a reachable SunSpec, DNP3 or 2030.5
  device, or Import for a CSV), or with `vctl config store platform.driver registry_configs/fake.csv fake.csv --csv`
  and a `devices/<topic>` entry pointing at it, using the fake interface's sample files.
- Resource Bridge and bus adapter: their configurations are written from the Bridges tab; the bus adapter needs a
  broker it can reach (`site_broker` in its config is the `BusConfig.name`).

### 5. Point the UI at it

```bash
RESOURCE_CONFIG_SECRET_KEY=$(python -c 'import secrets; print(secrets.token_urlsafe(32))') \
RESOURCE_CONFIG_VERIFY_TLS=$VOLTTRON_HOME/certs/web.crt \
resource-config --platform-url https://localhost:8443 --platform-name site1
```

Sessions live in the UI process: after a restart of the UI, users sign in again (the page notices and shows the login). `secret_key` signs the session cookie and is generated per start when unset; set it when several UI processes share one address.

### 6. Checking the installation

| Tab or feature | Needs | Expected |
|---|---|---|
| Login | web user in the `vui` group | the platform list shows `platform_name` |
| Agents | the four agents installed | state and health for each; start, stop, enable and disable work |
| Resources, Formats, Transforms | the service running, `rpc-allow-list` naming it | bundled and local formats and transforms; chain report and pattern Check answer; the transform drill-down is populated |
| Devices | the driver and a device | tree by topic, device card with the interface's layout hints, registry grid, Switch registry / Copy as new / Import / Export |
| Discover | the protocol's interface, proxy and manifest, plus a reachable device; SunSpec also needs the `discovery` extra | one pending set with the device's remote id |
| Bridges and Activity | Resource Bridge and bus adapter running, a broker, `platform.resource_bridge: statistics` allowed | bridges and remote topics listed, Activity card updating |
| Pending changes | the `authz` grant of step 3 | saves succeed (403 without the grant); change detection uses the web service's `metadata=true` listings and `ETag` headers when it offers them, hash comparison of contents otherwise |

## Running against der-control-fastlib

The `derhost` dialect (`--dialect derhost`) uses fastlib's REST routes: `POST /authenticate` for the login,
`GET /config-store/list` and `GET|PUT|DELETE /config-store/<agent>/<name>` for configurations, `POST /api/rpc/call` for
the service and Resource Bridge RPCs, and `GET /connections` for the Agents tab. fastlib has no agent lifecycle, since
containers are the lifecycle, so start, stop, enable and disable are answered with 501.

```bash
# in a fastlib checkout
export JWT_SECRET_KEY=$(python -c 'import secrets; print(secrets.token_urlsafe(32))')
python -m derhost.server.fastapi_message_bus --host 127.0.0.1 --port 8000      # or: make stack-up C=server  (publishes 127.0.0.1:5410)
# then
resource-config --dialect derhost --platform-url http://127.0.0.1:8000 --platform-name fastlib
```

The server requires `JWT_SECRET_KEY` to be at least 32 bytes. Agents appear as they connect to the server; the
interoperability service runs from the `docker/interoperability-service` stack in the fastlib repository.

## Develop

```bash
pip install -e ".[dev]"
pytest                         # backend against an in-process fake of the VUI
python tests/dev_server.py     # the UI against that fake at http://127.0.0.1:8600/dev/login
```

The schema catalog reads the components' pydantic models when their packages are installed beside the UI and
otherwise uses `src/resource_config/catalog/catalog.json`, written with `python -m resource_config.catalog --dump`
from an environment that has them.
