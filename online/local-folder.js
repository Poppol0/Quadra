'use strict';
(() => {
  let handle, loaded = false, queue = Promise.resolve(), status = '', mandatory = false, opened = false, needsAuthorization = false;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const notify = (message,error=false) => typeof toast === 'function' ? toast(message,error) : console.info(message);
  const escape = text => String(text).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function loadHandle() {
    if (loaded) return;
    handle = await QuadraBrowser.access('readonly',(store,done) => {
      store.get('local-folder').onsuccess = event => done(event.target.result);
    });
    loaded = true;
    needsAuthorization = !!handle && await handle.queryPermission({mode:'readwrite'}) !== 'granted';
  }
  const diskKey='local-folder-fingerprint-v2';
  const readMarker=()=>QuadraBrowser.access('readonly',(store,done)=>{store.get(diskKey).onsuccess=e=>done(e.target.result);});
  const markDisk=hash=>QuadraBrowser.access('readwrite',store=>store.put(hash,diskKey));
  async function write() {
    await loadHandle();
    if (!opened && !mandatory) return;
    if (!handle) throw new Error('Collega una cartella locale prima di salvare.');
    needsAuthorization = await handle.queryPermission({mode:'readwrite'}) !== 'granted';
    if (needsAuthorization) throw new Error('Autorizza di nuovo la cartella locale per salvare sul disco.');
    const record = await QuadraBrowser.current();
    const hash=await QuadraData.fingerprint(record);
    const blob = await QuadraData.backup(record);
    // Do not overwrite an externally modified file or an unrecognized archive.
    let existing;
    try { existing=await (await handle.getFileHandle('Quadra.zip')).getFile(); }
    catch(error){if(error.name!=='NotFoundError')throw error;}
    if(existing){
      const actual=await QuadraData.fingerprint(await QuadraData.restore(existing,'Quadra.zip'));
      if(actual!==await readMarker() && actual!==hash)throw new Error('Archivio su disco modificato: riapri Quadra e scegli quale copia conservare.');
    }
    const file = await handle.getFileHandle('Quadra.zip',{create:true});
    const stream = await file.createWritable();
    try { await stream.write(blob); await stream.close(); }
    catch (error) { await stream.abort().catch(() => {}); throw error; }
    const verified=await QuadraData.fingerprint(await QuadraData.restore(await file.getFile(),'Quadra.zip'));
    if(verified!==hash)throw new Error('Verifica della copia su disco non riuscita.');
    await markDisk(hash);
    status = 'Archivio su disco aggiornato: ' + handle.name;
    const node = document.querySelector('[data-folder-status]'); if (node) node.textContent = status;
  }
  function persist() {
    queue = queue.catch(() => {}).then(async () => {
      try {
        if (navigator.locks) await navigator.locks.request('quadra-local-folder',write);
        else await write();
      } catch (error) {
        status = 'Salvataggio su disco non riuscito. ' + error.message;
        const node = document.querySelector('[data-folder-status]'); if (node) node.textContent = status;
        notify(status,true);
        if (mandatory) throw error;
      }
    });
    return queue;
  }
  async function connect({enter = false,change = false} = {}) {
    let chosen;
    if (!change && handle?.requestPermission) {
      if (await handle.requestPermission({mode:'readwrite'}) !== 'granted') throw new Error('Permesso di scrittura non concesso.');
      chosen = handle;
    }
    // Invoke the picker directly in the click gesture, before any async reads.
    else chosen = await window.showDirectoryPicker({id:'quadra-local',mode:'readwrite'});
    let existing;
    try { existing = await (await chosen.getFileHandle('Quadra.zip')).getFile(); }
    catch (error) { if (error.name !== 'NotFoundError') throw error; }
    if (change && existing) throw new Error('La destinazione contiene già Quadra.zip. Scegli una cartella nuova per evitare di sovrascrivere un altro archivio.');
    if (change && !confirm('Copiare l’archivio attuale nella nuova cartella? Da ora i salvataggi useranno questa posizione. La cartella precedente resterà intatta.')) return;
    let pack, keepLocal=false, diskHash;
    if(existing){
      pack=await QuadraData.restore(existing,'Quadra.zip');
      diskHash=await QuadraData.fingerprint(pack);
      const local=await QuadraBrowser.current();
      const localHash=await QuadraData.fingerprint(local);
      if(localHash===diskHash){pack=null;keepLocal=false;}
      else {
        // Always ask even on startup: a previous write may have failed.
        const choice=await chooseArchive();
        if(choice==='cancel')throw new Error('Apertura annullata: copie conservate.');
        if((await QuadraBrowser.current()).revision!==local.revision)throw new Error('Archivio modificato durante la scelta. Riprova.');
        await QuadraBrowser.checkpoint();
        await QuadraBrowser.keepBackup(existing,'disk');
        if(choice==='local'){pack=null;keepLocal=true;}
        else pack.expectedRevision=local.revision;
      }
    }
    const previous = {handle,loaded,opened,marker:await readMarker()};
    handle = chosen; loaded = true; opened = true;
    try {
      if(existing)await markDisk(diskHash);
      else await markDisk(null);
      if(pack)await QuadraBrowser.save(pack.state,{documents:pack.documents},pack.expectedRevision,{fromDisk:true});
      else if(!existing || keepLocal){queue=queue.catch(()=>{}).then(()=>navigator.locks?navigator.locks.request('quadra-local-folder',write):write());await queue;}
      await QuadraBrowser.access('readwrite',store => store.put(chosen,'local-folder'));
    } catch (error) {
      handle=previous.handle; loaded=previous.loaded; opened=previous.opened; await markDisk(previous.marker); throw error;
    }
    if (!enter) await window.QuadraOnlineReload?.();
    status = 'Archivio locale: '+handle.name;
    needsAuthorization = false;
    notify(status || 'Cartella locale collegata.');
  }
  function chooseArchive(){
    return new Promise(resolve=>{
      const modal=document.createElement('div');modal.className='modal-backdrop';
      modal.innerHTML='<div class="modal" role="dialog" aria-modal="true"><h2>Due copie diverse dell’archivio</h2><p class="explain">La copia nel browser e quella nella cartella non coincidono. Conserviamo entrambe prima di sostituirne una. Scegli quale usare.</p><div class="backup-actions"><button class="btn" data-copy-choice="cancel">Annulla</button><button class="btn" data-copy-choice="disk">Usa copia su disco</button><button class="btn primary" data-copy-choice="local">Usa copia nel browser</button></div></div>';
      modal.addEventListener('click',event=>{const choice=event.target.closest('[data-copy-choice]')?.dataset.copyChoice;if(choice){modal.remove();resolve(choice);}});
      document.body.append(modal);modal.querySelector('[data-copy-choice="cancel"]').focus();
    });
  }
  async function enterLocal() {
    mandatory = !isIOS();
    if (!mandatory) { window.QuadraIphoneBackup?.enable(); return; }
    if (typeof window.showDirectoryPicker !== 'function') throw new Error('Per lavorare senza Drive serve un browser che supporti le cartelle locali, come Chrome aggiornato su Android o PC.');
    await loadHandle();
    if (handle && await handle.queryPermission({mode:'readwrite'}) === 'granted') {
      await connect({enter:true});
      return;
    }
    await new Promise((resolve,reject) => {
      const previousFocus = document.activeElement;
      const modal = document.createElement('div'); modal.className = 'modal-backdrop';
      modal.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="local-folder-title"><div class="modal-head"><h2 id="local-folder-title">Il tuo archivio sul dispositivo</h2></div><p class="explain">Per usare Quadra senza Google, scegli una cartella dove conservare i tuoi dati. Al primo accesso, crea una cartella con il nome che preferisci (ad esempio Quadra) dal selettore oppure dal gestore file del dispositivo e poi selezionala. Se non contiene ancora un archivio, Quadra.zip viene creato automaticamente. Se hai già usato Quadra, scegli la cartella esistente.</p><p class="explain">Il file <strong>Quadra.zip</strong> verrà aggiornato dopo ogni operazione. Se è già presente, Quadra caricherà il suo contenuto. La cartella potrà essere gestita dalle <strong>Impostazioni</strong> dell’app.</p><p class="account-caution" data-folder-error role="alert" hidden></p><div class="backup-actions"><button class="btn" type="button" data-folder-cancel>Annulla</button><button class="btn primary" type="button" data-folder-choose>Scegli cartella</button></div></div>';
      const choose = modal.querySelector('[data-folder-choose]'), cancel = modal.querySelector('[data-folder-cancel]');
      if (handle) {
        modal.querySelector('.explain').textContent = 'La cartella locale è già impostata: '+handle.name+'. Autorizza di nuovo l’accesso per aprire il tuo archivio. Non devi scegliere un’altra cartella.';
        choose.textContent = 'Autorizza e apri archivio';
      }
      const close = () => { modal.remove(); previousFocus?.focus(); };
      cancel.onclick = () => { close(); const error = new Error('Collegamento annullato'); error.name='AbortError'; reject(error); };
      modal.addEventListener('keydown',event => { if (event.key === 'Escape' && !choose.disabled) cancel.click(); });
      choose.onclick = async () => {
        const message = modal.querySelector('[data-folder-error]');
        message.hidden=true; message.textContent='';
        choose.disabled=true; cancel.disabled=true;
        try { await connect({enter:true}); close(); resolve(); }
        catch (error) {
          message.textContent = error.name === 'AbortError' ? 'Nessuna cartella selezionata. Puoi riprovare oppure annullare.' : error.message;
          message.hidden=false;
          choose.disabled=false; cancel.disabled=false;
        }
      };
      document.body.append(modal); choose.focus();
    });
  }
  function useDrive() { mandatory = false; opened=false; window.QuadraIphoneBackup?.disable(); }
  async function showRecovery(){
    const modal=document.createElement('div');modal.className='modal-backdrop';
    modal.innerHTML='<div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="Copie di recupero"><div class="modal-head"><h2>Copie di recupero</h2><button class="icon-btn" type="button" data-recovery-close aria-label="Chiudi">×</button></div><p class="explain">Esporta una copia ZIP prima di ripristinarla con la funzione Ripristina un archivio completo. I dati attuali non vengono modificati da questo elenco.</p><div data-recovery-list></div></div>';
    modal.querySelector('[data-recovery-close]').onclick=()=>modal.remove();
    const list=modal.querySelector('[data-recovery-list]');
    document.body.append(modal);
    try{
      const keys=await QuadraBrowser.recoveryKeys();
      if(!keys.length){list.textContent='Nessuna copia di recupero disponibile.';return;}
      for(const key of keys){
        const row=document.createElement('div');row.className='backup-actions';
        const label=document.createElement('span');label.textContent=key.replace(/^backup:/,'').replace(/:[0-9a-f-]{36}$/,'');row.append(label);
        const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Esporta ZIP';
        button.onclick=async()=>{button.disabled=true;try{const blob=await QuadraBrowser.recoveryBlob(key);const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='Quadra_recupero_'+key.replace(/[^A-Za-z0-9_-]/g,'_')+'.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(error){notify(error.message,true);}finally{button.disabled=false;}};
        row.append(button);list.append(row);
      }
    }catch(error){list.textContent=error.message;}
  }
  function controls() {
    const supported = typeof window.showDirectoryPicker === 'function';
    const actions = !supported ? '' : !handle
      ? '<button class="btn" type="button" data-local-folder>Collega cartella locale</button>'
      : `${needsAuthorization?'<button class="btn" type="button" data-local-folder>Autorizza accesso</button>':''}<button class="btn" type="button" data-local-folder-change>Cambia cartella</button>`;
    return `<article class="card local-folder-card"><h2>Archivio sul dispositivo</h2><p>${supported ? 'Senza Drive, Quadra.zip nella cartella scelta è il tuo archivio: viene letto all’accesso e aggiornato dopo ogni operazione. Resta sul disco anche cancellando i dati del sito.' : 'Su iPhone i dati restano nel browser: esporta un backup ZIP in File. Sugli altri dispositivi usa Drive oppure un browser con supporto alle cartelle locali.'}</p><div class="backup-actions">${actions}<button class="btn" type="button" data-recovery-list-open>Copie di recupero</button></div><p data-folder-status role="status">${escape(status || (handle?'Cartella collegata: '+handle.name:'Nessuna cartella locale collegata.'))}</p></article>`;
  }
  window.QuadraLocalFolder = {persist,connect,controls,enterLocal,useDrive};
  document.addEventListener('click',event => {
    if(event.target.closest('[data-recovery-list-open]')){showRecovery();return;}
    const change = !!event.target.closest('[data-local-folder-change]');
    if (!change && !event.target.closest('[data-local-folder]')) return;
    connect({change}).catch(error => { if (error.name !== 'AbortError') notify(error.message,true); });
  });
  loadHandle().catch(error => notify('Cartella locale: '+error.message,true));
})();
