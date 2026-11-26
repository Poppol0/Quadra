"""Safe preview and migration of historic Quadra archives, including documents.

Never unzip arbitrary paths. Only documents referenced by the validated accounting
records can enter the private data folder.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import hashlib
import io
import json
from pathlib import PurePosixPath
import re
import stat
import uuid
import zipfile

CURRENT_FORMAT = 'quadra-family-v1'
ACCEPTED_FORMATS = (CURRENT_FORMAT, 'nido-family-v1')  # legacy on-disk schema only
MAX_UPLOAD = 200 * 1024 * 1024
MAX_UNCOMPRESSED = 420 * 1024 * 1024
MAX_SINGLE = 12 * 1024 * 1024
MAX_ENTRIES = 10000
MIMES = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf'}


@dataclass
class ImportPackage:
    archive: dict
    documents: dict[str, bytes]
    format: str
    summary: dict


def _normalize(data: dict, fallback_categories: list[dict]) -> dict:
    if not isinstance(data, dict) or data.get('format') not in ACCEPTED_FORMATS:
        raise ValueError('Questo file non e un archivio Quadra compatibile')
    obj = json.loads(json.dumps(data, ensure_ascii=False))
    for key in ('transactions', 'recurring', 'payment_plans', 'budgets', 'goals',
                'accounts', 'statements', 'import_rules'):
        obj.setdefault(key, [])
    obj.setdefault('categories', fallback_categories)
    if 'members' not in obj or not isinstance(obj['members'], list):
        obj['members'] = []
    existing = {x.get('name', '').casefold() for x in obj['members'] if isinstance(x, dict)}
    for key in ('transactions','recurring','payment_plans','budgets','accounts'):
        for row in obj[key]:
            if not isinstance(row, dict):
                continue
            name = row.get('owner', '')
            if (isinstance(name, str) and len(name.strip()) >= 2
                    and name not in ('Famiglia', 'Non attribuito')
                    and name.casefold() not in existing):
                obj['members'].append({'id': 'member-' + uuid.uuid4().hex, 'name': name, 'active': True})
                existing.add(name.casefold())
    obj['accounts_initialized'] = True
    obj['format'] = CURRENT_FORMAT
    obj['version'] = max(5, int(obj.get('version', 1)))
    return obj


def _metadata_documents(data: dict) -> dict[str, dict]:
    expected = {}
    for tx in data['transactions']:
        for att in tx.get('attachments', []):
            filename = 'allegati/' + att['id'] + MIMES[att['mime_type']]
            if filename in expected:
                raise ValueError('Allegato duplicato in archivio')
            expected[filename] = att
    for stmt in data.get('statements', []):
        doc = stmt.get('document')
        if doc:
            filename = 'estratti/' + doc['id'] + '.pdf'
            if filename in expected:
                raise ValueError('Documento duplicato in archivio')
            expected[filename] = doc
    return expected


def _safe_names(z: zipfile.ZipFile) -> list[str]:
    entries = z.infolist()
    if len(entries) > MAX_ENTRIES:
        raise ValueError('Troppi file nel backup')
    total = 0
    names = []
    for item in entries:
        name = item.filename
        if name.startswith('/') or '\\' in name or ':' in name or '\x00' in name:
            raise ValueError('Percorso non sicuro nel file ZIP')
        pieces = PurePosixPath(name).parts
        if '..' in pieces or not pieces or name.startswith('./'):
            raise ValueError('Percorso non sicuro nel file ZIP')
        mode = (item.external_attr >> 16) & 0xFFFF
        if stat.S_ISLNK(mode):
            raise ValueError('Collegamenti simbolici non consentiti nel file ZIP')
        if item.file_size > MAX_SINGLE and not name.endswith('archivio.json'):
            raise ValueError('File troppo grande nel backup')
        total += item.file_size
        if total > MAX_UNCOMPRESSED:
            raise ValueError('Backup ZIP decomprimibile troppo grande')
        if not item.is_dir():
            names.append(name)
    if len(names) != len(set(names)):
        raise ValueError('Nomi di file duplicati nel backup')
    return names


def _check_magic(path: str, data: bytes) -> None:
    if path.endswith('.pdf') and not data.startswith(b'%PDF-'):
        raise ValueError('PDF dell\'estratto conto non valido')
    if path.endswith('.jpg') and not data.startswith(b'\xff\xd8\xff'):
        raise ValueError('Immagine JPG non valida')
    if path.endswith('.png') and not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Immagine PNG non valida')
    if path.endswith('.webp') and not (len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP'):
        raise ValueError('Immagine WEBP non valida')


def _summary(data: dict, kind: str, file_count: int, old_format: str) -> dict:
    return {
        'kind': kind,
        'original_format': old_format,
        'transactions': len(data['transactions']),
        'members': len(data.get('members', [])),
        'accounts': len(data.get('accounts', [])),
        'recurring': len(data['recurring']),
        'payment_plans': len(data['payment_plans']),
        'budgets': len(data['budgets']),
        'categories': len(data['categories']),
        'statements': len(data['statements']),
        'files': file_count,
        'warning': 'Il ripristino SOSTITUISCE il contenuto dell\'archivio attivo, dopo un backup completo.'
    }


def inspect_upload(raw: bytes, filename: str, validator, fallback_categories: list[dict]) -> ImportPackage:
    if not raw or len(raw) > MAX_UPLOAD:
        raise ValueError('Backup vuoto o superiore al limite di 200 MB')
    filename = str(filename).lower()
    if filename.endswith('.json'):
        if len(raw) > MAX_SINGLE:
            raise ValueError('JSON superiore al limite di 12 MB')
        try:
            original = json.loads(raw.decode('utf-8'))
        except (ValueError, UnicodeError) as e:
            raise ValueError('JSON non leggibile') from e
        old_format = original.get('format') if isinstance(original,dict) else ''
        data = validator(_normalize(original, fallback_categories))
        expected = _metadata_documents(data)
        if expected:
            raise ValueError('Il JSON contiene collegamenti a documenti: usa il backup completo ZIP con foto e PDF')
        return ImportPackage(data, {}, 'JSON', _summary(data, 'JSON', 0, old_format))
    if not filename.endswith('.zip'):
        raise ValueError('Usa un backup Quadra ZIP oppure JSON')
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            names = _safe_names(z)
            candidates = [n for n in names if n == 'archivio.json' or
                          (n.count('/') == 1 and n.endswith('/archivio.json'))]
            if len(candidates) != 1:
                raise ValueError('Il ZIP deve contenere un solo archivio.json')
            archive_path = candidates[0]
            prefix = archive_path[:-len('archivio.json')]
            data_raw = z.read(archive_path)
            if len(data_raw) > MAX_SINGLE:
                raise ValueError('Archivio JSON troppo grande')
            original = json.loads(data_raw.decode('utf-8'))
            old_format = original.get('format') if isinstance(original,dict) else ''
            data = validator(_normalize(original, fallback_categories))
            expected = _metadata_documents(data)
            files = {}
            nameset = set(names)
            for filename, metadata in expected.items():
                full = prefix + filename
                if full not in nameset:
                    raise ValueError('Il ZIP non contiene tutti i documenti collegati ai movimenti: ' + filename)
                blob = z.read(full)
                if len(blob) > MAX_SINGLE or not blob:
                    raise ValueError('Documento vuoto o troppo grande nel backup')
                if metadata.get('size') is not None and len(blob) != metadata['size']:
                    raise ValueError('Dimensione del documento incoerente nel backup: ' + filename)
                _check_magic(filename, blob)
                files[filename] = blob
            # Verify checksum manifest where available (new Quadra backups).
            manifest_file = prefix + 'manifest.json'
            if manifest_file in nameset:
                manifest = json.loads(z.read(manifest_file).decode('utf-8'))
                checksums = manifest.get('sha256') if isinstance(manifest, dict) else None
                if not isinstance(checksums, dict):
                    raise ValueError('Manifest del backup non valido')
                for rel, blob in [('archivio.json', data_raw), *files.items()]:
                    if checksums.get(rel) != hashlib.sha256(blob).hexdigest():
                        raise ValueError('Backup danneggiato: verifica checksum fallita per ' + rel)
            if z.testzip() is not None:
                raise ValueError('ZIP danneggiato (CRC non valido)')
            return ImportPackage(data, files, 'ZIP', _summary(data, 'ZIP', len(files), old_format))
    except (zipfile.BadZipFile, OSError, KeyError, UnicodeError, json.JSONDecodeError) as e:
        raise ValueError('Backup ZIP illeggibile o danneggiato') from e
