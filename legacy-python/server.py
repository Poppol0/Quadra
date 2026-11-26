#!/usr/bin/env python3
"""Quadra: interfaccia locale e dati privati separati dal programma.
Nessuna libreria esterna, nessun servizio Internet richiesto.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote, quote
from datetime import datetime, timezone
import argparse
import io
import json
import os
import hashlib
import shutil
import re
import sys
import tempfile
import threading
import uuid
import webbrowser
import zipfile
from xml.etree import ElementTree as ET
from import_parser import parse_file, MAX_UPLOAD
from data_paths import configured_data_dir, ensure_external
from archive_transfer import inspect_upload, MAX_UPLOAD as MAX_RESTORE_BYTES

BASE = Path(__file__).resolve().parent
TEMPLATE = BASE / 'templates' / 'archivio_iniziale.json'
DATA_DIR = None
ARCHIVE = None
BACKUP = None
ATTACH = None
STATEMENT_DOCS = None


def initialize_storage(folder):
    """Prepare private writable paths; never create an archive inside program files."""
    global DATA_DIR, ARCHIVE, BACKUP, ATTACH, STATEMENT_DOCS
    directory = ensure_external(folder, BASE)
    directory.mkdir(parents=True, exist_ok=True)
    if os.name != 'nt':
        directory.chmod(0o700)
    DATA_DIR = directory
    ARCHIVE = directory / 'archivio.json'
    BACKUP = directory / 'backup'
    ATTACH = directory / 'allegati'
    STATEMENT_DOCS = directory / 'estratti'
    for folder in (BACKUP, ATTACH, STATEMENT_DOCS):
        folder.mkdir(exist_ok=True)
        if os.name != 'nt':
            folder.chmod(0o700)
    if not ARCHIVE.exists():
        template = json.loads(TEMPLATE.read_text(encoding='utf-8'))
        template['created_at'] = datetime.now().date().isoformat()
        raw = (json.dumps(template,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
        fd = os.open(ARCHIVE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, 'wb') as target:
                target.write(raw)
                target.flush()
                os.fsync(target.fileno())
        except Exception:
            ARCHIVE.unlink(missing_ok=True)
            raise
    return directory

LOCK = threading.RLock()
MAX_BYTES = 12 * 1024 * 1024
MAX_FILE = 12 * 1024 * 1024
MAX_PER_TX = 20
TAG_VALUES = {'scontrino', 'ricevuta', 'garanzia', 'documento', 'altro'}
MIMES = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf'}
FILES = {'/': ('index.html', 'text/html; charset=utf-8'),
         '/index.html': ('index.html', 'text/html; charset=utf-8'),
         '/app.js': ('app.js', 'application/javascript; charset=utf-8'),
         '/accounting.js': ('accounting.js', 'application/javascript; charset=utf-8'),
         '/payments.js': ('payments.js', 'application/javascript; charset=utf-8'),
         '/schedule.js': ('schedule.js', 'application/javascript; charset=utf-8'),
         '/styles.css': ('styles.css', 'text/css; charset=utf-8'),
         '/favicon.svg': ('favicon.svg', 'image/svg+xml'),
         '/manifest.webmanifest': ('manifest.webmanifest', 'application/manifest+json'),
         '/sw.js': ('sw.js', 'application/javascript; charset=utf-8'),
         '/notifications.js': ('notifications.js', 'application/javascript; charset=utf-8'),
         '/icon-192.png': ('icon-192.png', 'image/png'),
         '/icon-512.png': ('icon-512.png', 'image/png'),
         '/catalogo_categorie.json': ('catalogo_categorie.json', 'application/json; charset=utf-8')}


def valid_identifier(value):
    return isinstance(value, str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,120}', value) is not None


def validate(payload):
    if not isinstance(payload, dict) or payload.get('format') not in ('quadra-family-v1','nido-family-v1'):
        raise ValueError('Formato archivio non riconosciuto')
    ids_all = set()
    for key, limit in [('transactions', 20000), ('recurring', 1000),
                       ('budgets', 1000), ('goals', 1000)]:
        data = payload.get(key)
        if not isinstance(data, list) or len(data) > limit:
            raise ValueError('Sezione non valida: ' + key)
        ids = set()
        for row in data:
            if not isinstance(row, dict) or not isinstance(row.get('id'), str):
                raise ValueError('Record senza identificativo valido: ' + key)
            if row['id'] in ids:
                raise ValueError('Identificativo duplicato in ' + key)
            ids.add(row['id'])
            if key == 'transactions':
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(row.get('occurred_on', ''))):
                    raise ValueError('Data movimento non valida')
                if row.get('kind') not in ('income', 'expense', 'benefit', 'transfer', 'withdrawal', 'investment'):
                    raise ValueError('Tipo movimento non valido')
                val = row.get('amount_cents')
                if type(val) is not int or val <= 0 or val > 100000000000:
                    raise ValueError('Importo movimento non valido')
                details = row.get('details', '')
                if not isinstance(details, str) or len(details) > 4000:
                    raise ValueError('Descrizione estesa troppo lunga')
                attachments = row.get('attachments', [])
                if not isinstance(attachments, list) or len(attachments) > MAX_PER_TX:
                    raise ValueError('Numero allegati non valido (massimo 20)')
                for att in attachments:
                    if not isinstance(att, dict) or not re.fullmatch(r'[0-9a-f]{32}', str(att.get('id', ''))):
                        raise ValueError('Identificativo allegato non valido')
                    if att['id'] in ids_all:
                        raise ValueError('Allegato duplicato in archivio')
                    ids_all.add(att['id'])
                    if att.get('mime_type') not in MIMES or att.get('tag') not in TAG_VALUES:
                        raise ValueError('Tipo o etichetta allegato non valida')
                    name = att.get('name')
                    if not isinstance(name, str) or len(name) > 180 or not name.strip():
                        raise ValueError('Nome allegato non valido')
                    if type(att.get('size')) is not int or not (0 < att['size'] <= MAX_FILE):
                        raise ValueError('Dimensione allegato non valida')
            if key == 'recurring':
                if type(row.get('amount_cents')) is not int or row.get('frequency') not in ('monthly', 'yearly'):
                    raise ValueError('Ricorrenza non valida')
    cats = payload.get('categories', [])
    if not isinstance(cats, list) or len(cats) > 500:
        raise ValueError('Catalogo categorie non valido')
    seen_cats = set()
    for cat in cats:
        if not isinstance(cat, dict):
            raise ValueError('Categoria non valida')
        for field, length in [('id', 100), ('name', 140), ('group', 120)]:
            value = cat.get(field)
            if not isinstance(value, str) or not value.strip() or len(value) > length:
                raise ValueError('Campo categoria non valido: ' + field)
        if cat['id'] in seen_cats:
            raise ValueError('Identificativo categoria duplicato')
        seen_cats.add(cat['id'])
    # Anagrafica dinamica, conservando la compatibilità con le vecchie esportazioni.
    members = payload.get('members', [])
    if not isinstance(members,list) or len(members)>30:
        raise ValueError('Anagrafica familiare non valida')
    member_ids=set()
    member_names=set()
    for m in members:
        if not isinstance(m,dict) or not valid_identifier(m.get('id')) or m['id'] in member_ids:
            raise ValueError('Identificativo componente non valido')
        name=m.get('name')
        if not isinstance(name,str) or not (2<=len(name.strip())<=70) or name.strip()!=name:
            raise ValueError('Nome componente non valido')
        if name.casefold() in member_names or name.casefold() in ('famiglia','non attribuito'):
            raise ValueError('Nome componente duplicato o riservato')
        if type(m.get('active',True)) is not bool:
            raise ValueError('Stato componente non valido')
        member_ids.add(m['id']);member_names.add(name.casefold())
    allowed_owners={m['name'] for m in members}|{'Famiglia'}
    if 'accounts_initialized' in payload and type(payload['accounts_initialized']) is not bool:
        raise ValueError('Stato di inizializzazione conti non valido')
    account_ids = set()
    if 'accounts' in payload:
        accounts = payload['accounts']
        if not isinstance(accounts, list) or len(accounts) > 40:
            raise ValueError('Elenco conti non valido')
        for a in accounts:
            if not isinstance(a, dict) or not valid_identifier(a.get('id')) or a['id'] in account_ids:
                raise ValueError('Conto duplicato o non valido')
            if a.get('owner') not in allowed_owners or a.get('type') not in ('bank','cash'):
                raise ValueError('Tipo o intestatario del conto non valido')
            k=a.get('account_kind')
            if k is not None:
                if k not in ('personal','mortgage','cash','joint'):
                    raise ValueError('Tipologia conto non valida')
                if (k=='cash') != (a['type']=='cash'):
                    raise ValueError('Tipologia conto incoerente con contanti / banca')
            if type(a.get('active',True)) is not bool:
                raise ValueError('Stato del conto non valido')
            if a.get('archived_on') and not valid_iso(a['archived_on']):
                raise ValueError('Data archiviazione conto non valida')
            if not isinstance(a.get('note',''),str) or len(a.get('note',''))>400:
                raise ValueError('Note conto troppo lunghe')
            if not isinstance(a.get('label'), str) or not (1 <= len(a['label']) <= 100):
                raise ValueError('Nome conto non valido')
            if a.get('opening_on'):
                if not valid_iso(a['opening_on']): raise ValueError('Data saldo conto non valida')
                if type(a.get('opening_cents')) is not int: raise ValueError('Saldo conto non valido')
            account_ids.add(a['id'])
    statements = payload.get('statements',[])
    if not isinstance(statements,list) or len(statements)>3000:
        raise ValueError('Estratti conto non validi')
    stmt_ids=set()
    for x in statements:
        if not isinstance(x,dict) or not valid_identifier(x.get('id')) or x['id'] in stmt_ids:
            raise ValueError('Identificativo estratto conto non valido')
        stmt_ids.add(x['id'])
        if x.get('account_id') not in account_ids:
            raise ValueError('Conto estratto non valido')
        if not valid_iso(x.get('period_start')) or not valid_iso(x.get('period_end')) or x['period_start']>x['period_end']:
            raise ValueError('Periodo estratto non valido')
        if type(x.get('opening_cents')) is not int or type(x.get('closing_cents')) is not int:
            raise ValueError('Saldi estratto non validi')
        if len(str(x.get('note',''))) > 1000: raise ValueError('Nota estratto troppo lunga')
        doc=x.get('document')
        if doc is not None:
            if not isinstance(doc,dict) or not re.fullmatch(r'[0-9a-f]{32}',str(doc.get('id',''))):
                raise ValueError('Documento estratto non valido')
            if doc.get('mime_type') != 'application/pdf' or not isinstance(doc.get('name'),str):
                raise ValueError('Documento estratto non valido')
    for t in payload['transactions']:
        aid=t.get('account_id')
        dest=t.get('counterparty_account_id')
        if aid and aid not in account_ids:
            raise ValueError('Il conto del movimento non esiste')
        if dest and dest not in account_ids:
            raise ValueError('Il conto di destinazione non esiste')
        if aid and dest and aid == dest:
            raise ValueError('Conto di origine e destinazione uguali')
    rules=payload.get('import_rules',[])
    if not isinstance(rules,list) or len(rules)>400:
        raise ValueError('Regole di importazione non valide')
    for rule in rules:
        if not isinstance(rule,dict) or not valid_identifier(rule.get('id')):
            raise ValueError('Regola non valida')
        if not isinstance(rule.get('pattern'),str) or not (2<=len(rule['pattern'])<=120):
            raise ValueError('Testo regola non valido')
        if rule.get('category') and not isinstance(rule['category'],str):
            raise ValueError('Categoria regola non valida')
    plans = payload.get('payment_plans', [])
    if not isinstance(plans, list) or len(plans) > 500:
        raise ValueError('Piani a rate non validi')
    seen_plans = set()
    for plan in plans:
        if not isinstance(plan,dict) or not valid_identifier(plan.get('id')) or plan['id'] in seen_plans:
            raise ValueError('Identificativo piano a rate non valido')
        seen_plans.add(plan['id'])
        if not isinstance(plan.get('title'),str) or not (1 <= len(plan['title'].strip()) <= 120):
            raise ValueError('Nome piano a rate non valido')
        if plan.get('owner') not in allowed_owners:
            raise ValueError('Intestatario piano a rate non valido')
        if not isinstance(plan.get('category'),str) or len(plan['category']) > 120:
            raise ValueError('Categoria piano a rate non valida')
        if type(plan.get('amount_cents')) is not int or not (0 < plan['amount_cents'] <= 1000000000):
            raise ValueError('Importo rata non valido')
        n=plan.get('installment_count');paid=plan.get('paid_before',0)
        if type(n) is not int or not 2 <= n <= 240 or type(paid) is not int or not 0 <= paid <= n:
            raise ValueError('Numero rate o rate già saldate non valido')
        if not valid_iso(plan.get('first_due_on')):
            raise ValueError('Prima scadenza piano non valida')
        if plan.get('interval_months') not in (1,2,3,6,12):
            raise ValueError('Intervallo piano non valido')
        if plan.get('account_id') and plan['account_id'] not in account_ids:
            raise ValueError('Conto del piano non trovato')
        if type(plan.get('active',1)) is not int or plan.get('active',1) not in (0,1):
            raise ValueError('Stato piano non valido')
        if not isinstance(plan.get('note',''),str) or len(plan.get('note',''))>1000:
            raise ValueError('Note piano troppo lunghe')
    for t in payload['transactions']:
        if not t.get('payment_ref_id'):
            continue
        if t.get('kind') != 'expense' or t.get('payment_ref_kind') not in ('payment_plan','recurring'):
            raise ValueError('Collegamento pagamento non valido')
        if not valid_identifier(t['payment_ref_id']) or not re.fullmatch(r'[0-9A-Za-z_-]{1,30}',str(t.get('payment_slot',''))):
            raise ValueError('Identificativo scadenza non valido')
    return payload


def valid_iso(value):
    try:
        if not isinstance(value,str) or re.fullmatch(r'\d{4}-\d{2}-\d{2}', value) is None: return False
        datetime.fromisoformat(value)
        return True
    except ValueError:
        return False


def read_archive():
    return validate(json.loads(ARCHIVE.read_text(encoding='utf-8')))


def backup_previous():
    if not ARCHIVE.exists():
        return
    stamps = sorted(BACKUP.glob('quadra-*.json'))
    if stamps and (datetime.now().timestamp() - stamps[-1].stat().st_mtime) < 3600:
        return
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    (BACKUP / ('quadra-' + stamp + '.json')).write_bytes(ARCHIVE.read_bytes())
    for old in sorted(BACKUP.glob('quadra-*.json'))[:-40]:
        old.unlink(missing_ok=True)


def write_archive(payload):
    validate(payload)
    # Before the first automatic v1.2 -> v1.3 migration keep an independent
    # recoverable ZIP, even if the hourly rolling JSON backup is throttled.
    if ARCHIVE.exists():
        try:
            previous=json.loads(ARCHIVE.read_text(encoding='utf-8'))
            reason = ('prima-migrazione-conti' if payload.get('accounts') and not previous.get('accounts') else
                      'prima-gestione-rate' if 'payment_plans' not in previous and 'payment_plans' in payload else
                      'prima-anagrafica-dinamica' if 'members' not in previous and 'members' in payload else None)
            if reason:
                stamp=datetime.now().strftime('%Y%m%d-%H%M%S-%f')
                target=BACKUP/('quadra-'+reason+'-'+stamp+'.zip')
                target.write_bytes(build_zip())
        except (ValueError, KeyError, OSError):
            raise ValueError('Impossibile salvare il backup preventivo della migrazione')
    raw = (json.dumps(payload, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    if len(raw) > MAX_BYTES:
        raise ValueError('Archivio troppo grande')
    backup_previous()
    fd, temp = tempfile.mkstemp(prefix='.quadra-write-', suffix='.json', dir=DATA_DIR)
    try:
        if os.name != 'nt':
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as target:
            target.write(raw)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temp, ARCHIVE)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def file_mime(raw):
    if raw.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if raw.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if len(raw) >= 12 and raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
        return 'image/webp'
    if raw.startswith(b'%PDF-'):
        return 'application/pdf'
    raise ValueError('File non supportato. Usa JPG, PNG, WEBP o PDF.')


def safe_filename(raw):
    name = unquote(raw or '')
    name = Path(name.replace('\\', '/')).name
    name = re.sub(r'[\x00-\x1f\x7f]', '', name).strip(' .')
    return name[:180] or 'Allegato'


def attachment_path(meta):
    return ATTACH / (meta['id'] + MIMES[meta['mime_type']])


def attachment_record(data, aid):
    for tx in data['transactions']:
        for meta in tx.get('attachments', []):
            if meta['id'] == aid:
                return tx, meta
    return None, None


def build_zip():
    """Export JSON, every referenced image/PDF and a verified SHA256 manifest."""
    data = read_archive()
    contents = {'archivio.json': ARCHIVE.read_bytes()}
    for tx in data['transactions']:
        for meta in tx.get('attachments', []):
            path = attachment_path(meta)
            if not path.is_file():
                raise ValueError('Backup incompleto: manca allegato ' + meta['name'])
            contents['allegati/' + path.name] = path.read_bytes()
    for stmt in data.get('statements', []):
        meta = stmt.get('document')
        if meta:
            path = STATEMENT_DOCS / (meta['id'] + '.pdf')
            if not path.is_file():
                raise ValueError('Backup incompleto: manca estratto ' + meta.get('name',''))
            contents['estratti/' + path.name] = path.read_bytes()
    manifest = {
        'format':'quadra-complete-backup-v1',
        'created_at':datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'sha256':{name:hashlib.sha256(blob).hexdigest() for name,blob in contents.items()}
    }
    stream = io.BytesIO()
    with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for name,blob in contents.items():
            z.writestr(name, blob)
        z.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
        z.writestr('LEGGIMI_RIPRISTINO.txt',
            'QUADRA - Backup completo offline\n\n'
            'Per ripristinare, apri Quadra > Impostazioni > Ripristina backup completo.\n'
            'Non estrarre manualmente il file dentro il programma.\n'
            'Conserva il file ZIP in una cartella privata.\n')
    return stream.getvalue()


def restore_complete(package):
    """Replace accounting data and documents together, with backup and rollback."""
    validate(package.archive)
    stage = Path(tempfile.mkdtemp(prefix='.quadra-stage-', dir=DATA_DIR))
    rollback = DATA_DIR / ('.quadra-rollback-' + uuid.uuid4().hex)
    try:
        archive = stage / 'archivio.json'
        archive.write_text(json.dumps(package.archive,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        if os.name != 'nt':
            archive.chmod(0o600)
        for directory in ('allegati', 'estratti'):
            (stage / directory).mkdir()
        for name, blob in package.documents.items():
            target = stage / name
            target.write_bytes(blob)
            if os.name != 'nt':
                target.chmod(0o600)
        if ARCHIVE.exists():
            preimport_backup()  # abort without overwriting anything if backup fails
        rollback.mkdir()
        stored = []
        inserted = []
        try:
            for name in ('archivio.json','allegati','estratti'):
                original = DATA_DIR / name
                if original.exists():
                    original.rename(rollback / name)
                    stored.append(name)
                (stage / name).rename(original)
                inserted.append(name)
        except Exception:
            for name in reversed(inserted):
                target = DATA_DIR / name
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink(missing_ok=True)
            for name in stored:
                (rollback / name).rename(DATA_DIR / name)
            raise
        shutil.rmtree(rollback, ignore_errors=True)
        return dict(package.summary, restored=True)
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def preimport_backup():
    content=build_zip()
    stamp=datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    target=BACKUP/('quadra-prima-importazione-'+stamp+'.zip')
    target.write_bytes(content)
    files=sorted(BACKUP.glob('quadra-prima-importazione-*.zip'))
    for old in files[:-15]:old.unlink(missing_ok=True)
    return target.name


class Handler(BaseHTTPRequestHandler):
    server_version = 'QuadraOffline/1.8'

    def host_ok(self):
        return re.fullmatch(r'(127\.0\.0\.1|localhost)(:\d{1,5})?', self.headers.get('Host', '')) is not None

    def origin_ok(self):
        return self.host_ok() and self.headers.get('Origin', '') == 'http://' + self.headers.get('Host', '')

    def response(self, code, payload, mimetype='application/json; charset=utf-8', extra=None):
        raw = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', mimetype)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'")
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def reject_origin(self):
        if not self.origin_ok():
            self.response(403, {'error': 'Origine non autorizzata'})
            return True
        return False

    def do_GET(self):
        if not self.host_ok():
            self.response(403, {'error': 'Host non autorizzato'})
            return
        path = urlsplit(self.path).path
        if path == '/api/storage':
            self.response(200, {'data_dir': str(DATA_DIR), 'archive': str(ARCHIVE), 'separate_from_program': True})
            return
        if path == '/api/state':
            try:
                with LOCK:
                    self.response(200, read_archive())
            except Exception as err:
                self.response(500, {'error': 'Impossibile leggere archivio: ' + str(err)})
            return
        if path == '/api/backup-completo.zip':
            try:
                with LOCK:
                    content = build_zip()
                self.response(200, content, 'application/zip',
                              {'Content-Disposition': 'attachment; filename="Quadra_backup_completo.zip"'})
            except Exception as err:
                self.response(500, {'error': 'Backup non disponibile: ' + str(err)})
            return
        matched = re.fullmatch(r'/api/attachments/([0-9a-f]{32})', path)
        if matched:
            with LOCK:
                try:
                    _, meta = attachment_record(read_archive(), matched.group(1))
                    if not meta:
                        self.response(404, {'error': 'Allegato non trovato'})
                        return
                    file = attachment_path(meta)
                    if not file.is_file():
                        self.response(404, {'error': 'File allegato mancante sul disco'})
                        return
                    disposition = 'attachment' if 'download=1' in urlsplit(self.path).query else 'inline'
                    self.response(200, file.read_bytes(), meta['mime_type'],
                                  {'Content-Disposition': f"{disposition}; filename*=UTF-8''{quote(meta['name'])}"})
                except Exception as err:
                    self.response(500, {'error': 'Errore lettura allegato: ' + str(err)})
            return
        stm=re.fullmatch(r'/api/statement-documents/([0-9a-f]{32})', path)
        if stm:
            with LOCK:
                meta=next((x['document'] for x in read_archive().get('statements',[])
                           if x.get('document') and x['document']['id']==stm.group(1)),None)
                if not meta:self.response(404,{'error':'Documento non trovato'});return
                f=STATEMENT_DOCS/(meta['id']+'.pdf')
                if not f.is_file():self.response(404,{'error':'PDF mancante'});return
                disp='attachment' if 'download=1' in urlsplit(self.path).query else 'inline'
                self.response(200,f.read_bytes(),'application/pdf',
                              {'Content-Disposition':f"{disp}; filename*=UTF-8''{quote(meta['name'])}"})
            return
        if path in FILES:
            name, mime = FILES[path]
            try:
                self.response(200, (BASE / name).read_bytes(), mime)
            except OSError:
                self.response(404, {'error': 'Pagina non trovata'})
        else:
            self.response(404, {'error': 'Risorsa non trovata'})

    def do_PUT(self):
        if self.reject_origin():
            return
        if urlsplit(self.path).path != '/api/state':
            self.response(404, {'error': 'Indirizzo non valido'})
            return
        if not self.headers.get('Content-Type', '').startswith('application/json'):
            self.response(415, {'error': 'Content-Type JSON obbligatorio'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > MAX_BYTES:
                self.response(413, {'error': 'Dimensione archivio non valida'})
                return
            data = json.loads(self.rfile.read(size).decode('utf-8'))
            with LOCK:
                current=read_archive()
                for field in ('accounts','statements','import_rules','payment_plans','members'):
                    if current.get(field) and field not in data:
                        raise ValueError('Browser non aggiornato: manca la sezione '+field)
                write_archive(data)
            self.response(200, {'ok': True, 'records': len(data['transactions'])})
        except (ValueError, TypeError, UnicodeError) as err:
            self.response(400, {'error': str(err)})
        except Exception as err:
            self.response(500, {'error': 'Errore salvataggio: ' + str(err)})

    def do_POST(self):
        if self.reject_origin():
            return
        path=urlsplit(self.path).path
        if path in ('/api/archives/inspect', '/api/archives/restore'):
            try:
                size = int(self.headers.get('Content-Length','0'))
                if not (0 < size <= MAX_RESTORE_BYTES):
                    self.response(413,{'error':'Backup vuoto o troppo grande (massimo 200 MB)'})
                    return
                name = safe_filename(self.headers.get('X-Quadra-Filename',''))
                body = self.rfile.read(size)
                fallback = json.loads(TEMPLATE.read_text(encoding='utf-8'))['categories']
                with LOCK:
                    pack = inspect_upload(body, name, validate, fallback)
                    if path.endswith('/inspect'):
                        self.response(200,pack.summary)
                    else:
                        if self.headers.get('X-Quadra-Action') != 'SOSTITUISCI':
                            self.response(400,{'error':'Conferma esplicita obbligatoria'})
                            return
                        report = restore_complete(pack)
                        self.response(200,report)
            except (ValueError, TypeError, UnicodeError, OSError, zipfile.BadZipFile) as err:
                self.response(400,{'error':str(err)})
            except Exception as err:
                self.response(500,{'error':'Ripristino non disponibile: '+str(err)})
            return
        if path=='/api/parse-import':
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=MAX_UPLOAD:
                    self.response(413,{'error':'File troppo grande (massimo 12 MB)'});return
                filename=safe_filename(self.headers.get('X-Quadra-Filename',''))
                sheet=unquote(self.headers.get('X-Quadra-Sheet','')) or None
                content=self.rfile.read(length)
                result=parse_file(content,filename,sheet)
                self.response(200,result)
            except (ValueError, OSError, zipfile.BadZipFile, ET.ParseError) as err:
                self.response(400,{'error':'Importazione: '+str(err)})
            except Exception as err:
                self.response(500,{'error':'Errore analisi file: '+str(err)})
            return
        if path=='/api/pre-import-backup':
            try:
                with LOCK:name=preimport_backup()
                self.response(200,{'ok':True,'backup':name})
            except Exception as err:self.response(500,{'error':str(err)})
            return
        statement_match=re.fullmatch(r'/api/statements/([a-zA-Z0-9_-]{1,120})/document',path)
        if statement_match:
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=MAX_FILE:
                    self.response(413,{'error':'PDF troppo grande (massimo 12 MB)'});return
                body=self.rfile.read(length)
                if file_mime(body)!='application/pdf':
                    raise ValueError('Sono consentiti solo documenti PDF')
                with LOCK:
                    data=read_archive()
                    record=next((x for x in data.get('statements',[]) if x['id']==statement_match.group(1)),None)
                    if not record:self.response(404,{'error':'Estratto non trovato'});return
                    old=record.get('document')
                    meta={'id':uuid.uuid4().hex,'name':safe_filename(self.headers.get('X-Quadra-Filename','estratto.pdf')),'mime_type':'application/pdf','size':length}
                    path=STATEMENT_DOCS/(meta['id']+'.pdf')
                    path.write_bytes(body)
                    record['document']=meta
                    try:write_archive(data)
                    except Exception:path.unlink(missing_ok=True);raise
                    if old:(STATEMENT_DOCS/(old['id']+'.pdf')).unlink(missing_ok=True)
                self.response(201,{'ok':True,'document':meta})
            except (ValueError,OSError) as err:self.response(400,{'error':str(err)})
            except Exception as err:self.response(500,{'error':str(err)})
            return
        match = re.fullmatch(r'/api/transactions/([a-zA-Z0-9_-]{1,120})/attachments', path)
        if not match:
            self.response(404, {'error': 'Indirizzo non valido'})
            return
        txid = match.group(1)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_FILE:
                self.response(413, {'error': 'Allegato troppo grande (massimo 12 MB)'})
                return
            content = self.rfile.read(length)
            mime = file_mime(content)
            header_mime = self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
            if header_mime not in (mime, 'application/octet-stream'):
                raise ValueError('Il contenuto non corrisponde al tipo di file dichiarato')
            tag = unquote(self.headers.get('X-Quadra-Tag', 'scontrino'))
            if tag not in TAG_VALUES:
                raise ValueError('Etichetta allegato non valida')
            filename = safe_filename(self.headers.get('X-Quadra-Filename', ''))
            with LOCK:
                data = read_archive()
                tx = next((t for t in data['transactions'] if t['id'] == txid), None)
                if not tx:
                    self.response(404, {'error': 'Movimento non trovato'})
                    return
                attachments = tx.setdefault('attachments', [])
                if len(attachments) >= MAX_PER_TX:
                    raise ValueError('Massimo 20 allegati per movimento')
                meta = {'id': uuid.uuid4().hex, 'name': filename, 'mime_type': mime,
                        'size': length, 'tag': tag,
                        'uploaded_at': datetime.now(timezone.utc).isoformat(timespec='seconds')}
                fd, temp = tempfile.mkstemp(prefix='.upload-', dir=ATTACH)
                try:
                    if os.name != 'nt':
                        os.fchmod(fd, 0o600)
                    with os.fdopen(fd, 'wb') as target:
                        target.write(content)
                        target.flush()
                        os.fsync(target.fileno())
                    path = attachment_path(meta)
                    os.replace(temp, path)
                    attachments.append(meta)
                    try:
                        write_archive(data)
                    except Exception:
                        path.unlink(missing_ok=True)
                        raise
                finally:
                    if os.path.exists(temp):
                        os.unlink(temp)
            self.response(201, {'ok': True, 'attachment': meta, 'attachments': attachments})
        except (ValueError, UnicodeError, OSError) as err:
            self.response(400, {'error': str(err)})
        except Exception as err:
            self.response(500, {'error': 'Errore caricamento: ' + str(err)})

    def do_DELETE(self):
        if self.reject_origin():
            return
        path = urlsplit(self.path).path
        attach_match = re.fullmatch(r'/api/attachments/([0-9a-f]{32})', path)
        tx_match = re.fullmatch(r'/api/transactions/([a-zA-Z0-9_-]{1,120})', path)
        stmt_match=re.fullmatch(r'/api/statements/([a-zA-Z0-9_-]{1,120})/document',path)
        if not attach_match and not tx_match and not stmt_match:
            self.response(404, {'error': 'Indirizzo non valido'})
            return
        try:
            with LOCK:
                data = read_archive()
                if stmt_match:
                    statement=next((x for x in data.get('statements',[]) if x['id']==stmt_match.group(1)),None)
                    if not statement:self.response(404,{'error':'Estratto non trovato'});return
                    meta=statement.pop('document',None)
                    write_archive(data)
                    if meta:(STATEMENT_DOCS/(meta['id']+'.pdf')).unlink(missing_ok=True)
                    self.response(200,{'ok':True})
                elif attach_match:
                    tx, meta = attachment_record(data, attach_match.group(1))
                    if not meta:
                        self.response(404, {'error': 'Allegato non trovato'})
                        return
                    tx['attachments'] = [a for a in tx.get('attachments', []) if a['id'] != meta['id']]
                    write_archive(data)
                    attachment_path(meta).unlink(missing_ok=True)
                    self.response(200, {'ok': True, 'transaction_id': tx['id'], 'attachments': tx['attachments']})
                else:
                    txid = tx_match.group(1)
                    tx = next((t for t in data['transactions'] if t['id'] == txid), None)
                    if not tx:
                        self.response(404, {'error': 'Movimento non trovato'})
                        return
                    data['transactions'] = [t for t in data['transactions'] if t['id'] != txid]
                    write_archive(data)
                    for meta in tx.get('attachments', []):
                        attachment_path(meta).unlink(missing_ok=True)
                    self.response(200, {'ok': True})
        except Exception as err:
            self.response(500, {'error': 'Errore eliminazione: ' + str(err)})

    def log_message(self, fmt, *args):
        print('[Quadra] ' + (fmt % args), flush=True)


def lock_storage():
    """Only one running Quadra process may access the same data directory."""
    handle = (DATA_DIR / '.quadra-active.lock').open('a+b')
    try:
        if os.name == 'nt':
            import msvcrt
            if not handle.seek(0, os.SEEK_END):
                handle.write(b'0')
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return handle
    except (OSError, IOError):
        handle.close()
        raise RuntimeError("Un'altra sessione Quadra usa gia questa cartella dati")


def unlock_storage(handle):
    try:
        if os.name == 'nt':
            import msvcrt
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        handle.close()


def main():
    p = argparse.ArgumentParser(description='Quadra - contabilita familiare offline')
    p.add_argument('--port', type=int, default=8765)
    p.add_argument('--no-browser', action='store_true')
    p.add_argument('--data-dir', help='Cartella dati privata fuori dal programma (percorso assoluto)')
    args = p.parse_args()
    try:
        initialize_storage(configured_data_dir(BASE, args.data_dir))
        read_archive()
    except (ValueError, OSError, json.JSONDecodeError) as err:
        print('Errore archivio: ' + str(err), file=sys.stderr)
        print('Se devi recuperare un backup, avvia con una cartella dati vuota e usa Impostazioni > Ripristina.',file=sys.stderr)
        sys.exit(1)
    try:
        active_lock = lock_storage()
    except RuntimeError as err:
        print(str(err), file=sys.stderr)
        sys.exit(1)
    try:
        httpd = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError as err:
        unlock_storage(active_lock)
        print('Non riesco ad aprire la porta: ' + str(err), file=sys.stderr)
        print('Per cambiare porta: python server.py --port 8770', file=sys.stderr)
        sys.exit(1)
    address = 'http://127.0.0.1:' + str(args.port)
    print('Quadra offline: ' + address)
    print('Programma: ' + str(BASE))
    print('Archivio privato: ' + str(ARCHIVE))
    print('Allegati: ' + str(ATTACH))
    print('Estratti conto: ' + str(STATEMENT_DOCS))
    print('Nessun collegamento Internet richiesto. Per chiudere: Ctrl+C.')
    if not args.no_browser:
        threading.Timer(0.7, lambda: webbrowser.open(address)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nQuadra chiusa. I dati rimangono sul PC.')
    finally:
        httpd.server_close()
        unlock_storage(active_lock)


if __name__ == '__main__':
    main()
