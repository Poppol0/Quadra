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
  async function write() {
    await loadHandle();
    if (!opened && !mandatory) return;
    if (!handle) throw new Error('Collega una cartella locale prima di salvare.');
    needsAuthorization = await handle.queryPermission({mode:'readwrite'}) !== 'granted';
    if (needsAuthorization) throw new Error('Autorizza di nuovo la cartella locale per salvare sul disco.');
    const record = await QuadraBrowser.current();
    const blob = await QuadraData.backup(record);
    const file = await handle.getFileHandle('Quadra.zip',{create:true});
    const stream = await file.createWritable();
    try { await stream.write(blob); await stream.close(); }
    catch (error) { await stream.abort().catch(() => {}); throw error; }
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
    let pack;
    if (existing) {
      pack = await QuadraData.restore(existing,'Quadra.zip');
      if (!enter && !confirm('Caricare l’archivio della cartella selezionata? I dati attuali verranno conservati prima del ripristino.')) return;
      await QuadraBrowser.checkpoint();
    }
    const previous = {handle,loaded,opened};
    handle = chosen; loaded = true; opened = true;
    try {
      if (pack) await QuadraBrowser.save(pack.state,{documents:pack.documents},undefined,{fromDisk:true});
      else { queue = queue.catch(() => {}).then(() => navigator.locks ? navigator.locks.request('quadra-local-folder',write) : write()); await queue; }
      await QuadraBrowser.access('readwrite',store => store.put(chosen,'local-folder'));
    } catch (error) {
      handle=previous.handle; loaded=previous.loaded; opened=previous.opened; throw error;
    }
    if (!enter) await window.QuadraOnlineReload?.();
    status = 'Archivio locale: '+handle.name;
    needsAuthorization = false;
    notify(status || 'Cartella locale collegata.');
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
  function useDrive() { mandatory = false; window.QuadraIphoneBackup?.disable(); }
  function controls() {
    const supported = typeof window.showDirectoryPicker === 'function';
    const actions = !supported ? '' : !handle
      ? '<button class="btn" type="button" data-local-folder>Collega cartella locale</button>'
      : `${needsAuthorization?'<button class="btn" type="button" data-local-folder>Autorizza accesso</button>':''}<button class="btn" type="button" data-local-folder-change>Cambia cartella</button>`;
    return `<article class="card local-folder-card"><h2>Archivio sul dispositivo</h2><p>${supported ? 'Senza Drive, Quadra.zip nella cartella scelta è il tuo archivio: viene letto all’accesso e aggiornato dopo ogni operazione. Resta sul disco anche cancellando i dati del sito.' : 'Su iPhone i dati restano nel browser: esporta un backup ZIP in File. Sugli altri dispositivi usa Drive oppure un browser con supporto alle cartelle locali.'}</p><div class="backup-actions">${actions}</div><p data-folder-status role="status">${escape(status || (handle?'Cartella collegata: '+handle.name:'Nessuna cartella locale collegata.'))}</p></article>`;
  }
  window.QuadraLocalFolder = {persist,connect,controls,enterLocal,useDrive};
  document.addEventListener('click',event => {
    const change = !!event.target.closest('[data-local-folder-change]');
    if (!change && !event.target.closest('[data-local-folder]')) return;
    connect({change}).catch(error => { if (error.name !== 'AbortError') notify(error.message,true); });
  });
  loadHandle().catch(error => notify('Cartella locale: '+error.message,true));
})();
