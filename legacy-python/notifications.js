/* Quadra: avvisi locali all'apertura, predisposizione PWA (non push remota). */
'use strict';
const NOTIFY_KEY='quadra-notify-local-v1';
function notifyPrefs(){
 try{const p=JSON.parse(localStorage.getItem(NOTIFY_KEY)||'{}');return {enabled:p.enabled===true,days:[1,3,7,14,30].includes(Number(p.days))?Number(p.days):7};}
 catch(_){return {enabled:false,days:7};}
}
function saveNotifyPrefs(p){localStorage.setItem(NOTIFY_KEY,JSON.stringify(p));}
function notifySupport(){return typeof Notification!=='undefined'&&window.isSecureContext&&'serviceWorker'in navigator;}
function renderNotificationSettings(){
 const p=notifyPrefs(),permission=typeof Notification==='undefined'?'unsupported':Notification.permission;
 const status=!window.isSecureContext?'Origine non sicura: le notifiche richiedono HTTPS o localhost.':!('serviceWorker'in navigator)?'Questo browser non supporta i Service Worker.':permission==='granted'?(p.enabled?'Avvisi locali abilitati: controllo all’apertura dell’app.':'Permesso concesso, ma avvisi disattivati.'):
 permission==='denied'?'Notifiche bloccate nelle impostazioni del browser.':'Permesso notifiche non ancora richiesto.';
 return `<article class="card notification-settings"><div class="card-top"><div><h2>Notifiche e promemoria</h2><p class="subheading">Predisposizione mobile · avvisi locali all’apertura</p></div>${icon('alert-circle',20)}</div>
 <p class="explain">Puoi ricevere un avviso dal browser quando apri Quadra e hai scadenze imminenti. La versione offline non invia notifiche push a telefono bloccato o applicazione chiusa: per quelle serviranno un sito HTTPS accessibile al telefono, un servizio di invio web push e l’autorizzazione del dispositivo.</p>
 <div class="notification-config"><label for="notify-days" class="small">Anticipo</label><select id="notify-days" data-notification-days>${[1,3,7,14,30].map(n=>`<option value="${n}" ${p.days===n?'selected':''}>${n} ${n===1?'giorno':'giorni'}</option>`).join('')}</select>
 ${p.enabled?`<button class="btn ghost sm" data-action="notification-disable">${icon('x',14)} Disattiva avvisi</button>`:`<button class="btn primary sm" data-action="notification-enable">${icon('check',14)} Abilita avvisi locali</button>`}
 <button class="btn ghost sm" data-action="notification-test">${icon('info',14)} Prova notifica</button></div>
 <p class="notification-status" role="status">${esc(status)}</p><p class="form-hint" style="margin-top:8px">Le impostazioni restano nel browser su questo PC. Nessun contenuto finanziario viene inviato a servizi di notifica.</p></article>`;
}
async function prepareNotifications(){
 if(!window.isSecureContext||!('serviceWorker'in navigator))return;
 try{await navigator.serviceWorker.register('/sw.js',{scope:'/'});}catch(e){console.info('Service worker non disponibile',e.message);}
 if(notifyPrefs().enabled)await notifyUpcomingOnce();
}
async function showQuadraNotification(title,body,tag){
 if(!notifySupport()||Notification.permission!=='granted')return false;
 const options={body,icon:'/icon-192.png',badge:'/icon-192.png',tag,data:{url:'/#recurring'}};
 try{const reg=await navigator.serviceWorker.ready;await reg.showNotification(title,options);return true;}
 catch(e){console.warn('Avviso locale non disponibile',e);try{new Notification(title,options);return true;}catch(_){return false;}}
}
async function notifyUpcomingOnce(){
 if(!notifyPrefs().enabled||!notifySupport()||Notification.permission!=='granted')return;
 if(typeof scheduleEvents!=='function'||!state?.recurring)return;
 const p=notifyPrefs();
 const until=new Date(today+'T12:00:00Z');until.setUTCDate(until.getUTCDate()+p.days);
 const to=until.toISOString().slice(0,10),lastFilter=ui.scheduleFilter,lastOwner=ui.owner;
 let events=[];
 try{ui.scheduleFilter='all';ui.owner='Famiglia';events=scheduleEvents(today,to).filter(e=>e.status==='upcoming');}
 finally{ui.scheduleFilter=lastFilter;ui.owner=lastOwner;}
 if(!events.length)return;
 const key='quadra-notified-'+today+'-'+p.days;
 if(localStorage.getItem(key)==='1')return;
 const ok=await showQuadraNotification('Quadra · '+events.length+' scadenze',`Controlla le scadenze previste nei prossimi ${p.days} giorni. Apri Quadra per i dettagli.`,'quadra-reminder-'+today);
 if(ok){localStorage.setItem(key,'1');}
}
async function enableNotifications(){
 if(!notifySupport()){toast('Per gli avvisi usa un browser compatibile su localhost o HTTPS.',true);return;}
 const permission=await Notification.requestPermission();
 if(permission!=='granted'){toast('Permesso non concesso: verifica le impostazioni del browser.',true);render();return;}
 const p=notifyPrefs();p.enabled=true;saveNotifyPrefs(p);
 await prepareNotifications();render();toast('Avvisi locali abilitati per questo browser.');
}
function disableNotifications(){const p=notifyPrefs();p.enabled=false;saveNotifyPrefs(p);render();toast('Avvisi locali disattivati.');}
function changeNotificationDays(v){const p=notifyPrefs();p.days=Number(v)||7;saveNotifyPrefs(p);toast('Anticipo notifiche aggiornato.');}
async function testNotification(){
 if(!notifySupport()||Notification.permission!=='granted'){toast('Abilita prima gli avvisi locali dal pulsante dedicato.',true);return;}
 const ok=await showQuadraNotification('Quadra · Notifica di prova','Gli avvisi sono predisposti su questo browser. Nessun dato è stato inviato online.','quadra-test');
 toast(ok?'Notifica di prova inviata al browser.':'Il browser non ha mostrato la notifica.',!ok);
}
