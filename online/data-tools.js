'use strict';
(() => {
  const MB = 1024 * 1024;
  const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
  function mime(bytes) {
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return 'image/png';
    const text = new TextDecoder().decode(bytes.slice(0, 12));
    if (text.startsWith('%PDF-')) return 'application/pdf';
    if (text.startsWith('RIFF') && text.slice(8) === 'WEBP') return 'image/webp';
    throw new Error('Documento non valido: usa JPG, PNG, WEBP o PDF');
  }
  const collections = {transactions:20000,recurring:1000,budgets:1000,goals:1000,members:30,categories:500,accounts:40,statements:20000,payment_plans:500,import_rules:20000};
  const idOK = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
  const fileID = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
  const integer = Number.isSafeInteger;
  const dateOK = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value+'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
  };
  const nonempty = value => typeof value === 'string' && value.length > 0;
  const require = (condition,message) => { if (!condition) throw new Error(message); };
  const tags = ['scontrino','ricevuta','garanzia','documento','altro'];
  const textLength = value => new TextEncoder().encode(value).length;
  function validate(state) {
    require(state && typeof state === 'object' && !Array.isArray(state) &&
      ['quadra-family-v1','nido-family-v1'].includes(state.format),'Formato archivio non compatibile');
    for (const [key,limit] of Object.entries(collections)) {
      require(Array.isArray(state[key]) && state[key].length <= limit,'Sezione non valida: '+key);
      const ids = new Set();
      for (const item of state[key]) {
        require(item && typeof item === 'object' && !Array.isArray(item) && idOK(item.id) && !ids.has(item.id),'ID non valido o duplicato in '+key);
        ids.add(item.id);
      }
    }
    const names = new Set(['Famiglia']);
    for (const member of state.members) {
      require(nonempty(member.name) && member.name.trim() === member.name && textLength(member.name) >= 2 && textLength(member.name) <= 70 && !names.has(member.name) && (!Object.hasOwn(member,'active') || typeof member.active === 'boolean'),'Componente familiare non valido');
      names.add(member.name);
    }
    for (const c of state.categories) require(nonempty(c.name) && nonempty(c.group),'Categoria non valida');
    const accounts = new Set();
    for (const a of state.accounts) {
      require(names.has(a.owner) && ['bank','cash'].includes(a.type) && nonempty(a.label),'Conto non valido');
      const kind = a.account_kind;
      require(kind == null || kind === '' || (['personal','mortgage','cash','joint'].includes(kind) && (kind === 'cash') === (a.type === 'cash')),'Tipologia conto non coerente');
      if (a.opening_on != null && a.opening_on !== '') require(dateOK(a.opening_on) && integer(a.opening_cents),'Saldo o data apertura conto non validi');
      accounts.add(a.id);
    }
    const validAccount = id => id == null || id === '' || accounts.has(id);
    const files = new Set();
    function documentMeta(a,statement=false) {
      require(a && fileID(a.id) && !files.has(a.id) && integer(a.size) && a.size >= 1 && a.size <= 12*MB &&
        Object.hasOwn(extensions,a.mime_type) && nonempty(a.name) &&
        (statement ? a.mime_type === 'application/pdf' : tags.includes(a.tag)),'Metadati documento non validi');
      files.add(a.id);
    }
    for (const t of state.transactions) {
      require(dateOK(t.occurred_on),'Data movimento non valida');
      require(integer(t.amount_cents) && t.amount_cents >= 1 && t.amount_cents <= 100000000000,'Importo movimento non valido');
      require(['income','expense','benefit','transfer','withdrawal','investment'].includes(t.kind),'Tipo movimento non valido');
      require(t.owner == null || t.owner === '' || t.owner === 'Non attribuito' || names.has(t.owner),'Intestatario movimento inesistente');
      require(validAccount(t.account_id) && validAccount(t.counterparty_account_id),'Conto del movimento inesistente');
      require(!t.account_id || t.account_id !== t.counterparty_account_id,'Giroconto verso lo stesso conto');
      require(t.details == null || (typeof t.details === 'string' && textLength(t.details) <= 4000),'Descrizione movimento non valida');
      if (t.attachments != null) {
        require(Array.isArray(t.attachments) && t.attachments.length <= 20,'Allegati non validi');
        for (const a of t.attachments) documentMeta(a);
      }
    }
    for (const s of state.statements) {
      require(accounts.has(s.account_id) && dateOK(s.period_start) && dateOK(s.period_end) && integer(s.opening_cents) && integer(s.closing_cents),'Estratto conto non valido');
      if (s.document != null) documentMeta(s.document,true);
    }
    for (const r of state.recurring) require(integer(r.amount_cents) && ['monthly','yearly'].includes(r.frequency),'Ricorrenza non valida');
    for (const p of state.payment_plans) {
      require(integer(p.installment_count) && p.installment_count >= 2 && p.installment_count <= 240 && integer(p.paid_before) && p.paid_before >= 0 && p.paid_before <= p.installment_count && integer(p.amount_cents) && p.amount_cents >= 1 && dateOK(p.first_due_on) && names.has(p.owner) && validAccount(p.account_id),'Piano a rate non valido');
    }
    return state;
  }
  // Legacy migration is explicit and only fills sections absent from old formats.
  // A modern v5 archive missing any collection is rejected, not silently emptied.
  function migrateLegacy(state) {
    require(state && typeof state === 'object' && !Array.isArray(state) && ['quadra-family-v1','nido-family-v1'].includes(state.format),'Formato archivio non compatibile');
    const legacy = state.format === 'nido-family-v1' || (integer(state.version) && state.version < 5);
    if (!legacy) return validate(state);
    for (const key of ['transactions','recurring','budgets','goals']) require(Array.isArray(state[key]),'Sezione obbligatoria mancante: '+key);
    for (const key of Object.keys(collections)) if (!Object.hasOwn(state,key)) state[key]=[];
    // Preserve the original file as a recovery copy before any actual restore.
    const names = new Set(state.members.map(m=>m.name));
    for (const key of ['transactions','recurring','payment_plans','budgets','accounts']) {
      require(Array.isArray(state[key]),'Sezione non valida: '+key);
      for (const item of state[key]) {
        const name=item?.owner;
        if (typeof name==='string' && name.trim().length>=2 && !['Famiglia','Non attribuito'].includes(name) && !names.has(name)) {
          state.members.push({id:'member-'+crypto.randomUUID(),name,active:true}); names.add(name);
        }
      }
    }
    state.format='quadra-family-v1'; state.version=5; state.accounts_initialized=true;
    return validate(state);
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
    return value;
  }
  async function fingerprint(record) {
    validate(record.state);
    const hashes=[];
    for (const {meta} of documents(record.state)) {
      const blob=record.documents?.[meta.id];
      require(blob && blob.size===meta.size,'Documento locale mancante o incompleto');
      hashes.push([meta.id,await sha(await blob.arrayBuffer())]);
    }
    hashes.sort((a,b)=>a[0].localeCompare(b[0]));
    return sha(new TextEncoder().encode(JSON.stringify([canonical(record.state),hashes])));
  }
  function documents(state) {
    const result = [];
    for (const tx of state.transactions) for (const meta of tx.attachments || []) result.push({ path: 'allegati/' + meta.id + extensions[meta.mime_type], meta });
    for (const stmt of state.statements) if (stmt.document) result.push({ path: 'estratti/' + stmt.document.id + '.pdf', meta: stmt.document });
    const ids = new Set();
    for (const { meta } of result) {
      if (!/^[a-f0-9]{32}$/.test(meta.id) || !extensions[meta.mime_type] || ids.has(meta.id)) throw new Error('Metadati documento non validi');
      ids.add(meta.id);
    }
    return result;
  }
  async function sha(bytes) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2,'0')).join('');
  }
  function unpack(bytes, limit = 420 * MB) {
    let total = 0, count = 0;
    const names = new Set();
    return fflate.unzipSync(bytes, { filter(entry) {
      if (++count > 10000 || (total += entry.originalSize) > limit || entry.originalSize > 12 * MB || entry.originalSize < 0) throw new Error('ZIP oltre i limiti consentiti');
      if (entry.name.startsWith('/') || entry.name.includes('..') || /[\\:]/.test(entry.name) || names.has(entry.name)) throw new Error('Nome file ZIP non sicuro o duplicato');
      names.add(entry.name); return !entry.name.endsWith('/');
    } });
  }
  async function backup(record) {
    validate(record.state);
    const files = { 'archivio.json': fflate.strToU8(JSON.stringify(record.state)) };
    for (const { path, meta } of documents(record.state)) {
      const blob = record.documents?.[meta.id];
      if (!blob || blob.size !== meta.size) throw new Error('Documento mancante o incompleto: ' + meta.name);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (mime(bytes) !== meta.mime_type) throw new Error('Formato documento non valido: ' + meta.name);
      files[path] = bytes;
    }
    const hashes = {};
    for (const [path, bytes] of Object.entries(files)) hashes[path] = await sha(bytes);
    files['manifest.json'] = fflate.strToU8(JSON.stringify({ format: 'quadra-complete-backup-v1', sha256: hashes, created_at: new Date().toISOString() }));
    return new Blob([fflate.zipSync(files)], { type: 'application/zip' });
  }
  async function restore(blob, filename) {
    if (!blob.size || blob.size > 200 * MB) throw new Error('Backup vuoto o oltre 200 MB');
    let files, raw, prefix = '';
    if (/\.json$/i.test(filename)) {
      if (blob.size > 12 * MB) throw new Error('JSON oltre 12 MB');
      raw = new Uint8Array(await blob.arrayBuffer());
    } else if (/\.zip$/i.test(filename)) {
      files = unpack(new Uint8Array(await blob.arrayBuffer()));
      const archives = Object.keys(files).filter(x => /^(?:[^/]+\/)?archivio\.json$/.test(x));
      if (archives.length !== 1) throw new Error('Lo ZIP deve contenere un solo archivio.json');
      prefix = archives[0].slice(0, -'archivio.json'.length); raw = files[archives[0]];
    } else throw new Error('Usa un backup ZIP o JSON');
    const state = migrateLegacy(JSON.parse(fflate.strFromU8(raw)));
    const docs = {};
    const manifest = files?.[prefix + 'manifest.json'];
    let hashes = null;
    if (manifest) {
      const decoded = JSON.parse(fflate.strFromU8(manifest));
      require(decoded?.format === 'quadra-complete-backup-v1' && decoded.sha256 && typeof decoded.sha256 === 'object' && !Array.isArray(decoded.sha256),'Manifest backup non valido');
      hashes=decoded.sha256;
      require(Object.values(hashes).every(hash=>typeof hash==='string' && /^[a-f0-9]{64}$/.test(hash)),'Checksum manifest non valido');
      require(hashes['archivio.json'] === await sha(raw),'Checksum archivio non valido');
    }
    for (const { path, meta } of documents(state)) {
      const bytes = files?.[prefix + path];
      if (!bytes || bytes.length > 12 * MB || bytes.length !== meta.size || mime(bytes) !== meta.mime_type) throw new Error('Documento mancante o corrotto: ' + path);
      if (hashes && hashes[path] !== await sha(bytes)) throw new Error('Checksum documento non valido');
      docs[meta.id] = new Blob([bytes], { type: meta.mime_type });
    }
    if (hashes) {
      const expected = new Set(['archivio.json',...documents(state).map(x=>x.path)]);
      require(Object.keys(hashes).length === expected.size && Object.keys(hashes).every(path=>expected.has(path)),'Manifest backup incompleto o incoerente');
    }
    const summary = { kind: files ? 'ZIP' : 'JSON', files: Object.keys(docs).length, integrity: hashes ? 'verified' : 'legacy-unverified' };
    for (const key of ['transactions','members','accounts','categories','recurring','payment_plans','budgets','statements']) summary[key] = state[key].length;
    return { state, documents: docs, summary };
  }
  async function parseImport(blob, filename, chosen) {
    if (!blob.size || blob.size > 12 * MB) throw new Error('File vuoto o oltre 12 MB');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const xlsx = /\.xlsx$/i.test(filename);
    if (!xlsx && !/\.(csv|txt)$/i.test(filename)) throw new Error('Sono supportati XLSX e CSV');
    if (xlsx) unpack(bytes, 40 * MB); // Bound decompression before handing input to SheetJS.
    let input = bytes;
    if (!xlsx) {
      try { input = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { input = new TextDecoder('windows-1252').decode(bytes); }
    }
    const book = XLSX.read(input, { type: xlsx ? 'array' : 'string', raw: !xlsx, cellDates: false, sheetRows: 12001 });
    const sheet = chosen || book.SheetNames[0];
    if (!book.Sheets[sheet]) throw new Error('Foglio non trovato');
    const grid = XLSX.utils.sheet_to_json(book.Sheets[sheet], { header: 1, raw: false, defval: '', blankrows: true });
    const rows = grid.slice(0,12000).map((cells,i) => ({ source_row: i+1, cells: cells.slice(0,55).map(String) })).filter(row => row.cells.some(x => x.trim()));
    return { file_type: xlsx ? 'xlsx' : 'csv', sheet, sheets: book.SheetNames, rows, truncated: grid.length > 12000 };
  }
  window.QuadraData = { validate, migrateLegacy, documents, mime, backup, restore, parseImport, sha, fingerprint };
})();
