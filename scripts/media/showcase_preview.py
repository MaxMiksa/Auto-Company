#!/usr/bin/env python3
"""Read-only bilingual showcase of a real product's journal.

Translations are presentation overlays. Cycle identities, chronology, statuses,
counts, original documents and logs always come from the supplied run directory.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dashboard'))
from journal_data import JournalSource, ProductScope  # noqa: E402
from journal_server import JournalServer  # noqa: E402


def report_digest(report):
    return hashlib.sha256(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf8')).hexdigest()


def validate_translation(translation):
    def require_object(value, field):
        if not isinstance(value, dict):
            raise ValueError(f'{field} must be an object')

    def require_text(value, field):
        if not isinstance(value, str):
            raise ValueError(f'{field} must be text')

    require_object(translation, 'Translation')
    for key in ('productId', 'language', 'viewLabel'):
        require_text(translation.get(key), key)
    require_object(translation.get('cycles'), 'cycles')
    for cycle_id, entry in translation['cycles'].items():
        require_text(cycle_id, 'Cycle ID')
        require_object(entry, f'cycles.{cycle_id}')
        if not isinstance(entry.get('sourceSha256'), str) or not re.fullmatch(r'[0-9a-f]{64}', entry['sourceSha256']):
            raise ValueError(f'cycles.{cycle_id}.sourceSha256 must be a SHA-256 digest')
        for key in ('title', 'summary', 'blocker'):
            if key in entry:
                require_text(entry[key], f'cycles.{cycle_id}.{key}')
    project = translation.get('project', {})
    require_object(project, 'project')
    for key in ('displayName', 'description'):
        if key in project:
            require_text(project[key], f'project.{key}')
    documents = translation.get('documents', {})
    require_object(documents, 'documents')
    for path, label in documents.items():
        require_text(path, 'Document path')
        require_text(label, f'documents.{path}')


class ShowcaseSource(JournalSource):
    def __init__(self, root, project, language, translation, refinement=None):
        validate_translation(translation)
        original = JournalSource(root)
        identity = original.identity_state()['paths'][project]
        super().__init__(root, language, scope=ProductScope('product', product_id=identity, project=project))
        self.translation = deepcopy(translation)
        if translation['productId'] != identity or translation['language'] != language:
            raise ValueError('Translation belongs to a different product or language')
        self.refinement = None
        self.refinement_resources = {}
        if refinement is not None:
            if refinement.get('productId') != identity or refinement.get('language') != language:
                raise ValueError('Refinement belongs to a different product or language')
            if not refinement.get('capturedAt') and not refinement.get('captureSessionAt'):
                raise ValueError('Refinement requires its actual capture or capture-session time')
            self.refinement = deepcopy(refinement)
            for variant in self.refinement.get('variants', []):
                relative = variant['file']
                if not re.fullmatch(r'presentation/products/[a-z0-9-]+\.png', relative):
                    raise ValueError('Only reviewed published product PNGs are allowed')
                path = ROOT / relative
                raw = path.read_bytes()
                if path.is_symlink() or hashlib.sha256(raw).hexdigest() != variant['sha256'] or not raw.startswith(b'\x89PNG\r\n\x1a\n'):
                    raise ValueError('Published refinement digest or PNG is invalid')
                name = 'refinement-' + variant['sha256'] + '.png'
                variant.update(href=f'/api/product-media/{identity}/{name}', width=int.from_bytes(raw[16:20], 'big'), height=int.from_bytes(raw[20:24], 'big'))
                self.refinement_resources[name] = (path, variant['sha256'])
            if {variant.get('viewport') for variant in self.refinement.get('variants', [])} != {'desktop', 'mobile'}:
                raise ValueError('Refinement requires desktop and mobile variants')

    def media_resource(self, product_id, name):
        if name in self.refinement_resources:
            if product_id != self.translation['productId']:
                raise ValueError('Invalid refinement product')
            path, digest = self.refinement_resources[name]
            raw = path.read_bytes()
            if path.is_symlink() or hashlib.sha256(raw).hexdigest() != digest:
                raise ValueError('Published refinement changed after review')
            return raw, 'image/png'
        return super().media_resource(product_id, name)

    def snapshot(self, **kwargs):
        data = deepcopy(super().snapshot(**kwargs))
        entries = self.translation['cycles']
        if set(entries) != {row['id'] for row in data['cycles']}:
            raise ValueError('Translation no longer covers this exact recorded history')
        for row in data['cycles']:
            entry = entries[row['id']]
            if report_digest(row.get('workReport')) != entry['sourceSha256']:
                raise ValueError('Original report changed; review its translation before showing it')
            report = row.get('workReport')
            if report:
                if report.get('blocker', '').strip() and 'blocker' in entry and not entry['blocker'].strip():
                    raise ValueError('A translated blocker cannot erase the original blocker')
                for key in ('title', 'summary', 'blocker'):
                    if key in entry:
                        report[key] = entry[key]
            for artifact in row.get('artifacts', []):
                label = self.translation.get('documents', {}).get(artifact.get('path'))
                if label:
                    artifact['displayLabel'] = label
        for key in ('displayName', 'description'):
            if key in self.translation.get('project', {}):
                data['project'][key] = self.translation['project'][key]
        for artifact in data.get('artifacts', []):
            label = self.translation.get('documents', {}).get(artifact.get('path'))
            if label:
                artifact['displayLabel'] = label
        data['sourceName'] = self.translation['viewLabel']
        if self.refinement:
            data['productMedia']['publishedRefinement'] = deepcopy(self.refinement)
        return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--project', required=True)
    parser.add_argument('--translation', required=True, type=Path)
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--refinement', type=Path, help='Reviewed published image metadata; independent of original run captures')
    args = parser.parse_args()
    translation = json.loads(args.translation.read_text(encoding='utf8'))
    validate_translation(translation)
    refinement = json.loads(args.refinement.read_text(encoding='utf8')) if args.refinement else None
    source = ShowcaseSource(args.root, args.project, translation['language'], translation, refinement)
    source.snapshot()  # Validate before opening the listener.
    server = JournalServer(('127.0.0.1', args.port), source)
    print(f'http://127.0.0.1:{server.server_port}/journal', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
