"""The schema catalog: JSON Schemas of the components' pydantic models, with the layout hints the generated forms
need. Models are imported when their packages are installed beside this one; otherwise the schemas bundled in
``catalog/*.json`` (written by ``python -m resource_config.catalog --dump`` from an environment that has them) serve.
Hints come from each field's ``json_schema_extra`` (``group``, ``order``, ``unit``, ``advanced``, ``show_when``) and
from the fallbacks the design names: a field with a default and no description is advanced, a name ending in
``_interval`` or ``_timeout`` is in seconds, ``description`` becomes the tooltip."""
from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from typing import Any

BUNDLED = Path(__file__).parent / 'catalog'

# (agent type, entry kind) -> (module, class) of the model describing that entry.
MODEL_SOURCES: dict[tuple[str, str], tuple[str, str]] = {
    ('driver', 'config'): ('platform_driver.config', 'PlatformDriverConfig'),
    ('driver', 'device'): ('volttron.driver.base.config', 'DeviceConfig'),
    ('driver', 'point'): ('volttron.driver.base.config', 'PointConfig'),
    ('driver', 'remote'): ('volttron.driver.base.config', 'RemoteConfig'),
    ('resource_bridge', 'config'): ('resource_bridge.config', 'ResourceBridgeConfig'),
    ('bus_adapter', 'config'): ('bus_adapter.config', 'MessageBusAdapterConfig'),
    ('bus_adapter', 'mqtt'): ('bus_adapter.config', 'MQTTConfig'),
    ('bus_adapter', 'nats'): ('bus_adapter.config', 'NATSConfig'),
    ('service', 'canonical'): ('interoperability.resource', 'CanonicalResource'),
    ('service', 'alias'): ('interoperability.resource', 'AliasedResource'),
}
# Driver interfaces: their remote config and point config classes, when installed.
INTERFACE_SOURCES: dict[str, tuple[str, str, str]] = {
    'modbus': ('volttron.driver.interfaces.modbus.config', 'ModbusRemoteConfig', 'ModbusPointConfig'),
    'dnp3': ('volttron.driver.interfaces.dnp3.config', 'Dnp3RemoteConfig', 'Dnp3PointConfig'),
    'ieee2030_5': ('volttron.driver.interfaces.ieee2030_5.config', 'Ieee2030_5RemoteConfig', 'Ieee2030_5PointConfig'),
    'bacnet': ('volttron.driver.interfaces.bacnet.bacnet', 'BacnetRemoteConfig', 'BacnetPointConfig'),
    'fake': ('volttron.driver.interfaces.fake.fake', 'FakeRemoteConfig', 'FakePointConfig'),
}
SECONDS_SUFFIXES = ('_interval', '_timeout', 'timeout', 'interval', '_window', 'stale_after', 'keepalive')
# Fields of the modbus remote config that the design groups and hides (CONFIGURATION_UI_DESIGN_V3.md, 6.2).
MODBUS_GROUPS = {'Connection': ['device_address', 'port', 'unit_id', 'transport_protocol', 'bind_host'],
                 'Protocol and timing': ['addressing', 'word_order', 'timeout', 'retries', 'max_gap']}
BASE_ADVANCED = {'debug', 'module', 'plugins'}
# Protocol-proxy launch options every proxied interface carries; rarely touched, so advanced for all of them.
PROXY_ADVANCED = {'persistent_connection', 'proxy_group', 'reply_timeout', 'registration_timeout', 'encrypt', 'compress', 'proxy_log_level'}


def _import(module: str, name: str):
    try:
        return getattr(importlib.import_module(module), name)
    except Exception:
        return None


def schema_of(model) -> dict:
    schema = model.model_json_schema(mode='validation')
    return _annotate(schema, model)


