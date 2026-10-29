"""The information model the pages render, derived from the store: canonical resources with their sources, aliases
with their deliveries, devices, bridges, remote topics, formats and transforms, and the consumers of each, which no
agent records and the UI computes (CONFIGURATION_UI_DESIGN_V3.md, section 3)."""
from __future__ import annotations

import json
from typing import Any

HUB_FORMATS = ('61850', 'sunspec', '2030.5', '1815.2.inputs', '1815.2.outputs', '1547', 'openfmb.ess', 'openfmb.solar')
STANDARD_OF = [('openfmb', 'OpenFMB'), ('1815.2', 'IEEE 1815.2'), ('2030.5', 'IEEE 2030.5'), ('1547', 'IEEE 1547'),
               ('61850', 'IEC 61850'), ('sunspec', 'SunSpec')]


def uai_of(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [s for s in value.split('/') if s]
    return [str(s) for s in value]


def topic_of(uai: list[str]) -> str:
    return '/'.join(uai)


def build_model(snapshot: dict, settings, agents: list[dict] | None = None) -> dict:
    identities: dict[str, dict[str, dict]] = snapshot.get('identities', {})
    agents = agents or []
    entries_of = lambda identity: identities.get(identity, {})

    # ---------------------------------------------------------------- service: resources, formats, transforms
    service = (entries_of(settings.presentation_identity).get('config') or {}).get('data') or {}
    mappings = service.get('mappings') or []
    declared_formats: dict = service.get('formats') or {}
    local_transforms: list = service.get('transforms') or []

    canonicals: dict[str, dict] = {}
    aliases: dict[str, dict] = {}
    for mapping in mappings:
        uai = uai_of(mapping.get('uai'))
        resource = dict(mapping.get('resource') or {})
        kind = str(mapping.get('resource_type', '')).lower()
        item = {'uai': uai, 'topic': topic_of(uai), 'format': resource.get('data_format'), 'owner': resource.get('owner'),
                'encoding': resource.get('encoding') or 'json', 'edition': resource.get('edition'),
                'parameters': resource.get('parameters') or {}, 'raw': mapping}
        if kind in ('canon', 'canonical'):
            item.update(kind='canonical', publication_topic=resource.get('publication_topic'), rpc_topic=resource.get('rpc_topic'),
                        aliases=[], consumers=[], source=None)
            canonicals[item['topic']] = item
        elif kind in ('alias', 'aliased'):
            item.update(kind='alias', references=uai_of(resource.get('references')), deliveries=[], consumers=[], canonical=None)
            aliases[item['topic']] = item
    for alias in aliases.values():
        canonical = canonicals.get(topic_of(alias['references']))
        alias['canonical'] = canonical['topic'] if canonical else None
        alias['dangling'] = canonical is None
        if canonical:
            canonical['aliases'].append(alias['topic'])

    # ---------------------------------------------------------------- devices
    devices: dict[str, dict] = {}
    for name, entry in entries_of(settings.driver_identity).items():
        if not name.startswith('devices/'):
            continue
        data = entry.get('data') if isinstance(entry.get('data'), dict) else {}
        topic = name[len('devices/'):]
        remote = {k: v for k, v in data.items() if k not in ('registry_config', 'interval', 'polling_group', 'group', 'active',
                                                             'publish_depth_first_all', 'publish_breadth_first_all', 'publish_depth_first_multi',
                                                             'publish_breadth_first_multi', 'publish_depth_first_single', 'publish_breadth_first_single',
                                                             'all_publish_interval', 'equipment_specific_fields', 'driver_config')}
        if isinstance(data.get('driver_config'), dict):
            remote = {**data['driver_config'], **{k: v for k, v in remote.items() if k in ('driver_type', 'driver_role', 'heart_beat_point')}}
        registry_ref = data.get('registry_config')
        registry_name = registry_ref[len('config://'):] if isinstance(registry_ref, str) and registry_ref.startswith('config://') else registry_ref
        registry = entries_of(settings.driver_identity).get(registry_name) if isinstance(registry_name, str) else None
        publish_all = bool(data.get('publish_depth_first_all') or data.get('publish_breadth_first_all'))
        devices[topic] = {'topic': topic, 'entry': name, 'driver_type': remote.get('driver_type') or data.get('driver_type'),
                          'driver_role': (remote.get('driver_role') or data.get('driver_role') or 'client'),
                          'polling_group': data.get('polling_group') or data.get('group'), 'interval': data.get('interval'),
                          'active': data.get('active', True), 'publishes': 'all' if publish_all else 'multi',
                          'publication_topic': f'devices/{topic}/{"all" if publish_all else "multi"}',
                          'heart_beat_point': remote.get('heart_beat_point') or data.get('heart_beat_point'),
                          'remote_config': remote, 'registry': registry_name,
                          'registry_rows': (registry or {}).get('data') if registry and registry.get('type') == 'csv' else None,
                          'registry_shared_with': [], 'resource': None, 'config': data}
    # registries shared between devices
    by_registry: dict[str, list[str]] = {}
    for d in devices.values():
        if d['registry']:
            by_registry.setdefault(d['registry'], []).append(d['topic'])
    for d in devices.values():
        d['registry_shared_with'] = [t for t in by_registry.get(d['registry'], []) if t != d['topic']]
    registries = {name: {'name': name, 'devices': topics, 'rows': len((entries_of(settings.driver_identity).get(name) or {}).get('data') or [])}
                  for name, topics in by_registry.items()}
    for name, entry in entries_of(settings.driver_identity).items():
        if entry.get('type') == 'csv' and name not in registries:
            registries[name] = {'name': name, 'devices': [], 'rows': len(entry.get('data') or [])}

    # sources of canonicals
    for canonical in canonicals.values():
        pub = canonical.get('publication_topic') or ''
        device = None
        if pub.startswith('devices/'):
            stem = pub[len('devices/'):]
            for suffix in ('/all', '/multi'):
                if stem.endswith(suffix):
                    stem = stem[:-len(suffix)]
            device = devices.get(stem)
        if device:
            canonical['source'] = {'kind': 'device', 'device': device['topic'], 'driver_type': device['driver_type'],
                                   'driver_role': device['driver_role'], 'publishes': device['publishes'], 'interval': device['interval'],
                                   'registry': device['registry']}
            device['resource'] = canonical['topic']
        elif canonical.get('owner') and canonical['owner'] != settings.driver_identity:
            canonical['source'] = {'kind': 'agent', 'identity': canonical['owner'], 'publication_topic': pub}
        else:
            canonical['source'] = {'kind': 'unknown', 'publication_topic': pub}

    # ---------------------------------------------------------------- bridges
    bridge_config = (entries_of(settings.resource_bridge_identity).get('config') or {}).get('data') or {}
    bridges: list[dict] = []
    for raw in bridge_config.get('bridges') or []:
        source, target = _end(raw.get('source')), _end(raw.get('target'))
        name = raw.get('name') or f"{topic_of(source['uai'])}>{topic_of(target['uai'])}"
        bridges.append({'name': name, 'source': source, 'target': target, 'enabled': raw.get('enabled', True),
                        'points': raw.get('points'), 'write_unchanged': raw.get('write_unchanged', False), 'raw': raw})

    # ---------------------------------------------------------------- remote topics
    bus_config = (entries_of(settings.bus_adapter_identity).get('config') or {}).get('data') or {}
    remote_topics: list[dict] = []
    for adapter in bus_config.get('adapters') or []:
        bus = adapter.get('name') or adapter.get('host') or adapter.get('servers') or 'bus'
        bus_type = adapter.get('bus_type') or bus_config.get('bus_type')
        for topic in adapter.get('local_subscriptions') or []:
            remote_topics.append({'bus': bus, 'bus_type': bus_type, 'topic': topic, 'direction': 'outbound', 'alias': aliases.get(topic, {}).get('topic'),
                                  'wildcard': any(c in topic for c in '#+*>')})
        for topic in adapter.get('remote_subscriptions') or []:
            remote_topics.append({'bus': bus, 'bus_type': bus_type, 'topic': topic, 'direction': 'inbound', 'alias': aliases.get(topic, {}).get('topic'),
                                  'wildcard': any(c in topic for c in '#+*>')})
    buses = [{'name': a.get('name') or a.get('host') or a.get('servers') or 'bus', 'bus_type': a.get('bus_type') or bus_config.get('bus_type'),
              'host': a.get('host') or a.get('servers'), 'port': a.get('port')} for a in bus_config.get('adapters') or []]

    # ---------------------------------------------------------------- deliveries and consumers
    for bridge in bridges:
        s, t = bridge['source'], bridge['target']
        s_res = (aliases if s['bus'] else canonicals).get(topic_of(s['uai']))
        t_res = (aliases if t['bus'] else canonicals).get(topic_of(t['uai']))
        if s_res is not None:
            s_res['consumers'].append({'kind': 'bridge', 'name': bridge['name'], 'target': topic_of(t['uai']), 'target_bus': t['bus'], 'enabled': bridge['enabled']})
        if t_res is not None and t['bus']:
            t_res['deliveries'].append({'kind': 'local_topic', 'bridge': bridge['name'], 'source': topic_of(s['uai']), 'topic': t.get('topic') or topic_of(t['uai'])})
        if s_res is not None and s['bus'] and t_res is not None and not t['bus']:
            s_res['deliveries'].append({'kind': 'device', 'bridge': bridge['name'], 'device': t_res.get('source', {}).get('device') if t_res.get('source') else None, 'target': topic_of(t['uai'])})
    for rt in remote_topics:
        alias = aliases.get(rt['topic'])
        if alias is not None:
            alias['deliveries'].append({'kind': 'remote_topic', 'bus': rt['bus'], 'bus_type': rt['bus_type'], 'direction': rt['direction'], 'topic': rt['topic']})
    # agents whose configuration names a publication topic
    for identity, entries in identities.items():
        if identity in (settings.presentation_identity, settings.resource_bridge_identity, settings.bus_adapter_identity, settings.driver_identity):
            continue
        blob = ' '.join(json.dumps(e.get('data')) if not isinstance(e.get('data'), str) else e.get('data') for e in entries.values())
        for canonical in canonicals.values():
            pub = canonical.get('publication_topic')
            stem = pub.rsplit('/', 1)[0] if pub else None
            if pub and (pub in blob or (stem and stem in blob)):
                canonical['consumers'].append({'kind': 'agent', 'identity': identity})
        for alias in aliases.values():
            if alias['topic'] in blob:
                alias['consumers'].append({'kind': 'agent', 'identity': identity})

    # ---------------------------------------------------------------- formats and transforms
    formats: dict[str, dict] = {}
    for name in HUB_FORMATS:
        formats[name] = {'name': name, 'kind': 'hub', 'declared': False, 'standard': _standard(name)}
    for name, spec in declared_formats.items():
        spec = spec or {}
        kind = 'hub' if spec.get('hub') else ('bus' if spec.get('proto') else 'device')
        formats[name] = {'name': name, 'kind': kind, 'declared': True, 'proto': spec.get('proto'), 'fields': len(spec.get('fields') or []),
                         'scaling': spec.get('scaling'), 'standard': _standard(name)}
    for res in list(canonicals.values()) + list(aliases.values()):
        fmt = res.get('format')
        if fmt and fmt not in formats:
            formats[fmt] = {'name': fmt, 'kind': 'bus' if res['kind'] == 'alias' and res.get('encoding') == 'protobuf' else ('device' if res['kind'] == 'canonical' else 'other'),
                            'declared': False, 'standard': _standard(fmt)}
    for fmt in formats.values():
        fmt['resources'] = [r['topic'] for r in list(canonicals.values()) + list(aliases.values()) if r.get('format') == fmt['name']]
        fmt['devices'] = [d['topic'] for d in devices.values() if canonicals.get(d['resource'] or '', {}).get('format') == fmt['name']]
    transforms = [{'input': t.get('input_format'), 'output': t.get('output_format'), 'kind': 'local', 'pattern': t.get('pattern')} for t in local_transforms]

    return {'version': snapshot.get('version'), 'refreshed': snapshot.get('refreshed'), 'error': snapshot.get('error'),
            'resources': {'canonical': list(canonicals.values()), 'aliases': list(aliases.values())},
            'devices': list(devices.values()), 'registries': list(registries.values()), 'bridges': bridges,
            'remote_topics': remote_topics, 'buses': buses, 'formats': list(formats.values()), 'transforms': transforms,
            'agents': agents}


def _end(raw) -> dict:
    if isinstance(raw, dict):
        return {'uai': uai_of(raw.get('uai')), 'bus': bool(raw.get('bus')), 'topic': raw.get('topic')}
    return {'uai': uai_of(raw), 'bus': False, 'topic': None}


def _standard(name: str) -> str:
    for prefix, label in STANDARD_OF:
        if name.startswith(prefix):
            return label
    return 'local'
