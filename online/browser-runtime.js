'use strict';
// Loaded only by the static build. Desktop continues to use its Go API.
(() => {
  const network = window.fetch.bind(window);
  let revision;
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open('quadra-online', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function access(mode, action) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', mode);
      let value;
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Salvataggio annullato'));
      action(transaction.objectStore('workspace'), result => { value = result; });
    });
  }
  async function load() {
    let record = await access('readonly', (store, done) => {
      store.get('current').onsuccess = event => done(event.target.result);
    });
    if (!record) {
      const response = await network('/initial-state.json');
      if (!response.ok) throw new Error('Archivio iniziale non disponibile');
      const initial = await response.json();
      // Recheck inside the write transaction: another tab may have initialized it.
      record = await access('readwrite', (store, done) => {
        store.get('current').onsuccess = event => {
          const current = event.target.result || { revision: 0, state: initial, documents: {} };
          store.put(current, 'current'); done(current);
        };
      });
    }
    revision = record.revision;
    return record.state;
  }
  function validate(value) {
    QuadraData.validate(value);
  }
  async function save(value, changes = {}, expectedRevision = revision, options = {}) {
    validate(value);
    let conflict = false;
    const next = await access('readwrite', (store, done) => {
      store.get('current').onsuccess = event => {
        const current = event.target.result;
        if (!current || current.revision !== expectedRevision) { conflict = true; return; }
        const updated = { ...current, ...changes, revision: current.revision + 1, state: value };
        store.put(updated, 'current'); done(updated.revision);
      };
    });
    if (conflict) throw new Error('Archivio modificato in un’altra scheda. Esporta le modifiche in JSON prima di ricaricare.');
    revision = next;
    if (!options.fromDisk) await window.QuadraLocalFolder?.persist();
    window.QuadraIphoneBackup?.changed();
  }
  const current = () => access('readonly', (store, done) => {
    store.get('current').onsuccess = event => done(event.target.result);
  });
  async function checkpoint() {
    await access('readwrite', store => {
      store.get('current').onsuccess = event => {
        store.put(event.target.result, 'before-import');
        store.put(event.target.result, 'backup:' + new Date().toISOString() + ':' + crypto.randomUUID());
      };
    });
  }
  async function keepBackup(value,source='local') {
    const key='backup:'+source+':'+new Date().toISOString()+':'+crypto.randomUUID();
    await access('readwrite',store=>store.put(value,key));
    return key;
  }
  async function recoveryKeys() {
    return access('readonly',(store,done)=>{
      store.getAllKeys().onsuccess=e=>done(e.target.result.filter(k=>typeof k==='string'&&k.startsWith('backup:')).sort().reverse());
    });
  }
  async function recoveryBlob(key) {
    if (!(await recoveryKeys()).includes(key)) throw new Error('Copia non disponibile');
    const value=await access('readonly',(store,done)=>{store.get(key).onsuccess=e=>done(e.target.result);});
    if (value instanceof Blob) return value;
    return QuadraData.backup(value);
  }
  async function mutate(action) {
    const expectedRevision = revision;
    const record = await current();
    const result = action(record);
    await save(record.state, { documents: record.documents || {} },expectedRevision);
    return result;
  }
  const fileURLs = new Map();
  async function hydrateFiles() {
    const record = await current();
    if (!record || !document?.body) return;
    for (const node of document.querySelectorAll('a[href^="/api/attachments/"],a[href^="/api/statement-documents/"],img[src^="/api/attachments/"]')) {
      const attribute = node.tagName === 'IMG' ? 'src' : 'href';
      const id = node.getAttribute(attribute).split('/').pop().split('?')[0];
      const blob = record.documents?.[id];
      if (!blob) continue;
      if (!fileURLs.has(id)) fileURLs.set(id, URL.createObjectURL(blob));
      node.setAttribute(attribute, fileURLs.get(id));
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    let pending = false;
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      queueMicrotask(async () => { try { await hydrateFiles(); } catch (error) { console.warn('Anteprima documento:',error.message); } finally { pending = false; } });
    }).observe(document.body, { childList: true, subtree: true });
    hydrateFiles();
  });
  window.addEventListener('pagehide', event => { if (event.persisted) return; for (const url of fileURLs.values()) URL.revokeObjectURL(url); fileURLs.clear(); });
  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' }
  });
  let bootstrapped = false;
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return network(input, options);
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers);
    const name = () => decodeURIComponent(headers.get('X-Quadra-Filename') || 'documento');
    try {
      if (url.pathname === '/api/state' && method === 'GET') {
        await load();
        if (!bootstrapped) { bootstrapped = true; await window.QuadraDrive?.startup(); }
        return json(await load());
      }
      if (url.pathname === '/api/state' && method === 'PUT') {
        await save(JSON.parse(options.body)); return json({ ok: true });
      }
      if (url.pathname === '/api/storage') return json({
        data_dir: 'Archivio nel browser di questo dispositivo (IndexedDB)',
        backup_dir: 'Download sul dispositivo', directory_picker_available: false, data_dir_locked: true
      });
      if (url.pathname === '/api/pre-import-backup' && method === 'POST') {
        await checkpoint();
        return json({ ok: true });
      }
      if (url.pathname === '/api/backup-completo.zip' && method === 'GET') return new Response(await QuadraData.backup(await current()), { headers: { 'Content-Type': 'application/zip' } });
      if (url.pathname === '/api/backup/save-to-folder' && method === 'POST') {
        const blob = await QuadraData.backup(await current());
        const link = document.createElement('a'), href = URL.createObjectURL(blob);
        link.href = href; link.download = 'Quadra_backup_completo.zip'; link.click();
        setTimeout(() => URL.revokeObjectURL(href), 30000);
        return json({ name: link.download });
      }
      if (url.pathname === '/api/parse-import' && method === 'POST') return json(await QuadraData.parseImport(options.body, name(), decodeURIComponent(headers.get('X-Quadra-Sheet') || '')));
      if (['/api/archives/inspect','/api/archives/restore'].includes(url.pathname) && method === 'POST') {
        const pack = await QuadraData.restore(options.body, name());
        if (url.pathname.endsWith('/restore')) {
          if (headers.get('X-Quadra-Action') !== 'SOSTITUISCI') throw new Error('Conferma esplicita obbligatoria');
          await checkpoint();
          await save(pack.state, { documents: pack.documents });
        }
        return json(pack.summary);
      }
      const upload = url.pathname.match(/^\/api\/(transactions|statements)\/([^/]+)\/(attachments|document)$/);
      if (upload && ['POST','DELETE'].includes(method)) {
        let blob, meta;
        if (method === 'POST') {
          blob = options.body;
          if (!blob?.size || blob.size > 12*1024*1024) throw new Error('Documento vuoto o oltre 12 MB');
          const mime = QuadraData.mime(new Uint8Array(await blob.arrayBuffer()));
          if (upload[1] === 'statements' && mime !== 'application/pdf') throw new Error('Sono consentiti solo PDF');
          const tag = decodeURIComponent(headers.get('X-Quadra-Tag') || 'scontrino');
          if (!['scontrino','ricevuta','garanzia','documento','altro'].includes(tag)) throw new Error('Etichetta non valida');
          meta = { id: crypto.randomUUID().replaceAll('-',''), name: name().split(/[\\/]/).pop(), mime_type: mime, size: blob.size, tag, uploaded_at: new Date().toISOString() };
          blob = new Blob([blob], { type: mime });
        }
        return json(await mutate(record => {
          record.documents ||= {};
          const item = record.state[upload[1]].find(x => x.id === decodeURIComponent(upload[2]));
          if (!item) throw new Error('Voce non trovata');
          if (upload[1] === 'statements') {
            if (item.document) delete record.documents[item.document.id];
            delete item.document;
            if (meta) { item.document = meta; record.documents[meta.id] = blob; }
            return { ok: true, document: meta };
          }
          item.attachments ||= [];
          if (item.attachments.length >= 20) throw new Error('Massimo 20 allegati');
          item.attachments.push(meta); record.documents[meta.id] = blob;
          return { ok: true, attachment: meta, attachments: item.attachments };
        }));
      }
      const attachment = url.pathname.match(/^\/api\/attachments\/([a-f0-9]{32})$/);
      if (attachment && method === 'DELETE') return json(await mutate(record => {
        const item = record.state.transactions.find(x => x.attachments?.some(a => a.id === attachment[1]));
        if (!item) throw new Error('Allegato non trovato');
        item.attachments = item.attachments.filter(a => a.id !== attachment[1]);
        delete record.documents?.[attachment[1]];
        return { ok: true, transaction_id: item.id, attachments: item.attachments };
      }));
      const match = url.pathname.match(/^\/api\/transactions\/([^/]+)$/);
      if (match && method === 'DELETE') {
        // Do not reload here: preserve the caller's revision for conflict detection.
        return json(await mutate(record => {
          const item = record.state.transactions.find(x => x.id === decodeURIComponent(match[1]));
          for (const doc of item?.attachments || []) delete record.documents?.[doc.id];
          record.state.transactions = record.state.transactions.filter(x => x !== item);
          return { ok: true };
        }));
      }
      return json({ error: 'Funzione non ancora disponibile nella versione online iniziale. Usa la versione desktop per allegati, ZIP e importazioni Excel/CSV.' }, 501);
    } catch (error) { return json({ error: error.message }, 409); }
  };
  window.QUADRA_ONLINE = true;
  window.QuadraBrowser = { current, save, load, checkpoint, access, keepBackup, recoveryKeys, recoveryBlob };
})();
