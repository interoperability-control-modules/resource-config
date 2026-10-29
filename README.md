# resource-config

The configuration UI of the DER control framework: resources, devices, formats, transforms, bridges and agents
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
`poll_interval`, `host`, `port`, and the identities of the service, driver, Resource Bridge and bus adapter.

What the platform must allow: the web user needs the `vui` group; the service RPCs the UI calls (`resolve`,
`check_references`, …) go through the web service's RPC proxy, so the platform's `[web] rpc-allow-list` must name
`platform.presentation` and `platform.resource_bridge`. The config store, the driver and the control service's
lifecycle are reached only through their dedicated endpoints.

## Develop

```bash
pip install -e ".[dev]"
pytest                         # backend against an in-process fake of the VUI
python tests/dev_server.py     # the UI against that fake at http://127.0.0.1:8600/dev/login
```

The schema catalog reads the components' pydantic models when their packages are installed beside the UI and
otherwise uses `src/resource_config/catalog/catalog.json`, written with `python -m resource_config.catalog --dump`
from an environment that has them.

## What is here, and what is not yet

Increments 1 and 2 of the design and the core of 3 to 6: the platform client with the VUI dialect (the derhost
dialect is the shape of the interface, untested against fastlib), the store snapshot with hash-based change
detection and websocket events, the schema catalog with layout hints, the derived information model (sources,
aliases, deliveries, consumers), single-user login, the pending set, and the pages Resources (canonical and alias
cards, Add alias with deliveries), Devices (tree, device card with the generated remote config, registry grid,
switch/copy/import/export), Agents (state, lifecycle, generated driver form), Formats, Transforms (pattern view and
raw edit), Bridges (device bridges and remote topics), Pending changes.

Waiting on the platform side: the chain report, coverage, bundled transforms and the transform builder need the
service RPCs `list_formats`, `describe_transform`, `compile_pattern`, `preview` and `edge_report`; the Activity card
needs the Resource Bridge's statistics RPC; cheaper polling needs the config-metadata headers planned for
volttron-lib-web; Discover needs the generators behind an endpoint.
