const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { IDBFactory } = require('fake-indexeddb');
const fflate = require('fflate');
const XLSX = require('xlsx');
const seed = () => JSON.parse(fs.readFileSync('../desktop/assets/templates/archivio_iniziale.json'));
function session(indexedDB = new IDBFactory()) {
  const context = vm.createContext({ Blob, Response, Headers, URL, URLSearchParams, TextDecoder, TextEncoder,
    Uint8Array, crypto: webcrypto, indexedDB, fflate, XLSX, setTimeout, queueMicrotask,
    location: { href: 'https://quadra.test/', origin: 'https://quadra.test' },
    document: { addEventListener() {}, querySelectorAll() { return []; } },
    addEventListener() {}, fetch: async () => new Response(JSON.stringify(seed())) });
  context.window = context;
  for (const file of ['google-config.js','data-tools.js','browser-runtime.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  return context;
}
async function api(ctx, path, method='GET', body, headers) {
  const response = await ctx.fetch(path, { method, body, headers });
  return { status: response.status, value: await response.json() };
}
test('stale tab cannot overwrite archive or upload documents', async () => {
  const db = new IDBFactory(), a = session(db), b = session(db);
  const state = (await api(a, '/api/state')).value;
  await api(b, '/api/state');
  state.transactions.push({ id: 'tx', attachments: [], amount_cents: 120 });
  assert.equal((await api(a,'/api/state','PUT',JSON.stringify(state))).status,200);
  assert.equal((await api(b,'/api/state','PUT',JSON.stringify(seed()))).status,409);
  const blob = new Blob(['%PDF-1.4\nexample'], { type: 'application/pdf' });
  assert.equal((await api(b,'/api/transactions/tx/attachments','POST',blob)).status,409);
  assert.equal((await api(a,'/api/state')).value.transactions.length,1);
});
test('PDF upload, ZIP roundtrip, checksum rejection and delete persist atomically', async () => {
  const ctx = session(), state = (await api(ctx,'/api/state')).value;
  state.transactions.push({ id: 'tx', attachments: [] });
  await api(ctx,'/api/state','PUT',JSON.stringify(state));
  const blob = new Blob(['%PDF-1.4\nexample'], { type: 'application/pdf' });
  const result = await api(ctx,'/api/transactions/tx/attachments','POST',blob, { 'X-Quadra-Filename': 'ricevuta.pdf' });
  assert.equal(result.status,200);
  const record = await ctx.QuadraBrowser.current();
  const zip = await ctx.QuadraData.backup(record);
  const restored = await ctx.QuadraData.restore(zip,'backup.zip');
  assert.equal(restored.summary.files,1);
  assert.equal(await restored.documents[result.value.attachment.id].text(), await blob.text());
  const files = fflate.unzipSync(new Uint8Array(await zip.arrayBuffer()));
  files['archivio.json'] = fflate.strToU8(JSON.stringify({ ...record.state, source: 'tampered' }));
  await assert.rejects(ctx.QuadraData.restore(new Blob([fflate.zipSync(files)]),'bad.zip'),/Checksum/);
  await api(ctx,'/api/attachments/'+result.value.attachment.id,'DELETE');
  const after = await ctx.QuadraBrowser.current();
  assert.equal(after.state.transactions[0].attachments.length,0);
  assert.equal(Object.keys(after.documents).length,0);
});
test('restore requires confirmation and preserves the previous full archive', async () => {
  const ctx = session(); await api(ctx,'/api/state');
  const state = seed(); state.transactions.push({ id: 'imported' });
  const blob = new Blob([JSON.stringify(state)]);
  const headers = { 'X-Quadra-Filename': 'backup.json' };
  assert.equal((await api(ctx,'/api/archives/restore','POST',blob,headers)).status,409);
  headers['X-Quadra-Action'] = 'SOSTITUISCI';
  assert.equal((await api(ctx,'/api/archives/restore','POST',blob,headers)).status,200);
  assert.equal((await ctx.QuadraBrowser.current()).state.transactions[0].id,'imported');
  const previous = await ctx.QuadraBrowser.access('readonly',(store,done) => {
    store.get('before-import').onsuccess = event => done(event.target.result);
  });
  assert.equal(previous.state.transactions.length,0);
});
test('CSV quoting, Italian decimals and XLSX sheet selection retain source rows', async () => {
  const ctx = session();
  const parsed = await ctx.QuadraData.parseImport(new Blob(['Data;Descrizione;Importo\n27/11/2026;"Spesa; casa";"-12,34"']),'bank.csv','');
  assert.equal(parsed.rows[1].cells[1],'Spesa; casa');
  assert.equal(parsed.rows[1].cells[2],'-12,34');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Data','Importo'],['27/11/2026',12.34]]),'Novembre');
  const blob = new Blob([XLSX.write(book,{ type:'array',bookType:'xlsx' })]);
  const excel = await ctx.QuadraData.parseImport(blob,'bank.xlsx','Novembre');
  assert.equal(excel.sheet,'Novembre');
  assert.equal(excel.rows[1].source_row,2);
  await assert.rejects(ctx.QuadraData.parseImport(blob,'bank.xlsx','Mancante'),/Foglio/);
});
test('ZIP paths, oversized entries and unknown JSON formats are rejected', async () => {
  const ctx = session();
  await assert.rejects(ctx.QuadraData.restore(new Blob([fflate.zipSync({ '../archivio.json': fflate.strToU8('{}') })]),'bad.zip'),/sicuro/);
  await assert.rejects(ctx.QuadraData.restore(new Blob(['{}']),'bad.json'),/Formato/);
  await assert.rejects(ctx.QuadraData.restore(new Blob([fflate.zipSync({ 'archivio.json': new Uint8Array(12*1024*1024+1) })]),'large.zip'),/limiti/);
});
test('Drive detects divergent heads and never chooses last-writer-wins', () => {
  const ctx = session();
  ctx.localStorage = { getItem() { return null; } };
  vm.runInContext(fs.readFileSync('drive-sync.js','utf8'),ctx);
  const plan = ctx.QuadraDrive.plan;
  assert.equal(plan(null,'local',[]),'push');
  assert.equal(plan(null,'local',[{id:'remote'}]),'first-contact');
  assert.equal(plan({head:'old',hash:'same'},'same',[{id:'new'}]),'pull');
  assert.equal(plan({head:'old',hash:'same'},'edited',[{id:'new'}]),'conflict');
  assert.equal(plan({head:'old',hash:'same'},'edited',[{id:'old'}]),'push');
  assert.equal(plan({head:'old',hash:'same'},'same',[{id:'old'}]),'idle');
  assert.equal(plan(null,'local',[{id:'branch-a'},{id:'branch-b'}]),'conflict');
});
test('Drive uploads only on explicit sync; local saves do not make network calls', async () => {
  const ctx = session(); await api(ctx,'/api/state');
  const values = { 'quadra-drive-settings-v1': JSON.stringify({clientId:'test.apps.googleusercontent.com',workspace:'family'}) };
  ctx.localStorage = { getItem: key => values[key], setItem: (key,value) => { values[key] = value; } };
  ctx.google = { accounts: { oauth2: { initTokenClient: options => ({ requestAccessToken() {
    options.callback({ access_token:'test-token',expires_in:3600 });
  } }) } } };
  const original = ctx.fetch;
  const calls = [], snapshots = [];
  let account = 'test-account';
  let rejectUpdate = false;
  let missingArchive = false;
  let legacy = null, legacyTrashed = false;
  ctx.fetch = async (url,options={}) => {
    if (!String(url).startsWith('https://www.googleapis.com/')) return original(url,options);
    calls.push({url,options});
    if (String(url).includes('/about?')) return new Response(JSON.stringify({user:{permissionId:account}}));
    if (String(url).includes('/upload/')) {
      if (options.method === 'PUT') {
        assert.equal(options.headers['If-Match'],'"version-1"');
        if (rejectUpdate) return new Response('',{status:412});
        snapshots[0].version = String(Number(snapshots[0].version)+1);
        return new Response(JSON.stringify({id:'head-1',version:snapshots[0].version}));
      }
      snapshots.push({id:'head-1',version:'1',name:'Quadra.zip',appProperties:JSON.parse(options.body).appProperties});
      return new Response('',{headers:{Location:'https://www.googleapis.com/session'}});
    }
    if (String(url).includes('/session')) {
      legacy = {id:'old-zip',name:'Quadra_2026-11-27.zip',appProperties:{quadraWorkspace:ctx.QuadraGoogleConfig.workspace,quadraParents:'[]'}};
      return new Response(JSON.stringify({id:'head-1',version:'1'}));
    }
    if (String(url).endsWith('/files/old-zip') && options.method === 'PATCH') {
      assert.deepEqual(JSON.parse(options.body),{trashed:true}); legacyTrashed=true; return new Response('{}');
    }
    if (String(url).includes('/files/head-1?alt=media')) return new Response('previous backup');
    if (String(url).includes('/files/head-1?fields=')) return missingArchive ? new Response('',{status:404}) : new Response(JSON.stringify({id:'head-1',version:snapshots[0].version,etag:'"version-1"'}));
    const unrelated = legacy ? [
      {id:'personal-zip',name:'Documenti.zip'},
      {id:'same-name',name:'Quadra.zip'},
      {id:'other-space',name:'Quadra_old.zip',appProperties:{quadraWorkspace:'other',quadraRole:'archive'}},
      {id:'unmarked',name:'Quadra_old.zip',appProperties:{quadraWorkspace:ctx.QuadraGoogleConfig.workspace}}
    ] : [];
    return new Response(JSON.stringify({files:[...snapshots,...(legacy && !legacyTrashed ? [legacy] : []),...unrelated]}));
  };
  vm.runInContext(fs.readFileSync('drive-sync.js','utf8'),ctx);
  const state = (await api(ctx,'/api/state')).value;
  state.source = 'local edit';
  await api(ctx,'/api/state','PUT',JSON.stringify(state));
  assert.equal(calls.length,0);
  await ctx.QuadraDrive.sync(true);
  assert.ok(ctx.QuadraDrive.controls().includes('Sincronizza'));
  assert.equal(calls.filter(call => call.options.method === 'POST').length,1);
  assert.equal(legacyTrashed,true);
  assert.equal(calls.some(call => call.options.method === 'DELETE'),false);
  assert.equal(calls.filter(call => call.options.method === 'PATCH').every(call => String(call.url).endsWith('/files/old-zip')),true);
  const count = calls.length;
  state.source = 'another local edit';
  await api(ctx,'/api/state','PUT',JSON.stringify(state));
  assert.equal(calls.length,count);
  await ctx.QuadraDrive.sync(true);
  assert.equal(snapshots.length,1);
  assert.equal(snapshots[0].name,'Quadra.zip');
  assert.equal(snapshots[0].version,'2');
  assert.equal(calls.filter(call => call.options.method === 'PUT' && String(call.url).includes('/upload/')).length,1);
  state.source = 'concurrent edit';
  await api(ctx,'/api/state','PUT',JSON.stringify(state));
  rejectUpdate = true;
  await assert.rejects(ctx.QuadraDrive.sync(true),/altro dispositivo/);
  assert.equal(snapshots[0].version,'2');
  assert.equal(Object.values(values).some(value => String(value).includes('test-token')),false);
  missingArchive = true;
  await assert.rejects(ctx.QuadraDrive.sync(true),/404/);
  assert.equal(calls.filter(call => call.options.method === 'POST').length,1);
  missingArchive = false;
  account = 'other-account';
  await assert.rejects(ctx.QuadraDrive.sync(true),/altro account/);
  assert.equal(calls.filter(call => call.options.method === 'POST').length,1);
});
test('service worker activates updated uploader and prefers network with offline fallback', async () => {
  const handlers = {}, cached = new Response('cached uploader');
  let activated = false, offline = false;
  const context = vm.createContext({URL,Response,location:{origin:'https://quadra.test'},
    self:{addEventListener:(name,handler) => { handlers[name] = handler; },skipWaiting:async () => {activated=true;}},
    caches:{open:async () => ({addAll:async () => {}}),match:async () => cached.clone()},
    fetch:async () => { if (offline) throw new Error('offline'); return new Response('updated uploader'); }});
  vm.runInContext(fs.readFileSync('sw.js','utf8'),context);
  let installed;
  handlers.install({waitUntil:promise => {installed=promise;}}); await installed;
  assert.equal(activated,true);
  const request = {url:'https://quadra.test/drive-sync.js',method:'GET'};
  let response;
  handlers.fetch({request,respondWith:promise => {response=promise;}});
  assert.equal(await (await response).text(),'updated uploader');
  offline=true;
  handlers.fetch({request,respondWith:promise => {response=promise;}});
  assert.equal(await (await response).text(),'cached uploader');
});
test('linked folder gets an independent ZIP after each local save without Google', async () => {
  const { JSDOM } = require('jsdom');
  const folderDOM = new JSDOM('<body></body>');
  const ctx = session();
  await api(ctx,'/api/state');
  let disk, writes=0, permission='granted';
  const handle = {name:'Quadra locale',queryPermission:async () => permission,
    requestPermission:async () => permission,
    getFileHandle:async (name,options) => {
      assert.equal(name,'Quadra.zip');
      if (!options?.create) {
        if (disk) return {getFile:async () => disk};
        const error = new Error('missing'); error.name='NotFoundError'; throw error;
      }
      return {createWritable:async () => ({write:async blob => {disk=blob;writes++;},close:async () => {},abort:async () => {}})};
    }};
  ctx.document = folderDOM.window.document;
  ctx.navigator = {};
  ctx.showDirectoryPicker = async () => handle;
  let savedHandle;
  ctx.QuadraBrowser.access = async (mode,action) => {
    let value;
    action({get:() => ({set onsuccess(callback) {callback({target:{result:savedHandle}});}}),put(value) {savedHandle=value;}},result => {value=result;});
    return value;
  };
  vm.runInContext(fs.readFileSync('local-folder.js','utf8'),ctx);
  const entering = ctx.QuadraLocalFolder.enterLocal();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(ctx.document.querySelector('[data-folder-choose]'));
  ctx.document.querySelector('[data-folder-choose]').click();
  await entering;
  writes=0;
  const state = (await api(ctx,'/api/state')).value;
  state.source='offline local change';
  assert.equal((await api(ctx,'/api/state','PUT',JSON.stringify(state))).status,200);
  assert.equal(writes,1);
  const restored = await ctx.QuadraData.restore(disk,'Quadra.zip');
  assert.equal(restored.state.source,'offline local change');
  state.source='next operation';
  assert.equal((await api(ctx,'/api/state','PUT',JSON.stringify(state))).status,200);
  assert.equal(writes,2);
  permission='denied';
  state.source='browser still saves';
  assert.equal((await api(ctx,'/api/state','PUT',JSON.stringify(state))).status,409);
  assert.equal(writes,2);
  assert.equal((await ctx.QuadraBrowser.current()).state.source,'browser still saves');
  permission='granted';
  const reopened = session(); await api(reopened,'/api/state');
  reopened.navigator={}; reopened.showDirectoryPicker=async () => handle;
  reopened.document=folderDOM.window.document;
  reopened.QuadraBrowser.access=ctx.QuadraBrowser.access;
  vm.runInContext(fs.readFileSync('local-folder.js','utf8'),reopened);
  const reopening = reopened.QuadraLocalFolder.enterLocal();
  await reopening;
  assert.equal(reopened.document.querySelector('[data-folder-choose]'),null);
  assert.equal((await reopened.QuadraBrowser.current()).state.source,'next operation');
  folderDOM.window.close();
});
