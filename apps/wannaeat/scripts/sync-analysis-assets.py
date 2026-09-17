#!/usr/bin/env python3
"""Create version-pinned client analysis assets from curated source files.

This reads data maintained outside the app and writes small, reviewed snapshots
into src/. It never edits the curated files themselves.
"""
import csv
import hashlib
import json
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
ROOT = APP.parent.parent
CATALOG = ROOT / 'data/prepared/criteria_catalog.json'
RULES = ROOT / 'data/curated/criteria_rules.csv'
OPAQUE = ROOT / 'data/curated/opaque_terms.csv'

def entries(value):
    return [item.strip().lower() for item in (value or '').split('|') if item.strip()]

catalog_bytes = CATALOG.read_bytes()
rules_bytes = RULES.read_bytes()
opaque_bytes = OPAQUE.read_bytes()
catalog = json.loads(catalog_bytes.decode('utf-8-sig'))
if not isinstance(catalog.get('version'), str):
    raise SystemExit('catalog version is missing')

# A settings version must include matching rules, not only the picker contents.
digest = hashlib.sha256(catalog_bytes + b'\0' + rules_bytes + b'\0' + opaque_bytes).hexdigest()[:12]
ruleset_version = f"{catalog['version']}-{digest}"

catalog_ids = {criterion['id'] for group in catalog['groups'] for subgroup in group['subgroups'] for criterion in subgroup['criteria']}
rule_set = {}
with RULES.open(encoding='utf-8-sig', newline='') as source:
    for row in csv.DictReader(source):
        criterion_id = row['기준ID']
        item = rule_set.setdefault(criterion_id, {'rules': [], 'exclude': [], 'excludeSuffix': []})
        kind = row['규칙']
        if kind == '제외':
            item['exclude'].extend(entries(row['패턴']))
        elif kind == '제외접미':
            item['excludeSuffix'].extend(entries(row['패턴']))
        else:
            for pattern in entries(row['패턴']):
                item['rules'].append({'kind': kind, 'confidence': row['확신'], 'pattern': pattern})

if set(rule_set) != catalog_ids:
    raise SystemExit(f'catalog/rule IDs differ: catalog-only={catalog_ids - set(rule_set)}, rules-only={set(rule_set) - catalog_ids}')

opaque = []
with OPAQUE.open(encoding='utf-8-sig', newline='') as source:
    for row in csv.DictReader(source):
        for pattern in entries(row['패턴']):
            opaque.append({'kind': row['규칙'], 'pattern': pattern})

(APP / 'src/catalog.snapshot.json').write_text(json.dumps({'rulesetVersion': ruleset_version, 'catalog': catalog}, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
(APP / 'src/analysis-rules.snapshot.json').write_text(json.dumps({'rulesetVersion': ruleset_version, 'criteria': rule_set, 'opaque': opaque}, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print(f'Ruleset {ruleset_version}: {len(catalog_ids)} criteria, {sum(len(v["rules"]) for v in rule_set.values())} rules')
