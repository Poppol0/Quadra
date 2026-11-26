"""Offline XLSX/CSV reader for Quadra. Uses Python standard library only.
Reads cell values rather than evaluating spreadsheet formulas; requires user mapping before import.
"""
import csv
import io
import re
import zipfile
from datetime import datetime, timedelta
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET

MAX_UPLOAD = 12 * 1024 * 1024
MAX_UNCOMPRESSED = 40 * 1024 * 1024
MAX_ROWS = 12000
MAX_COLS = 55
S = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
P = '{http://schemas.openxmlformats.org/package/2006/relationships}'

def normalize_text(value):
    if value is None:
        return ''
    return str(value).strip()

def _strings(zipfile_obj):
    try:
        root = ET.fromstring(zipfile_obj.read('xl/sharedStrings.xml'))
    except KeyError:
        return []
    return [''.join((n.text or '') for n in si.iter(S + 't')) for si in root.findall(S + 'si')]

def _sheet_paths(z):
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rel = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    targets = {r.attrib.get('Id'): r.attrib.get('Target', '') for r in rel.findall(P+'Relationship')}
    sheets=[]
    for el in wb.findall('.//' + S + 'sheet'):
        rid=el.attrib.get(R+'id')
        target=targets.get(rid, '')
        if not target:
            continue
        if target.startswith('/'):
            p=target.lstrip('/')
        elif target.startswith('xl/'):
            p=target
        else:
            p='xl/'+target
        # Normalize and refuse ZIP path traversal.
        path=PurePosixPath(p)
        if '..' in path.parts or not str(path).startswith('xl/'):
            continue
        sheets.append((el.attrib.get('name','Foglio'), str(path)))
    return sheets

def excel_date(value):
    try:
        dt=datetime(1899,12,30)+timedelta(days=float(value))
        if 1900 <= dt.year <= 2100:
            return dt.strftime('%Y-%m-%d')
    except (TypeError, ValueError, OverflowError):
        pass
    return normalize_text(value)

def excel_cell(c, ss):
    t=c.attrib.get('t')
    if t=='inlineStr':
        return ''.join(x.text or '' for x in c.iter(S+'t'))
    v=c.find(S+'v')
    if v is None:
        return ''
    val=v.text or ''
    if t=='s':
        try: return ss[int(val)]
        except (IndexError, TypeError, ValueError): return ''
    if t in ('str','e','d'): return val
    if t=='b': return 'Vero' if val=='1' else 'Falso'
    return val

def read_xlsx(content, requested_sheet=None):
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        total=0
        for item in z.infolist():
            total+=item.file_size
            if total>MAX_UNCOMPRESSED or item.file_size>MAX_UNCOMPRESSED:
                raise ValueError('Il file XLSX e troppo grande una volta estratto')
        sheets=_sheet_paths(z)
        if not sheets:
            raise ValueError('Nessun foglio leggibile nel file XLSX')
        names=[n for n,_ in sheets]
        if requested_sheet and requested_sheet not in names:
            raise ValueError('Il foglio scelto non esiste')
        name=requested_sheet or next((n for n in names if n.lower().startswith('ec-')), names[0])
        path=dict(sheets)[name]
        ss=_strings(z)
        rows=[]
        # iterparse is faster and avoids tree memory explosion.
        for _,elem in ET.iterparse(io.BytesIO(z.read(path)),events=('end',)):
            if elem.tag!=S+'row':
                continue
            vals={}
            for cell in elem.findall(S+'c'):
                code=cell.attrib.get('r','')
                m=re.match(r'([A-Z]+)',code)
                if not m:
                    continue
                index=0
                for ch in m.group(1):index=index*26+ord(ch)-64
                index-=1
                if index>=MAX_COLS:continue
                vals[index]=excel_cell(cell,ss)
            if vals and any(normalize_text(v) for v in vals.values()):
                row=['']*(min(MAX_COLS,max(vals)+1))
                for c,v in vals.items():row[c]=v
                rows.append({'source_row':int(elem.attrib.get('r') or len(rows)+1),'cells':row})
            if len(rows)>=MAX_ROWS:break
            elem.clear()
        return {'file_type':'xlsx','sheet':name,'sheets':names,'rows':rows,'truncated':len(rows)>=MAX_ROWS}

def read_csv(content):
    if b'\x00' in content[:2000]:
        raise ValueError('Il file non sembra un CSV valido')
    text=None
    for enc in ('utf-8-sig','cp1252','latin-1'):
        try:
            text=content.decode(enc)
            break
        except UnicodeError:continue
    if text is None:raise ValueError('Impossibile leggere il CSV')
    sample=text[:8192]
    try:
        dialect=csv.Sniffer().sniff(sample,delimiters=';,\t|')
        delim=dialect.delimiter
    except csv.Error:
        delim=';' if sample.count(';')>=sample.count(',') else ','
    rows=[]
    for idx,items in enumerate(csv.reader(io.StringIO(text),delimiter=delim),1):
        if any(x.strip() for x in items):
            rows.append({'source_row':idx,'cells':items[:MAX_COLS]})
        if len(rows)>=MAX_ROWS:break
    return {'file_type':'csv','sheet':'CSV','sheets':['CSV'],'rows':rows,'truncated':len(rows)>=MAX_ROWS}

def parse_file(content,filename,sheet=None):
    if not content or len(content)>MAX_UPLOAD:
        raise ValueError('File vuoto o troppo grande (max 12 MB)')
    lower=(filename or '').lower()
    if lower.endswith('.xlsx'):
        if not content.startswith(b'PK'):
            raise ValueError('Il file non e un XLSX valido')
        result=read_xlsx(content,sheet)
    elif lower.endswith('.csv') or lower.endswith('.txt'):
        result=read_csv(content)
    else:
        raise ValueError('Sono supportati XLSX e CSV')
    if not result['rows']:
        raise ValueError('Non ci sono righe con valori')
    return result
