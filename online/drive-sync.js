'use strict';
(() => {
  const SETTINGS = 'quadra-drive-settings-v1';
  let token, expires = 0, running, started = false, syncing = false;
  const spinner = '<span class="sync-spinner" aria-hidden="true"></span>';
  const googleLabel = '<svg class="google-icon" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24.8v7.42h10.54a9.01 9.01 0 0 1-3.91 5.91v4.91h6.33c3.7-3.41 5.85-8.43 5.85-14.32Z"/><path fill="#34A853" d="M24.8 43.6c5.28 0 9.71-1.75 12.95-4.82l-6.33-4.91c-1.75 1.17-3.98 1.88-6.62 1.88-5.1 0-9.43-3.44-10.98-8.08H7.29v5.06A19.56 19.56 0 0 0 24.8 43.6Z"/><path fill="#FBBC05" d="M13.82 27.67a11.76 11.76 0 0 1 0-7.34v-5.06H7.29a19.56 19.56 0 0 0 0 17.46l6.53-5.06Z"/><path fill="#EA4335" d="M24.8 12.25c2.88 0 5.46.99 7.5 2.94l5.62-5.62A18.8 18.8 0 0 0 24.8 4.4 19.56 19.56 0 0 0 7.29 15.27l6.53 5.06c1.55-4.64 5.88-8.08 10.98-8.08Z"/></svg><span>Accedi con Google</span>';
  function busy(value) {
    syncing = value;
    for (const button of document.querySelectorAll('[data-drive-sync],[data-drive-login]')) {
      button.disabled = value; button.setAttribute('aria-busy',String(value));
      button.innerHTML = value ? spinner + '<span>Sincronizzazione…</span>' : (button.hasAttribute('data-drive-login') || !settings().connected ? googleLabel : 'Sincronizza');
    }
    for (const button of document.querySelectorAll('[data-drive-local]')) button.disabled = value;
  }
  const settings = () => {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(SETTINGS) || '{}'); } catch {}
    return { ...stored, ...window.QuadraGoogleConfig };
  };
  const notify = (message, error = false) => typeof toast === 'function' ? toast(message,error) : console.info(message);
  async function authorize() {
    if (token && Date.now() < expires) return;
    const config = settings();
    let needsGesture = false;
    if (!window.google?.accounts?.oauth2) {
      needsGesture = true;
      await new Promise((resolve,reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.onload = resolve; script.onerror = () => reject(new Error('Accesso Google non disponibile. Controlla la connessione.'));
        document.head.append(script);
      });
    }
    await new Promise((resolve,reject) => {
      const client = google.accounts.oauth2.initTokenClient({ client_id: config.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: response => {
          if (response.error || !response.access_token) return reject(new Error(response.error || 'Accesso Google non riuscito'));
          token = response.access_token; expires = Date.now() + (Number(response.expires_in)-60)*1000; resolve();
        }, error_callback: () => reject(new Error('Accesso Google annullato o popup bloccato'))
      });
      if (!needsGesture) { client.requestAccessToken({ prompt: '' }); return; }
      const modal = document.createElement('div'); modal.className = 'modal-backdrop';
      modal.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="Accesso Google"><div class="modal-head"><h2>Google Drive</h2></div><p class="explain">Accedi per sincronizzare lo spazio collegato.</p><div class="backup-actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-login>Accedi a Google Drive</button></div></div>';
      modal.querySelector('[data-login]').onclick = () => { modal.remove(); client.requestAccessToken({ prompt: '' }); };
      modal.querySelector('[data-cancel]').onclick = () => { modal.remove(); reject(new Error('Accesso Google annullato')); };
      document.body.append(modal);
    });
  }
  async function request(path, options = {}) {
    const response = await fetch(path.startsWith('https:') ? path : 'https://www.googleapis.com/drive/v3/' + path, {
      ...options, headers: { ...options.headers, Authorization: 'Bearer ' + token }
    });
    if (!response.ok) {
      if (response.status === 412) throw new Error('Archivio Drive modificato da un altro dispositivo. Nessun dato sovrascritto: ripeti la sincronizzazione.');
      if (response.status === 401) { token = null; expires = 0; }
      throw new Error(response.status === 401 ? 'Accesso Google scaduto. Premi Sincronizza per accedere di nuovo.' : 'Google Drive: errore ' + response.status);
    }
    return response;
  }
  async function workspaceFiles(workspace) {
    const files = []; let pageToken = '';
    do {
      const params = new URLSearchParams({ q: `trashed = false and appProperties has { key='quadraWorkspace' and value='${workspace}' }`,
        fields: 'nextPageToken,files(id,name,size,version,appProperties)', pageSize: '1000' });
      if (pageToken) params.set('pageToken',pageToken);
      const page = await (await request('files?' + params)).json();
      files.push(...page.files.filter(file => file.appProperties?.quadraWorkspace === workspace)); pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }
  async function snapshots(workspace) {
    const bound = await readMetadata(workspace);
    if (bound?.head) {
      const id = bound.head.split(':')[0];
      const response = await request('files/' + encodeURIComponent(id) + '?fields=id,name,size,version,appProperties');
      return [await response.json()];
    }
    const files = await workspaceFiles(workspace);
    const archives = files.filter(file => file.appProperties.quadraRole === 'archive');
    if (archives.length) return archives;
    const parents = new Set(files.flatMap(file => JSON.parse(file.appProperties.quadraParents || '[]')));
    return files.filter(file => !parents.has(file.id));
  }
  async function cleanup(workspace, activeId) {
    const files = await workspaceFiles(workspace);
    for (const file of files) {
      const properties = file.appProperties;
      const createdByQuadra = properties?.quadraRole === 'archive' || typeof properties?.quadraParents === 'string';
      if (file.id === activeId || !createdByQuadra || properties?.quadraWorkspace !== workspace || !/^Quadra(?:_.*)?\.zip$/i.test(file.name || '')) continue;
      await request('files/' + encodeURIComponent(file.id),{
        method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({trashed:true})
      });
    }
  }
  async function finish(workspace, file) {
    try { await cleanup(workspace,file.id); }
    catch { notify('Sincronizzazione completata; pulizia dei vecchi ZIP non riuscita. Riprova con Sincronizza.',true); return; }
    notify('Sincronizzazione completata.');
  }
  async function fingerprint(record) {
    const hashes = [];
    for (const { meta } of QuadraData.documents(record.state)) {
      const blob = record.documents?.[meta.id];
      if (!blob) throw new Error('Documento locale mancante');
      hashes.push([meta.id, await QuadraData.sha(await blob.arrayBuffer())]);
    }
    hashes.sort((a,b) => a[0].localeCompare(b[0]));
    return QuadraData.sha(new TextEncoder().encode(JSON.stringify([record.state,hashes])));
  }
  async function readMetadata(workspace) {
    return QuadraBrowser.access('readonly',(store,done) => {
      store.get('drive:' + workspace).onsuccess = event => done(event.target.result);
    });
  }
  async function remember(workspace, head, hash) {
    await QuadraBrowser.access('readwrite',store => store.put({ head, hash },'drive:' + workspace));
  }
  const remoteKey = file => file.version ? file.id + ':' + file.version : file.id;
  async function publish(record, workspace, files) {
    if (files.length > 1) throw new Error('Sono presenti più archivi Drive. Verifica le copie esistenti prima di sincronizzare.');
    const blob = await QuadraData.backup(record);
    const metadata = { name: 'Quadra.zip', mimeType: 'application/zip',
      appProperties: { quadraWorkspace: workspace, quadraRole: 'archive' } };
    if (files.length) {
      const file = files[0];
      // v3 does not expose the file ETag reliably in browser response headers.
      // v2 explicitly exposes it in JSON and accepts conditional content updates.
      const response = await request('https://www.googleapis.com/drive/v2/files/' + encodeURIComponent(file.id) + '?fields=id,version,etag');
      const latest = await response.json(), etag = latest.etag;
      if (remoteKey(latest) !== remoteKey(file)) throw new Error('Archivio Drive aggiornato durante la sincronizzazione. Riprova.');
      if (!etag) throw new Error('Drive non ha fornito il controllo di versione necessario: aggiornamento annullato per proteggere i dati.');
      const previous = await request('files/' + encodeURIComponent(file.id) + '?alt=media');
      const oldBlob = await previous.blob();
      await QuadraBrowser.access('readwrite',store => store.put(oldBlob,'backup:drive:' + new Date().toISOString()));
      // Apply the precondition to the actual content update, not just session creation.
      const boundary = 'quadra_' + crypto.randomUUID();
      const v2metadata = {title:metadata.name,mimeType:metadata.mimeType,properties:Object.entries(metadata.appProperties).map(([key,value]) => ({key,value,visibility:'PRIVATE'}))};
      const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,JSON.stringify(v2metadata),
        `\r\n--${boundary}\r\nContent-Type: application/zip\r\n\r\n`,blob,`\r\n--${boundary}--`]);
      const updated = await request('https://www.googleapis.com/upload/drive/v2/files/' + encodeURIComponent(file.id) + '?uploadType=multipart&fields=id,version', {
        method:'PUT',headers:{'Content-Type':'multipart/related; boundary=' + boundary,'If-Match':etag},body
      });
      return updated.json();
    }
    const response = await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,version', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/zip', 'X-Upload-Content-Length': String(blob.size) }, body: JSON.stringify(metadata)
    });
    const location = response.headers.get('Location');
    if (!location || new URL(location).origin !== 'https://www.googleapis.com') throw new Error('Sessione upload Drive non valida');
    return (await request(location,{ method:'PUT', headers:{'Content-Type':'application/zip'},body:blob })).json();
  }
  async function pull(file) {
    if (Number(file.size) > 200*1024*1024) throw new Error('Archivio Drive oltre 200 MB');
    const blob = await (await request('files/' + encodeURIComponent(file.id) + '?alt=media')).blob();
    return QuadraData.restore(blob,'drive.zip');
  }
  function plan(base, localHash, heads) {
    if (heads.length > 1) return 'conflict';
    if (!heads.length) return base ? 'conflict' : 'push';
    if (!base) return 'first-contact';
    const remoteChanged = remoteKey(heads[0]) !== base.head;
    const localChanged = localHash !== base.hash;
    return remoteChanged ? (localChanged ? 'conflict' : 'pull') : (localChanged ? 'push' : 'idle');
  }
  function resolveChoice() {
    return new Promise(resolve => {
      const modal = document.createElement('div'); modal.className = 'modal-backdrop';
      modal.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="Conflitto di sincronizzazione"><div class="modal-head"><h2>Versioni diverse dell’archivio</h2></div><p class="explain">Scegli quale versione usare. Prima di sostituire un archivio viene conservata una copia di sicurezza su questo dispositivo.</p><div class="backup-actions"><button class="btn" data-choice="cancel">Annulla</button><button class="btn" data-choice="remote">Usa versione Drive</button><button class="btn primary" data-choice="local">Usa versione di questo dispositivo</button></div></div>';
      modal.addEventListener('click',event => {
        const choice = event.target.closest('[data-choice]')?.dataset.choice;
        if (choice) { modal.remove(); resolve(choice); }
      }); document.body.append(modal);
    });
  }
  async function sync(manual = false) {
    if (running) return running;
    busy(true);
    notify('Sincronizzazione in corso');
    running = (async () => {
      const config = settings();
      if (!config.clientId || !config.workspace) throw new Error('Collega prima Google Drive.');
      await authorize();
      const identity = await (await request('about?fields=user(permissionId)')).json();
      const account = identity.user?.permissionId;
      if (!account) throw new Error('Impossibile verificare l’account Google.');
      if (config.account && config.account !== account) throw new Error('Questo archivio locale è collegato a un altro account Google. Accedi con lo stesso account per evitare di mescolare i dati.');
      localStorage.setItem(SETTINGS,JSON.stringify({ connected:true, account }));
      const local = await QuadraBrowser.current(), hash = await fingerprint(local);
      const base = await readMetadata(config.workspace), heads = await snapshots(config.workspace);
      let action = plan(base,hash,heads);
      if (action === 'first-contact' && heads.length === 1) {
        const remote = await pull(heads[0]);
        if (await fingerprint(remote) === hash) { await remember(config.workspace,remoteKey(heads[0]),hash); await finish(config.workspace,heads[0]); return; }
        const hasData = ['transactions','accounts','members','recurring','payment_plans','budgets','goals','statements'].some(key => local.state[key]?.length);
        action = hasData ? 'conflict' : 'pull';
      }
      if (action === 'conflict') {
        if (!manual) throw new Error('Conflitto Drive rilevato: le copie sono conservate. Premi Sincronizza per scegliere la versione.');
        const choice = await resolveChoice();
        if (choice === 'cancel') throw new Error('Sincronizzazione annullata: nessun dato sostituito.');
        if (choice === 'remote' && heads.length !== 1) throw new Error('Drive contiene più versioni: scarica e verifica i backup prima di scegliere quale ripristinare.');
        action = choice === 'remote' ? 'pull' : 'push';
      }
      let active = heads[0];
      if (action === 'pull') {
        const remote = await pull(heads[0]);
        // A local edit made during the download must not be lost.
        if ((await QuadraBrowser.current()).revision !== local.revision) throw new Error('Archivio modificato durante la sincronizzazione. Riprova.');
        await QuadraBrowser.checkpoint();
        await QuadraBrowser.save(remote.state,{documents:remote.documents},local.revision);
        await remember(config.workspace,remoteKey(heads[0]),await fingerprint(remote));
      } else if (action === 'push') {
        const updated = await publish(local,config.workspace,heads);
        const after = await snapshots(config.workspace);
        if (after.length !== 1 || remoteKey(after[0]) !== remoteKey(updated)) throw new Error('Modifiche simultanee rilevate su Drive. Ripeti la sincronizzazione prima di continuare.');
        await remember(config.workspace,remoteKey(updated),hash);
        active = updated;
      }
      await finish(config.workspace,active);
      if (manual && action === 'pull') await window.QuadraOnlineReload?.();
    })();
    try { return await running; } finally { running = null; busy(false); }
  }
  async function configure() {
    window.QuadraLocalFolder?.useDrive();
    await sync(true);
    if (typeof render === 'function') render();
  }
  async function startup() {
    if (started) return; started = true;
    // Google requires an explicit gesture to reopen authorization on a new visit.
    await new Promise(resolve => {
      const boot = document.querySelector('#app .boot');
      if (!boot) { resolve(); return; }
      boot.className = 'online-welcome';
      boot.innerHTML = `<main class="welcome-card"><div class="welcome-brand"><img src="/favicon.svg" width="48" height="48" alt=""><span>Quadra<small>I CONTI DI CASA, IN ORDINE.</small></span></div><div class="welcome-copy"><span class="eyebrow">IL TUO SPAZIO, SEMPRE CON TE</span><h1>Riparti dai tuoi conti.</h1><p>Ritrova il tuo archivio con Google Drive oppure continua dai dati salvati su questo dispositivo.</p></div><div class="welcome-options"><div><strong>Con Google Drive</strong><p>All’accesso sincronizzi il tuo archivio. Poi decidi tu quando aggiornare con Sincronizza.</p></div><div><strong>Anche senza connessione</strong><p>Le operazioni si salvano sul dispositivo. Puoi collegare Google e sincronizzarle più tardi.</p></div></div><div class="welcome-actions"><button type="button" class="btn primary" data-drive-local>Usa i dati locali</button><div class="welcome-divider"><span>oppure</span></div><button type="button" class="btn" data-drive-login>Accedi con Google</button></div><p class="welcome-note">${navigator.onLine ? 'L’accesso a Google è facoltativo. I tuoi dati locali sono già disponibili.' : 'Sei offline. Puoi continuare subito con i dati locali.'}</p><p class="welcome-error" data-drive-error role="alert"></p></main>`;
      const button = boot.querySelector('[data-drive-login]');
      button.innerHTML = googleLabel;
      boot.querySelector('[data-drive-local]').onclick = async () => {
        try { await window.QuadraLocalFolder?.enterLocal(); resolve(); }
        catch (error) { boot.querySelector('[data-drive-error]').textContent = error.name === 'AbortError' ? 'Seleziona una cartella per continuare senza Drive.' : error.message; }
      };
      button.addEventListener('click',async () => {
        window.QuadraLocalFolder?.useDrive();
        button.disabled = true;
        try { await sync(false); resolve(); }
        catch (error) {
          button.disabled = false; notify(error.message,true);
          let message = boot.querySelector('[data-drive-error]');
          if (!message) { message = document.createElement('p'); message.dataset.driveError = ''; boot.append(message); }
          message.textContent = error.message;
        }
      });
    });
  }
  window.QuadraDrive = { startup, sync, configure, plan,
    controls: () => `<button class="btn" type="button" data-drive-sync aria-busy="${syncing}" ${syncing?'disabled':''}>${syncing ? spinner+'<span>Sincronizzazione…</span>' : settings().connected ? 'Sincronizza' : 'Accedi con Google'}</button>` };
  document.addEventListener('click',event => {
    if (!event.target.closest('[data-drive-sync]')) return;
    (settings().connected ? sync(true) : configure()).catch(error => notify(error.message,true));
  });
})();