def _annotate(schema: dict, model) -> dict:
    """Add ``x-hints`` per property from json_schema_extra, with fallbacks for models that carry none."""
    props = schema.get('properties', {})
    required = set(schema.get('required', []))
    fields = getattr(model, 'model_fields', {})
    hints: dict[str, dict] = {}
    for name, prop in props.items():
        field = fields.get(name)
        extra = {}
        if field is not None and isinstance(field.json_schema_extra, dict):
            extra = dict(field.json_schema_extra)
        hint = {k: extra[k] for k in ('group', 'order', 'unit', 'advanced', 'show_when') if k in extra}
        description = prop.get('description') or (field.description if field is not None else None)
        if description:
            hint['tooltip'] = description
        if 'unit' not in hint and any(name.endswith(s) or name == s for s in SECONDS_SUFFIXES) and _is_number(prop):
            hint['unit'] = 's'
        if 'advanced' not in hint:
            has_default = 'default' in prop or (field is not None and not field.is_required())
            hint['advanced'] = bool(has_default and not description and name not in required)
        if name in BASE_ADVANCED or name in PROXY_ADVANCED:
            hint['advanced'] = True
        hints[name] = hint
    model_name = getattr(model, '__name__', '')
    carries_hints = any(isinstance(f.json_schema_extra, dict) and 'group' in f.json_schema_extra for f in fields.values())
    if model_name == 'ModbusRemoteConfig' and not carries_hints:     # fallback for interfaces released before the hints
        for group, names in MODBUS_GROUPS.items():
            for n in names:
                if n in hints:
                    hints[n].update(group=group, advanced=False)
        for n in ('cert_path', 'key_path', 'ca_path', 'tls_verify', 'client_auth'):
            if n in hints:
                hints[n].update(show_when={'transport_protocol': 'tls'}, advanced=True)
        for n in ('baudrate', 'bytesize', 'parity', 'stopbits', 'handle_local_echo'):
            if n in hints:
                hints[n].update(show_when={'transport_protocol': 'serial'}, advanced=True)
        for n in ('persistent_connection', 'proxy_group', 'reply_timeout', 'registration_timeout', 'register_map'):
            if n in hints:
                hints[n]['advanced'] = True
        if 'heart_beat_point' in hints:
            hints['heart_beat_point'].update(group='Polling', advanced=False)
    schema['x-hints'] = hints
    return schema


def _is_number(prop: dict) -> bool:
    types = {prop.get('type')} | {a.get('type') for a in prop.get('anyOf', []) if isinstance(a, dict)}
    return bool(types & {'number', 'integer'})


def build_catalog() -> dict:
    """Live models first, bundled schemas second; records which were used."""
    catalog: dict[str, Any] = {'schemas': {}, 'interfaces': {}, 'source': {}, 'openfmb': {}}
    try:
        # The OpenFMB editions the service's codecs know and the one an alias gets when it names none (the newest).
        from interoperability.codecs import openfmb as _openfmb
        catalog['openfmb'] = {'editions': list(_openfmb.editions()), 'latest': _openfmb.latest_edition()}
        catalog['source']['openfmb'] = 'live'
    except Exception:
        pass
    for (agent_type, kind), (module, name) in MODEL_SOURCES.items():
        key = f'{agent_type}/{kind}'
        model = _import(module, name)
        if model is not None:
            catalog['schemas'][key] = schema_of(model)
            catalog['source'][key] = 'live'
    for interface, (module, remote, point) in INTERFACE_SOURCES.items():
        remote_model, point_model = _import(module, remote), _import(module, point)
        if remote_model is not None:
            entry = {'remote': schema_of(remote_model)}
            if point_model is not None:
                entry['point'] = schema_of(point_model)
            roles = _enum_values(entry['remote'], 'driver_role')
            entry['roles'] = roles or ['client']
            catalog['interfaces'][interface] = entry
            catalog['source'][f'interface/{interface}'] = 'live'
    bundled = BUNDLED / 'catalog.json'
    if bundled.exists():
        stored = json.loads(bundled.read_text(encoding='utf-8'))
        for key, schema in stored.get('schemas', {}).items():
            catalog['schemas'].setdefault(key, schema)
            catalog['source'].setdefault(key, 'bundled')
        for name, entry in stored.get('interfaces', {}).items():
            catalog['interfaces'].setdefault(name, entry)
        if not catalog['openfmb'] and stored.get('openfmb'):
            catalog['openfmb'] = stored['openfmb']
            catalog['source']['openfmb'] = 'bundled'
            catalog['source'].setdefault(f'interface/{name}', 'bundled')
    return catalog


def _enum_values(schema: dict, prop: str) -> list:
    p = schema.get('properties', {}).get(prop) or {}
    if 'enum' in p:
        return list(p['enum'])
    ref = p.get('$ref') or next((a.get('$ref') for a in p.get('anyOf', []) if isinstance(a, dict) and '$ref' in a), None)
    if ref and ref.startswith('#/$defs/'):
        return list(schema.get('$defs', {}).get(ref[len('#/$defs/'):], {}).get('enum', []))
    return []


def dump(path: Path = BUNDLED / 'catalog.json') -> Path:
    catalog = build_catalog()
    live = {'schemas': {k: v for k, v in catalog['schemas'].items() if catalog['source'].get(k) == 'live'},
            'interfaces': {k: v for k, v in catalog['interfaces'].items() if catalog['source'].get(f'interface/{k}') == 'live'}}
    if catalog['source'].get('openfmb') == 'live':
        live['openfmb'] = catalog['openfmb']
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(live, indent=1, sort_keys=True), encoding='utf-8')
    return path


if __name__ == '__main__':
    if '--dump' in sys.argv:
        out = dump()
        print(f'wrote {out}')
    else:
        c = build_catalog()
        print(json.dumps({'schemas': list(c['schemas']), 'interfaces': list(c['interfaces']), 'source': c['source']}, indent=1))
