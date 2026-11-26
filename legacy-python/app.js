'use strict';
// QUADRA Offline 1.7: gestione familiare locale, senza cloud né autenticazione esterna.
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const currency = new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'});
const fmt = (c) => currency.format((Number(c)||0)/100);
const num = (c) => (Number(c)||0)/100;
const now = new Date();
const today = now.toISOString().slice(0,10);
const presentMonth = today.slice(0,7);
const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const formatMonth = (m) => { const [y,mo]=m.split('-').map(Number);return `${monthNames[mo-1]} ${y}`; };
const formatDate = (d) => { if(!d)return '-';const [y,m,da]=String(d).slice(0,10).split('-');return `${da}/${m}/${y}`; };
const monthShift = (m,n) => {const [y,mo]=m.split('-').map(Number);const d=new Date(y,mo-1+n,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
const uniqueId = () => crypto?.randomUUID?.() || `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let CAT_COLORS = ['#c4f5a7','#77c9a9','#98b9d2','#f0c38d','#df9eac','#a7a4d8','#b7d79b','#74aeb3','#d6d1a8','#a9c2bb','#a5a1cc'];
const CATS = ['Alimentari','Casa e igiene','Abitazione','Utenze','Trasporti','Auto','Finanziamenti','Abbonamenti','Ristorazione','Cura personale','Salute','Tempo libero','Regali','Commissioni','Investimenti','Buoni pasto','Entrate','Rimborsi','Spese personali','Altro','Da classificare'];
// Membri e intestatari sono ora gestiti dall'anagrafica familiare, non da un elenco fisso.
const RESERVED_OWNERS=['Famiglia','Non attribuito'];
let storageInfo=null;
let restoration=null;
const DEFAULT_MEMBERS=[];
const familyMembers=(includeArchived=false)=>(state.members||[]).filter(m=>includeArchived||m.active!==false);
function ownerOptions(current='',includeUnassigned=true){
 const names=['Famiglia',...familyMembers().map(m=>m.name)];
 if(current&&!names.includes(current)&&!RESERVED_OWNERS.includes(current))names.push(current);
 if(includeUnassigned)names.push('Non attribuito');
 return [...new Set(names)];
}
async function initFamilyMembers(){
 if(Array.isArray(state.members))return;
 const names=new Set(DEFAULT_MEMBERS.map(m=>m.name));
 for(const section of ['transactions','recurring','payment_plans','budgets','accounts']){
  for(const x of state[section]||[])if(typeof x.owner==='string'&&x.owner.trim()&&!RESERVED_OWNERS.includes(x.owner))names.add(x.owner.trim());
 }
 state.members=[...names].map((name,i)=>DEFAULT_MEMBERS.find(m=>m.name===name)||{id:'member-'+uniqueId(),name,active:true});
 await persistLocal();
}

const KINDS = [{id:'expense',label:'Uscita'},{id:'income',label:'Entrata'},{id:'benefit',label:'Buono pasto (non monetario)'},{id:'transfer',label:'Giroconto'},{id:'withdrawal',label:'Prelievo contanti'},{id:'investment',label:'Investimento'}];
const PAGES = [
  {id:'overview',label:'Panoramica',icon:'layout-dashboard'},
  {id:'movements',label:'Movimenti',icon:'arrow-left-right'},
  {id:'exercises',label:'Bilanci annuali',icon:'calendar'},
  {id:'accounts',label:'Conti e saldi',icon:'wallet'},
  {id:'recurring',label:'Scadenze e rate',icon:'calendar-check'},
  {id:'insights',label:'Analisi',icon:'chart-no-axes-combined'},
  {id:'budgets',label:'Budget',icon:'gauge'},
  {id:'goals',label:'Obiettivi',icon:'target'},
  {id:'family',label:'Famiglia',icon:'users'},
  {id:'settings',label:'Impostazioni',icon:'settings'},
  {id:'file-import',label:'Importa Excel / CSV',icon:'upload'}
];
const PATHS = {
  'home':'M3 10.5 12 3l9 7.5V21H3z M9 21v-8h6v8',
  'layout-dashboard':'M3 3h8v8H3z M13 3h8v5h-8z M13 10h8v11h-8z M3 13h8v8H3z',
  'arrow-left-right':'M7 7h14m-5-5 5 5-5 5 M17 17H3m5-5-5 5 5 5',
  'calendar-check':'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 16l2 2 4-4',
  'chart-no-axes-combined':'M3 20l6-7 5 3 7-10 M16 6h5v5',
  'gauge':'M4 17a9 9 0 0 1 16 0 M12 15l5-5 M8 20h8',
  'target':'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10 M12 10v4',
  'users':'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-4-4h-2',
  'settings':'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  'plus':'M12 5v14 M5 12h14', 'chevron-left':'M15 18l-6-6 6-6','chevron-right':'M9 18l6-6-6-6',
  'sun':'M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.5 5.5l1.4 1.4 M17.1 17.1l1.4 1.4 M18.5 5.5l-1.4 1.4 M6.9 17.1l-1.4 1.4 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  'moon':'M20.2 15.8A9 9 0 0 1 8.2 3.8a9 9 0 1 0 12 12z','search':'M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z M17 17l4 4',
  'arrow-up-right':'M7 17 17 7 M7 7h10v10', 'arrow-down-right':'M7 7l10 10 M17 7v10H7',
  'wallet':'M3 5h18v14H3z M15 11h6v4h-6z','shield':'M12 2 21 6v6c0 6-5 9-9 10C8 21 3 18 3 12V6z M9 12l2 2 4-4',
  'info':'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 11v6 M12 7h.01',
  'clock':'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 6v6l4 2',
  'receipt':'M5 2h14v20l-3-2-4 2-4-2-3 2z M8 8h8 M8 12h8',
  'folder':'M3 6h6l2 3h10v11H3z', 'coffee':'M4 7h13v8a5 5 0 0 1-10 0V7 M17 9h3a3 3 0 0 1-3 6 M4 20h13',
  'car':'M5 16 7 8h10l2 8 M3 16h18v5h-3v-2H6v2H3z M7 16h.01 M17 16h.01',
  'banknote':'M2 6h20v12H2z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  'edit':'M4 20h5L20 9l-5-5L4 15z', 'trash':'M4 6h16 M9 6V4h6v2 M7 6l1 15h8l1-15',
  'download':'M12 3v12m-5-5 5 5 5-5 M5 17v4h14v-4',
  'upload':'M12 17V4M7 9l5-5 5 5 M4 18v3h16v-3','x':'M5 5l14 14M19 5 5 19',
  'check':'M4 12l5 5L20 6','calendar':'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16',
  'filter':'M3 4h18l-7 8v7l-4 2v-9z','alert-circle':'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 7v6 M12 17h.01',
  'paperclip':'M21 11.5l-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 1 1 5.7 5.7l-9.1 9.1a2 2 0 1 1-2.8-2.8l8.4-8.4',
  'image':'M3 4h18v16H3z M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M3 17l6-6 4 4 3-3 5 5',
  'credit-card':'M3 5h18v14H3z M3 10h18 M7 15h4','palette':'M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 2-2c0-1-1-2-1-3s1-2 3-2h1a3 3 0 0 0 3-3 9 9 0 0 0-9-8z M7 12h.01 M10 7h.01 M15 7h.01 M17 12h.01',
  'list':'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01','repeat':'M17 2l4 4-4 4 M3 11V9a3 3 0 0 1 3-3h15 M7 22l-4-4 4-4 M21 13v2a3 3 0 0 1-3 3H3','layers':'M12 2 21 7l-9 5L3 7z M3 12l9 5 9-5 M3 17l9 5 9-5'
};
const icon = (name,size=19) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name] || PATHS.info}"/></svg>`;
const isLocal = true;
const localKey='quadra-rev1-local';
let state={transactions:[],recurring:[],payment_plans:[],budgets:[],goals:[],categories:[],accounts:[],statements:[],import_rules:[],members:[]};
let ui={page:(location.hash.slice(1)||'overview'),scheduleMonth:presentMonth,scheduleFilter:'all',scheduleSelectedDay:'',month:presentMonth,year:Number(presentMonth.slice(0,4)),periodMode:'year',quarter:Math.ceil(Number(presentMonth.slice(5,7))/3),owner:'Famiglia',accountFilter:'all',filter:'',category:'Tutte',kind:'all',attachmentsOnly:false,pageIndex:0,categorySearch:'',theme:'dark',userEmail:'',demo:false};
let loading=false;
const THEME_NAMES={dark:'Verde notte (originale)',light:'Chiaro originale',oat:'Oat Milk · Forest Green · Tomato Red',midnight:'Midnight Black · Electric Blue · Sunset Orange'};
function applyTheme(value){
 const theme=Object.hasOwn(THEME_NAMES,value)?value:'dark';
 ui.theme=theme;
 document.body.classList.remove('light','oat','midnight');
 if(theme!=='dark')document.body.classList.add(theme);
 localStorage.setItem('quadra-theme',theme);
 const schemes={dark:['#c4f5a7','#77c9a9','#98b9d2','#f0c38d','#df9eac','#a7a4d8','#b7d79b'],light:['#297651','#69a688','#507c9e','#c28a42','#b7636a','#8773ac'],oat:['#1D4A35','#F2462E','#6F8767','#9D533C','#B59E7C','#3D6C51'],midnight:['#2F6BFF','#FF7A1A','#89ABFF','#5F70A8','#FFB47F','#7D8DE4']};
 CAT_COLORS=schemes[theme];
 const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=theme==='oat'?'#EEE5D4':theme==='midnight'?'#090A10':theme==='light'?'#eef3ed':'#0b1212';
}
function quadraMark(size=34){return `<img src="/favicon.svg" alt="" width="${size}" height="${size}" draggable="false">`;}
function graphColors(){return {dark:['#c4f5a7','#8daeb5'],light:['#297651','#597c9a'],oat:['#1D4A35','#F2462E'],midnight:['#2F6BFF','#FF7A1A']}[ui.theme]||['#c4f5a7','#8daeb5'];}
function openThemeModal(){
 const themes=[['dark','Verde notte','Stile originale','#0A1110','#C4F5A7','#77C9A9'],['light','Chiaro originale','Stile originale chiaro','#EFF3EE','#297651','#D8EFE0'],['oat','Oat Milk · Forest Green · Tomato Red','60 / 30 / 10','#EEE5D4','#1D4A35','#F2462E'],['midnight','Midnight Black · Electric Blue · Sunset Orange','60 / 30 / 10','#090A10','#2F6BFF','#FF7A1A']];
 const m=document.createElement('div');m.className='modal-backdrop';
 m.innerHTML=`<div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="Scegli tema"><div class="modal-head"><h2>Personalizza i colori</h2><button class="icon-btn" type="button" data-close>${icon('x',18)}</button></div><p class="explain">Questa preferenza riguarda soltanto l'aspetto di Quadra e non modifica i movimenti.</p><div class="theme-options">${themes.map(t=>`<button class="theme-choice ${ui.theme===t[0]?'selected':''}" data-set-theme="${t[0]}"><span class="theme-band"><i style="background:${t[3]}"></i><i style="background:${t[4]}"></i><i style="background:${t[5]}"></i></span><strong>${esc(t[1])}</strong><small>${esc(t[2])}</small>${ui.theme===t[0]?'<span class="badge soft">Selezionato</span>':''}</button>`).join('')}</div></div>`;
 document.body.append(m);
}
async function init() {
  applyTheme(localStorage.getItem('quadra-theme')||localStorage.getItem('nido-theme')||'oat');
  if(location.protocol==='file:') {
    $('#app').innerHTML='<div class="message-error"><h1>Avvia Quadra dalla cartella</h1><p>Per salvare automaticamente i dati sul PC, apri AVVIA_WINDOWS.bat o avvia_mac_linux.command. Non aprire direttamente il file HTML.</p></div>';
    return;
  }
  try {
    state=await fetchJSON('/api/state');
    storageInfo=await fetchJSON('/api/storage');
    if(!Array.isArray(state.transactions) || !Array.isArray(state.recurring)) throw new Error('Archivio non valido');
    if(!Array.isArray(state.payment_plans))state.payment_plans=[];
  } catch(err) {
    $('#app').innerHTML=`<div class="message-error"><h1>Archivio locale non disponibile</h1><p>${esc(err.message)}. Avvia Quadra dal programma incluso nella cartella.</p><button class="btn" onclick="location.reload()">Riprova</button></div>`;
    return;
  }
  try { await initFamilyMembers(); } catch(err) {console.warn('Anagrafica:',err.message);toast('Anagrafica: '+err.message,true);}
  try { await ensureCategoryCatalog(); }
  catch(err) { console.warn('Catalogo categorie:',err.message);toast('Catalogo categorie: '+err.message,true); }
  await initAccounting();
  const last=state.transactions.map(t=>t.occurred_on?.slice(0,7)).filter(Boolean).sort().at(-1);
  ui.month=last || presentMonth;ui.year=Number(ui.month.slice(0,4));ui.quarter=Math.ceil(Number(ui.month.slice(5,7))/3);
  if(ui.page==='payments')ui.page='recurring'; // Compatibilita con vecchi link salvati.
  if(!PAGES.some(x=>x.id===ui.page))ui.page='overview';
  document.addEventListener('click',onClick);
  document.addEventListener('change',onChange);
  document.addEventListener('input',onInput);
  window.addEventListener('hashchange',()=>{ui.page=location.hash.slice(1)||'overview';if(ui.page==='payments')ui.page='recurring';ui.pageIndex=0;render();});
  render();
  prepareNotifications();
}
async function fetchJSON(url,options={}){
  const r=await fetch(url,{credentials:'same-origin',headers:{'content-type':'application/json'},...options});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);return data;
}
async function persistLocal(){
  await fetchJSON('/api/state',{method:'PUT',body:JSON.stringify({format:'quadra-family-v1',version:5,created_at:state.created_at||today,source:state.source||'Registro finanze familiari',transactions:state.transactions,recurring:state.recurring,payment_plans:state.payment_plans,budgets:state.budgets,goals:state.goals,categories:state.categories,accounts:state.accounts,statements:state.statements,import_rules:state.import_rules,members:state.members,accounts_initialized:state.accounts_initialized===true})});
}
async function saveRecord(table,item,id=null){
  if(isLocal){if(id){state[table]=state[table].map(x=>x.id===id?{...x,...item,id}:x)}else{state[table].push({...item,id:item.id||uniqueId()});}await persistLocal();return;}
  await fetchJSON(`/api/${table}${id?'/'+encodeURIComponent(id):''}`,{method:id?'PUT':'POST',body:JSON.stringify(item)});
  state=await fetchJSON('/api/state');
}
async function deleteRecord(table,id){
  if(isLocal && table==='transactions'){
    await fetchJSON('/api/transactions/'+encodeURIComponent(id),{method:'DELETE'});
    state[table]=state[table].filter(x=>x.id!==id);return;
  }
  if(isLocal){state[table]=state[table].filter(x=>x.id!==id);await persistLocal();return;}
  await fetchJSON(`/api/${table}/${encodeURIComponent(id)}`,{method:'DELETE'});state=await fetchJSON('/api/state');
}
function toast(message,error=false){document.querySelector('.toast')?.remove();const el=document.createElement('div');el.className=`toast${error?' error':''}`;el.textContent=message;document.body.append(el);setTimeout(()=>el.remove(),4500);}
const monthTx=(m=ui.month)=>state.transactions.filter(t=>t.occurred_on.startsWith(m));
const scoped=(items)=>ui.owner==='Famiglia'?items:items.filter(t=>t.owner===ui.owner);
const expenses=(items)=>items.filter(t=>t.kind==='expense');
const incomes=(items)=>items.filter(t=>t.kind==='income');
const sum=(items)=>items.reduce((n,t)=>n+Number(t.amount_cents||0),0);
const spend=(m=ui.month,owner=ui.owner)=>sum(expenses(owner==='Famiglia'?monthTx(m):monthTx(m).filter(t=>t.owner===owner)));
const income=(m=ui.month,owner=ui.owner)=>sum(incomes(owner==='Famiglia'?monthTx(m):monthTx(m).filter(t=>t.owner===owner)));
function filteredRecurring(m=ui.month,owner=ui.owner){return state.recurring.filter(r=>(r.active===1||r.active===true||r.active===undefined)&&(!r.start_on||r.start_on.slice(0,7)<=m)&&(!r.end_on||r.end_on.slice(0,7)>=m)&&(owner==='Famiglia'||r.owner===owner));}
function monthlyAmount(r){return Number(r.amount_cents)*(r.frequency==='yearly'?1/12:1);}
function recurringTotal(m=ui.month,owner=ui.owner){return Math.round(filteredRecurring(m,owner).reduce((n,r)=>n+monthlyAmount(r),0));}
function categoryBreakdown(rows){const map=new Map();for(const t of expenses(rows)){map.set(t.category,(map.get(t.category)||0)+Number(t.amount_cents));}return [...map].map(([key,value])=>({name:categoryLabel(key,true),value})).sort((a,b)=>b.value-a.value);}
function isKnown(item){return item.confidence==='verificato';}
function miniLegend(color,label){return `<span><i style="background:${color}"></i>${esc(label)}</span>`;}
const opt=(arr,current)=>arr.map(v=>`<option value="${esc(v)}" ${current===v?'selected':''}>${esc(v)}</option>`).join('');
const kindLabel=(k)=>KINDS.find(x=>x.id===k)?.label||k;
const ownerText=(o)=>o==='Non attribuito'?'Da attribuire':o;
const card=(c)=>`<article class="card ${c.className||''}">${c.content}</article>`;
function monthPicker(){return periodPicker();}
function pageHead(title,desc,actions=''){return `<div class="page-head"><div><div class="eyebrow">IL VOSTRO QUADRO</div><h1>${title}</h1><p>${desc}</p></div><div class="header-side">${actions}</div></div>`;}
function selectOwner(){const names=ownerOptions(ui.owner,false);return `<div class="selection-bar"><span class="eyebrow">Visualizza</span>${names.map(o=>`<button class="chip ${ui.owner===o?'selected':''}" data-owner="${esc(o)}">${o==='Famiglia'?'Tutta la famiglia':esc(o)}</button>`).join('')}</div>`;}
function infoStrip(){return `<div class="info-strip">${icon('shield',16)}<span><strong>Archivio offline sul tuo PC.</strong> I dati vengono salvati nella cartella privata esterna al programma. Il backup ZIP include anche allegati e PDF. Nessun dato viene inviato online; giroconti e prelievi non sono conteggiati due volte.</span></div>`;}
function navigation(){return `<aside class="sidebar"><div class="brand"><span class="brand-symbol quadra-brand">${quadraMark(39)}</span><span><span class="brand-title">Quadra</span><span class="brand-caption">I CONTI DI CASA, IN ORDINE.</span></span></div><div class="nav"><div class="nav-label eyebrow">Il vostro spazio</div>${PAGES.map(p=>`${p.id==='file-import'?'<div class="nav-import-divider"></div>':''}<button class="nav-btn ${ui.page===p.id?'active':''}" data-nav="${p.id}">${icon(p.icon,18)}<span>${p.label}</span></button>`).join('')}</div><div class="sidebar-bottom"><div class="person-mini"><div class="avatars">${familyMembers().slice(0,3).map(m=>`<span class="avatar">${esc(m.name.slice(0,1).toUpperCase())}</span>`).join('')}</div><div><strong class="small">${esc(familyMembers().length===2?familyMembers().map(m=>m.name).join(' & '):`${familyMembers().length} componenti`)}</strong><div class="dim" style="font-size:10px;margin-top:3px">Gestione personale</div></div></div><div class="side-footer">Solo su questo PC<br>Dati conservati in locale.</div></div></aside>`;}
function bottomNav(){const items=[...PAGES.slice(0,4),{id:'mobile-menu',label:'Altro',icon:'layers'}];return `<div class="bottom-nav" role="navigation" aria-label="Navigazione rapida">${items.map(p=>`<button ${p.id==='mobile-menu'?'data-action="mobile-menu"':`data-nav="${p.id}"`} class="${ui.page===p.id?'active':''}">${icon(p.icon,20)}<span>${p.label}</span></button>`).join('')}</div>`;}
function render(){
 const page=PAGES.find(p=>p.id===ui.page)||PAGES[0];
 $('#app').innerHTML=`<div class="layout">${navigation()}<main class="main"><header class="topbar"><div class="breadcrumbs"><span>Il tuo spazio</span>${icon('chevron-right',13)}<strong>${page.label}</strong></div><div class="mobile-top"><span class="brand-symbol quadra-brand">${quadraMark(32)}</span><span class="brand-title">Quadra</span></div><div class="top-actions"><span class="status-tag head-desktop">Offline sul PC</span><button class="icon-btn" data-action="theme" title="Scegli tema">${icon('palette',17)}</button><button class="btn primary" data-action="add-tx">${icon('plus',16)}<span class="head-desktop">Nuovo movimento</span><span class="mobile-top">Aggiungi</span></button></div></header>${infoStrip()}<section id="page-content">${renderPage()}</section></main>${bottomNav()}</div>`;
 if(ui.page==='settings')refreshCategorySearch();
}
function renderPage(){switch(ui.page){case 'overview':return renderOverview();case 'movements':return renderMovements();case 'exercises':return renderExercises();case 'accounts':return renderAccounts();case 'file-import':return renderImportPage();case 'recurring':return renderQuadraSchedule();case 'payments':return renderQuadraSchedule();case 'insights':return renderInsights();case 'budgets':return renderBudgets();case 'goals':return renderGoals();case 'family':return renderFamily();case 'settings':return renderSettings();default:return renderOverview();}}
function kpi(name,value,note,ic='wallet',tone=''){return `<div class="card kpi"><div class="kpi-name"><span>${name}</span><span class="kpi-icon">${icon(ic,15)}</span></div><div class="kpi-amt money ${tone}">${value}</div><div class="kpi-note">${note}</div></div>`;}
function sumChart(months){
 const incoming=months.map(m=>income(m));const outgoing=months.map(m=>spend(m));const top=Math.max(1,...incoming,...outgoing)*1.18;
 const X=(i)=>18+i*(560/(months.length-1));const Y=(v)=>188-v/top*155;
 const [incomeColor,outgoingColor]=graphColors();
 const path=(arr)=>arr.map((v,i)=>`${i===0?'M':'L'} ${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
 return `<div class="chart"><svg viewBox="0 0 610 208" role="img" aria-label="Entrate e uscite degli ultimi sei mesi"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${incomeColor}" stop-opacity=".24"/><stop offset="1" stop-color="${incomeColor}" stop-opacity="0"/></linearGradient></defs>${[0,1,2,3].map(i=>`<line x1="18" x2="578" y1="${45+i*47}" y2="${45+i*47}" stroke="currentColor" opacity=".075" stroke-dasharray="4 6"/>`).join('')}<path d="${path(incoming)} L 578 193 L 18 193 Z" fill="url(#chartFill)"/><path d="${path(incoming)}" fill="none" stroke="${incomeColor}" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round"/><path d="${path(outgoing)}" fill="none" stroke="${outgoingColor}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="6 6"/>${incoming.map((n,i)=>`<circle cx="${X(i)}" cy="${Y(n)}" r="3" fill="${incomeColor}"/>`).join('')}</svg><div class="chart-labels">${months.map(m=>`<span>${monthNames[Number(m.slice(5))-1].slice(0,3)}</span>`).join('')}</div></div>`;
}
function donutChart(rows){
 const all=categoryBreakdown(rows),total=all.reduce((n,x)=>n+x.value,0);
 if(!total)return '<div class="empty">Nessuna uscita per questo periodo.</div>';
 let used=0;const circles=all.slice(0,8).map((c,i)=>{const pct=c.value/total*100;const dash=`${pct} ${100-pct}`;const out=`<circle cx="60" cy="60" r="48" fill="none" stroke="${CAT_COLORS[i%CAT_COLORS.length]}" stroke-width="15" stroke-dasharray="${dash}" stroke-dashoffset="${-used}" pathLength="100"/>`;used+=pct;return out;}).join('');
 return `<div class="donut-layout"><div class="donut"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="48" stroke="rgba(160,197,174,.12)" stroke-width="15" fill="none"/>${circles}</svg><div class="donut-center"><div><strong>${fmt(total)}</strong><br><small>Spese del mese</small></div></div></div><div class="stat-lines" style="flex:1;min-width:0">${all.slice(0,5).map((c,i)=>`<div class="stat-line"><span class="stat-name"><i class="color-dot" style="background:${CAT_COLORS[i%CAT_COLORS.length]}"></i>${esc(c.name)}</span><strong class="stat-amount">${fmt(c.value)}</strong></div>`).join('')}</div></div>`;
}
function renderOverview(){
 const rows=scoped(periodTx()),ex=sum(expenses(rows)),inc=sum(incomes(rows)),fixed=recurringTotal(),res=inc-ex;
 const months=selectedChartMonths();
 const latest=[...rows].sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on)).slice(0,6);
 const top=categoryBreakdown(rows).slice(0,4),total=top.reduce((n,x)=>n+x.value,0);
 return `${pageHead('I tuoi conti, in ordine','Un quadro semplice di entrate, uscite e scadenze.',monthPicker())}${selectOwner()}
 ${!familyMembers().length?`<article class="card" style="margin-bottom:18px"><div class="card-top"><div><h2>Benvenuto in Quadra</h2><p class="subheading">Questa installazione è vuota e non contiene dati di altre persone.</p></div>${icon('users',19)}</div><p class="explain">Per iniziare aggiungi un componente nella sezione Famiglia, poi crea i tuoi conti in Conti e saldi. Potrai inserire movimenti, rate e scadenze oppure importare un file bancario.</p><button class="btn primary" data-nav="family">Configura la famiglia</button></article>`:''}
 <div class="grid kpis">
  ${kpi('Entrate registrate',fmt(inc),'Movimenti effettivi del periodo','arrow-down-right','positive')}
  ${kpi('Uscite registrate',fmt(ex),'Esclusi giroconti e prelievi','arrow-up-right')}
  ${kpi('Netto dei movimenti',fmt(res),'Non equivale al saldo bancario','wallet',res>=0?'positive':'negative')}
  ${kpi('Ricorrenti mensili',fmt(fixed),'Media inclusiva delle voci annuali','calendar-check','accent')}
 </div>
 <div class="grid two-col">
  <article class="card"><div class="card-top"><div><h2>Andamento del denaro</h2><p class="subheading">Andamento del periodo selezionato</p></div><span class="badge soft">${months.length} mesi</span></div>${sumChart(months)}<div class="card-foot"><div class="legend">${miniLegend(graphColors()[0],'Entrate')}${miniLegend(graphColors()[1],'Uscite')}</div><span>Movimenti importati</span></div></article>
  <article class="card accent-card"><div class="hero-flex"><div class="hero-head"><div><div class="eyebrow" style="color:#b8d7bd">Il costo che torna</div><h2 style="margin-top:12px;font-size:21px">Impegni di casa</h2></div>${icon('layers',24)}</div><div><div class="wide-number">${fmt(fixed)}</div><div class="hero-sub">Al mese, accantonando anche assicurazioni, bolli, condominio e altre spese annuali.</div></div><div class="hero-bottom"><div><div class="hero-highlight">${fmt(fixed*12)} / 12 mesi</div><div class="hero-sub" style="font-size:10px">Importo indicativo ai costi attuali</div></div><button class="btn" style="background:rgba(222,255,208,.15);color:#fff" data-nav="recurring">Esplora ${icon('chevron-right',13)}</button></div></div><svg class="decor-orbit" width="180" height="180" viewBox="0 0 180 180"><circle cx="90" cy="90" r="72" fill="none" stroke="white" stroke-width="1"/><circle cx="90" cy="90" r="52" fill="none" stroke="white" stroke-width="1" stroke-dasharray="4 5"/></svg></article>
 </div>
 <div class="grid two-col section-spacer">
  <article class="card"><div class="card-top"><div><h2>Dove va il denaro</h2><p class="subheading">Spese effettive, senza movimentazioni interne</p></div><button class="btn ghost sm" data-nav="insights">Analisi ${icon('chevron-right',13)}</button></div>${donutChart(rows)}</article>
  <article class="card"><div class="card-top"><div><h2>Prossimi appuntamenti</h2><p class="subheading">Scadenze periodiche con data nota</p></div>${icon('calendar',18)}</div>${renderUpcoming(4)}<div class="card-foot">Le spese annuali sono gia comprese nella media mensile. <button class="btn ghost sm" data-nav="recurring">Tutte</button></div></article>
 </div>
 <div class="grid two-col section-spacer">
 <article class="card"><div class="card-top"><div><h2>Ultimi movimenti</h2><p class="subheading">Dal periodo selezionato</p></div><button class="btn ghost sm" data-nav="movements">Vedi tutti ${icon('chevron-right',13)}</button></div>${latest.length?latest.map(t=>renderListTx(t)).join(''):'<div class="empty">Non ci sono movimenti nel periodo selezionato. Prova un altro periodo oppure importa un estratto bancario.</div>'}</article>
 <article class="card"><div class="card-top"><div><h2>Regole per una contabilità chiara</h2><p class="subheading">Come leggere i dati della famiglia</p></div>${icon('shield',18)}</div><ul class="notice-list"><li><strong>Giroconti:</strong> spostano denaro tra conti, senza generare nuove spese.</li><li><strong>Prelievi:</strong> non sono automaticamente spese; registra gli acquisti in contanti separatamente.</li><li><strong>Spese annuali:</strong> possono essere accantonate nel budget senza duplicare i pagamenti effettivi.</li><li><strong>Buoni pasto:</strong> sono benefici non monetari e non aumentano il saldo bancario.</li><li><strong>Scadenze previste:</strong> non modificano le spese e i saldi finché non vengono confermate.</li><li><strong>Riconciliazione:</strong> verifica i saldi utilizzando gli estratti conto ufficiali.</li></ul><div class="card-foot"><span>Movimenti da verificare: ${state.transactions.filter(x=>x.confidence==='da verificare').length}</span><button class="btn ghost sm" data-nav="movements">Controlla</button></div></article>
 </div>`;
}
function renderListTx(t){
 const sym=t.kind==='income'?'arrow-down-right':t.kind==='expense'?'arrow-up-right':'arrow-left-right';
 const sign=t.kind==='income'?'+':t.kind==='expense'?'-':'';
 return `<div class="list-row"><span class="list-icon">${icon(sym,18)}</span><div class="list-info"><div class="list-title">${esc(t.merchant||t.description||categoryLabel(t.category))}</div><div class="list-sub">${formatDate(t.occurred_on)} <span class="dim">/</span> ${esc(t.owner)} <span class="dim">/</span> ${esc(categoryLabel(t.category))}${t.attachments?.length?` <span class="inline-attachment" title="${t.attachments.length} allegati">${icon('paperclip',12)} ${t.attachments.length}</span>`:''}</div></div><div class="list-right"><div class="money ${t.kind==='income'?'positive':''}">${sign}${fmt(t.amount_cents)}</div><div class="caption">${t.kind==='expense'?'Uscita':kindLabel(t.kind)}</div></div></div>`;
}
function dueEvents(month=ui.month){
 const [y,m]=month.split('-').map(Number);const last=new Date(y,m,0).getDate();
 return state.recurring.filter(r=>(r.active===1||r.active===true||r.active===undefined)&&(ui.owner==='Famiglia'||r.owner===ui.owner))
  .map(r=>{let show=true;if(r.frequency==='yearly'){show=!!r.start_on&&r.start_on.slice(5,7)===month.slice(5,7);}if(/data da verificare|giorno da confermare/i.test(r.note||''))show=false;
    const d=Math.min(Number(r.due_day)||1,last);const iso=`${month}-${String(d).padStart(2,'0')}`;
    if(r.start_on&&iso<r.start_on)show=false;if(r.end_on&&iso>r.end_on)show=false;
    return {...r,iso,show};}).filter(r=>r.show).sort((a,b)=>a.iso.localeCompare(b.iso));
}
function renderUpcoming(limit=6){
 const planned=paymentSlots(today,paymentDateShift(today,2)).filter(s=>s.kind==='payment_plan'&&!paymentLinkedTx(s)&&(ui.owner==='Famiglia'||s.owner===ui.owner)).map(s=>({...s,iso:s.date}));
 const all=[...dueEvents(ui.month),...dueEvents(monthShift(ui.month,1)),...planned].sort((a,b)=>a.iso.localeCompare(b.iso));
 const events=all.filter(r=>r.iso>=today).slice(0,limit);
 if(!events.length)return '<div class="empty">Nessuna scadenza futura con data verificata. Trovi tutte le spese periodiche nel registro ricorrenze.</div>';
 return `<div class="timeline">${events.map(r=>`<div class="timeline-item"><span class="timeline-date">${Number(r.iso.slice(-2))}<small>${monthNames[Number(r.iso.slice(5,7))-1].slice(0,3)}</small></span><div class="timeline-body"><strong>${esc(r.title)}</strong><p>${esc(r.owner)} / ${esc(categoryLabel(r.category))}</p></div><span class="timeline-amount">${fmt(r.amount_cents)}</span></div>`).join('')}</div>`;
}
function renderMovements(){
 let rows=scoped(periodTx()).filter(t=>(ui.kind==='all'||t.kind===ui.kind)&&(ui.category==='Tutte'||t.category===ui.category)&&(!ui.attachmentsOnly||(t.attachments?.length>0))&&(ui.accountFilter==='all'||(ui.accountFilter==='unassigned'?!t.account_id:t.account_id===ui.accountFilter)));
 const q=ui.filter.trim().toLowerCase();if(q)rows=rows.filter(t=>[t.merchant,t.description,t.details,categoryLabel(t.category,true),t.owner,t.kind].join(' ').toLowerCase().includes(q));
 rows.sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on));
 const paged=rows.slice(ui.pageIndex*40,ui.pageIndex*40+40);
 return `${pageHead('Movimenti','Tutti i pagamenti ordinati, ricercabili e modificabili.',monthPicker())}${selectOwner()}
 <article class="card"><div class="card-top"><div><h2>Registro dei movimenti</h2><p class="subheading">Sono visualizzati anche prelievi e giroconti, ma non contribuiscono al totale delle spese.</p></div><button class="btn primary sm" data-action="add-tx">${icon('plus',14)} Nuovo</button></div>
 <div class="tools"><input class="search" data-field="search" placeholder="Cerca esercente, nota, categoria..." value="${esc(ui.filter)}"><select data-field="kind"><option value="all">Tutti i tipi</option>${KINDS.map(k=>`<option value="${k.id}" ${ui.kind===k.id?'selected':''}>${k.label}</option>`).join('')}</select><select data-field="category"><option>Tutte</option>${categoryOptions(ui.category,true)}</select><select data-account-filter aria-label="Conto"><option value="all">Tutti i conti</option><option value="unassigned" ${ui.accountFilter==='unassigned'?'selected':''}>Senza conto</option>${(state.accounts||[]).map(a=>`<option value="${esc(a.id)}" ${ui.accountFilter===a.id?'selected':''}>${esc(a.owner)} · ${esc(a.label)}</option>`).join('')}</select><label class="attachment-filter"><input type="checkbox" data-field="attachments-only" ${ui.attachmentsOnly?'checked':''}> ${icon('paperclip',14)} Solo con allegati</label></div>
 ${renderPaymentPlaceholders()}
 <div class="table-wrap"><table class="data-table"><thead><tr><th>Movimento</th><th>Data</th><th>Chi ha pagato</th><th>Conto</th><th>Categoria</th><th>Tipo</th><th>Importo</th></tr></thead><tbody>${paged.map(t=>`<tr class="click-row" data-edit-tx="${esc(t.id)}" title="Apri e modifica"><td><div class="td-item"><span class="merchant-icon">${icon(t.kind==='income'?'arrow-down-right':t.kind==='expense'?'receipt':'arrow-left-right',16)}</span><div><strong>${esc(t.merchant||categoryLabel(t.category))}</strong><div class="td-note">${esc((t.description||t.details||'').slice(0,65))}${t.attachments?.length?` <span class="inline-attachment">${icon('paperclip',12)} ${t.attachments.length}</span>`:''}</div></div></div></td><td>${formatDate(t.occurred_on)}</td><td>${esc(ownerText(t.owner))}</td><td>${esc(accountName(t.account_id))}</td><td><span class="badge">${esc(categoryLabel(t.category))}</span></td><td><span class="badge ${['transfer','withdrawal','investment'].includes(t.kind)?'warn':t.kind==='benefit'?'soft':''}">${esc(kindLabel(t.kind))}</span></td><td><strong class="money ${t.kind==='income'?'positive':t.kind==='expense'?'negative':''}">${t.kind==='income'?'+':t.kind==='expense'?'-':''}${fmt(t.amount_cents)}</strong></td></tr>`).join('')}</tbody></table></div>
 ${!rows.length?'<div class="empty">Nessun movimento corrisponde ai filtri selezionati.</div>':''}
 <div class="card-foot"><span>${rows.length} movimenti totali</span><div class="right-actions"><button class="btn ghost sm" data-action="page-prev" ${ui.pageIndex===0?'disabled':''}>Indietro</button><span>${ui.pageIndex+1} / ${Math.max(1,Math.ceil(rows.length/40))}</span><button class="btn ghost sm" data-action="page-next" ${(ui.pageIndex+1)*40>=rows.length?'disabled':''}>Avanti</button></div></div></article>
 <div class="info-strip section-spacer">${icon('info',16)} <span><strong>Regola contabile:</strong> un prelievo di 150 euro non e\u0300 una spesa aggiuntiva se i successivi acquisti in contanti sono stati registrati. Puoi correggere categoria e titolare cliccando sul movimento.</span></div>`;
}
function renderRecurring(){
 const list=filteredRecurring(ui.month),fixed=recurringTotal(ui.month),annual=state.recurring.filter(r=>r.frequency==='yearly'&&r.active!==0),bycat=new Map();
 for(const r of list)bycat.set(r.category,(bycat.get(r.category)||0)+monthlyAmount(r));
 const items=[...bycat].sort((a,b)=>b[1]-a[1]);
 return `${pageHead('Spese che ritornano','Un registro per conoscere le rate e accantonare i costi annuali.',`<button class="btn primary" data-action="add-rec">${icon('plus',15)} Aggiungi</button>`)}${selectOwner()}
 <div class="grid kpis">${kpi('Media mensile',fmt(fixed),'Tutte le ricorrenze attive','calendar-check','accent')}${kpi('Proiezione annuale',fmt(fixed*12),'A prezzi e condizioni correnti','chart-no-axes-combined')}${kpi('Voci ricorrenti',String(list.length),'Mensili e annuali','layers')}${kpi('Spese annuali',String(annual.length),'Quota ripartita in 12 mesi','receipt')}</div>
 <div class="grid two-col"><article class="card"><div class="card-top"><div><h2>Ripartizione per categoria</h2><p class="subheading">Equivalente mensile</p></div></div>${items.length?items.map(([name,v],i)=>`<div style="margin-bottom:17px"><div class="stat-line"><span class="stat-name">${esc(categoryLabel(name))}</span><strong class="stat-amount">${fmt(v)}</strong></div><div class="progress"><i style="width:${Math.min(100,v/Math.max(1,fixed)*100)}%;background:${CAT_COLORS[i%CAT_COLORS.length]}"></i></div></div>`).join(''):'<div class="empty">Aggiungi o importa le vostre spese periodiche.</div>'}</article>
 <article class="card"><div class="card-top"><div><h2>Calendario delle scadenze</h2><p class="subheading">Solo le date di pagamento conosciute</p></div></div>${renderUpcoming(7)}<div class="card-foot">Le rate concluse spariscono automaticamente dal mese successivo.</div></article></div>
 <article class="card section-spacer"><div class="card-top"><div><h2>Tutte le voci</h2><p class="subheading">Tocca il simbolo della matita per aggiornare una cifra o una data.</p></div><div class="right-actions"><button class="btn ghost sm" data-action="export-calendar">${icon('calendar',15)} Esporta .ics</button><span class="badge soft">${list.length} voci attive</span></div></div>
 <div class="rec-grid">${list.map(r=>`<div class="rec-item"><div class="rec-head"><span class="badge ${r.confidence!=='verificato'?'warn':'soft'}">${esc(r.confidence)}</span><button class="tiny-btn" data-edit-rec="${esc(r.id)}" aria-label="Modifica ${esc(r.title)}">${icon('edit',15)}</button></div><div class="rec-title">${esc(r.title)}</div><div class="rec-amt">${fmt(r.amount_cents)}<span class="small dim" style="margin-left:5px;font-weight:400">/${r.frequency==='yearly'?'anno':'mese'}</span></div><div class="rec-foot"><span>${esc(r.owner)} / ${esc(categoryLabel(r.category))}</span><span>${r.frequency==='yearly'?fmt(monthlyAmount(r))+'/mese':r.end_on?'fino al '+formatDate(r.end_on):''}</span></div>${r.note?`<div class="td-note" style="margin-top:10px;line-height:1.5">${esc(r.note)}</div>`:''}</div>`).join('')||'<div class="empty">Nessuna spesa ricorrente per i filtri attuali.</div>'}</div></article>`;
}
function renderInsights(){
 const months=selectedChartMonths();const rows=scoped(periodTx());const sorted=categoryBreakdown(rows);
 const high=Math.max(1,...sorted.map(c=>c.value));
 return `${pageHead('Capire le abitudini','Andamento, categorie e ritmo delle spese della famiglia.',monthPicker())}${selectOwner()}
 <div class="grid kpis">${kpi('Uscite del periodo',fmt(sum(expenses(rows))),'Movimenti effettivi','arrow-up-right')}${kpi('Entrate del periodo',fmt(sum(incomes(rows))),'Movimenti effettivi','arrow-down-right','positive')}${kpi('Spesa media mensile',fmt(Math.round(months.map(m=>spend(m)).reduce((a,b)=>a+b,0)/months.length)),'Basata sui movimenti registrati','chart-no-axes-combined')}${kpi('Acquisti',String(expenses(rows).length),'Numero di movimenti di spesa','receipt')}</div>
 <article class="card"><div class="card-top"><div><h2>Entrate e uscite nel periodo selezionato</h2><p class="subheading">Confronto delle registrazioni bancarie, non un saldo conto</p></div></div>${sumChart(months)}<div class="card-foot"><div class="legend">${miniLegend(graphColors()[0],'Entrate')}${miniLegend(graphColors()[1],'Uscite')}</div></div></article>
 <div class="grid two-col section-spacer"><article class="card"><div class="card-top"><div><h2>Spesa per categoria</h2><p class="subheading">Dal maggiore al minore importo</p></div></div>${sorted.length?sorted.slice(0,12).map((c,i)=>`<div style="margin-bottom:18px"><div class="stat-line"><span class="stat-name">${esc(c.name)}</span><strong class="stat-amount">${fmt(c.value)}</strong></div><div class="progress"><i style="width:${c.value/high*100}%;background:${CAT_COLORS[i%CAT_COLORS.length]}"></i></div></div>`).join(''):'<div class="empty">Importa movimenti per visualizzare le categorie.</div>'}</article>
 <article class="card"><div class="card-top"><div><h2>Giorni di spesa</h2><p class="subheading">Intensita delle uscite nel mese</p></div></div>${ui.periodMode==='month'?heatmap(rows):'<div class="empty">Seleziona un mese per visualizzare la distribuzione giornaliera.</div>'}<div class="divider"></div><h3>Benefici non monetari</h3><div class="stat-line" style="margin-top:12px"><span class="stat-name">Buoni pasto usati</span><strong class="stat-amount">${fmt(sum(rows.filter(t=>t.kind==='benefit')))}</strong></div><p class="explain" style="margin-top:12px">I buoni pasto non sono contante sul conto. Se registrati, vengono mostrati a parte e possono contribuire al totale di alimentari.</p></article></div>`;
}
function heatmap(rows){const [y,m]=ui.month.split('-').map(Number),max=new Date(y,m,0).getDate(),first=(new Date(y,m-1,1).getDay()+6)%7;
 const by=new Map();for(const t of expenses(rows)){const d=Number(t.occurred_on.slice(-2));by.set(d,(by.get(d)||0)+t.amount_cents);}
 const peak=Math.max(1,...by.values());let html='<div class="heat-titles">'+['L','M','M','G','V','S','D'].map(v=>`<span>${v}</span>`).join('')+'</div><div class="heatmap">';
 for(let i=0;i<first;i++)html+='<span></span>';for(let d=1;d<=max;d++){const v=by.get(d)||0;const level=v?Math.max(1,Math.ceil(v/peak*4)):0;html+=`<div class="heat-day" data-level="${level}" title="${d} ${monthNames[m-1]}: ${fmt(v)}"></div>`;}return html+'</div>';
}
function renderBudgets(){
 const budgets=state.budgets.filter(b=>ui.owner==='Famiglia'||b.owner===ui.owner||b.owner==='Famiglia');
 const monthRows=scoped(monthTx());
 return `${pageHead('Budget mensili','Definite voi i limiti: nessun budget viene inventato automaticamente.',`<button class="btn primary" data-action="add-budget">${icon('plus',15)} Nuovo budget</button>`)}${selectOwner()}
 ${!budgets.length?`<article class="card"><div class="empty">Non avete ancora assegnato un limite alle categorie.<br>Potete partire dalla spesa alimentare, dai trasporti o dal tempo libero, senza cambiare il registro delle spese.</div><div style="display:flex;justify-content:center"><button class="btn primary" data-action="add-budget">Crea il primo budget</button></div></article>`:`<div class="grid cols-2">${budgets.map(b=>{const spent=sum(expenses(monthRows.filter(t=>t.category===b.category&&(b.owner==='Famiglia'||t.owner===b.owner))));const ratio=b.amount_cents?spent/b.amount_cents:0;const cl=ratio>1?'rose':ratio>.8?'warn':'';
 return `<article class="card"><div class="card-top"><div><h2>${esc(categoryLabel(b.category,true))}</h2><p class="subheading">${esc(b.owner)} / ${esc(b.note||'Limite mensile')}</p></div><button class="tiny-btn" data-edit-budget="${esc(b.id)}">${icon('edit',16)}</button></div><div class="wide-number">${fmt(spent)} <span class="muted" style="font-size:13px;font-weight:400">di ${fmt(b.amount_cents)}</span></div><div class="progress ${cl}" style="margin-top:22px;height:9px"><i style="width:${Math.min(100,ratio*100)}%"></i></div><div class="card-foot"><span>${Math.round(ratio*100)}% utilizzato</span><strong>${fmt(b.amount_cents-spent)} residui</strong></div></article>`;}).join('')}</div>`}
 <div class="info-strip section-spacer">${icon('info',15)}<span>I budget sono obiettivi mensili; le spese effettive arrivano dai movimenti. Impostare un budget non genera un pagamento e non modifica i saldi.</span></div>`;
}
function renderGoals(){
 const gs=state.goals;
 return `${pageHead('Obiettivi e riserve','Fondi imprevisti, spese future e risparmi da costruire insieme.',`<button class="btn primary" data-action="add-goal">${icon('plus',15)} Nuovo obiettivo</button>`)}
 <div class="grid kpis">${kpi('Obiettivi attivi',String(gs.length),'Piani di risparmio','target')}${kpi('Risparmi indicati',fmt(gs.reduce((n,g)=>n+Number(g.current_cents),0)),'Registrati manualmente','wallet','accent')}${kpi('Traguardi',fmt(gs.reduce((n,g)=>n+Number(g.target_cents),0)),'Totale degli obiettivi','gauge')}${kpi('Ancora da accantonare',fmt(gs.reduce((n,g)=>n+Math.max(0,g.target_cents-g.current_cents),0)),'Non e una spesa corrente','chart-no-axes-combined')}</div>
 <article class="card"><div class="card-top"><div><h2>I vostri progetti</h2><p class="subheading">Gli importi sono registrazioni manuali e non saldi bancari verificati.</p></div></div>
 <div class="goal-list">${gs.map(g=>{const ratio=g.current_cents/g.target_cents*100;return `<div class="goal-item"><div class="list-icon">${icon('target',20)}</div><div class="goal-main"><div class="rec-head"><h3>${esc(g.title)}</h3><button class="tiny-btn" data-edit-goal="${esc(g.id)}">${icon('edit',15)}</button></div><div class="goal-price">${fmt(g.current_cents)} <span class="muted" style="font-size:12px;font-weight:400">di ${fmt(g.target_cents)}</span></div><div class="progress"><i style="width:${Math.min(100,ratio)}%"></i></div><div class="goal-info" style="margin-top:9px">${Math.round(ratio)}% completato ${g.note?' / '+esc(g.note):''}</div></div></div>`;}).join('')||'<div class="empty">Non ci sono ancora obiettivi. Puoi aggiungere un fondo imprevisti o un progetto da finanziare.</div>'}</div></article>`;
}
function renderFamily(){
 const persons=familyMembers(),archived=familyMembers(true).filter(m=>m.active===false);
 return `${pageHead('La famiglia','Aggiungi o rimuovi componenti senza perdere i movimenti già registrati.',`<button class="btn primary" data-action="add-member">${icon('plus',15)} Aggiungi componente</button>`)}${monthPicker()}
 <div class="grid kpis section-spacer">${kpi('Componenti attivi',String(persons.length),'Anagrafica familiare','users')}${kpi('Componenti archiviati',String(archived.length),'Storico conservato','folder')}${kpi('Movimenti da attribuire',String(state.transactions.filter(t=>t.owner==='Non attribuito').length),'Da verificare','receipt')}${kpi('Conti censiti',String(state.accounts.filter(a=>a.active!==false).length),'Bancari e contanti','wallet')}</div>
 <div class="owner-grid">${persons.map((m,i)=>{const p=m.name,rs=periodTx().filter(t=>t.owner===p);const ex=sum(expenses(rs)),inc=sum(incomes(rs)),rec=recurringTotal(ui.month,p);
 return `<article class="owner-card"><div class="who"><span class="avatar">${esc(p.slice(0,1).toUpperCase())}</span><div><div class="eyebrow">Componente ${i+1}</div><h2>${esc(p)}</h2></div><button type="button" class="btn ghost sm member-remove" data-remove-member="${esc(m.id)}">${icon('trash',14)} Rimuovi</button></div><div class="owner-kpi"><span>Uscite registrate nel periodo</span><strong class="money">${fmt(ex)}</strong></div><div class="grid cols-2" style="gap:16px;margin-top:19px"><div><span class="eyebrow">Entrate</span><div class="money positive" style="font-size:19px;margin-top:7px">${fmt(inc)}</div></div><div><span class="eyebrow">Ricorrenti</span><div class="money" style="font-size:19px;margin-top:7px">${fmt(rec)}</div></div></div><div class="owner-foot">Le spese sono attribuite a chi ha pagato, senza imporre una divisione rigida.</div></article>`;}).join('')}</div>
 ${archived.length?`<article class="card section-spacer"><div class="card-top"><div><h2>Componenti archiviati</h2><p class="subheading">I dati precedenti restano disponibili nello storico.</p></div></div><div class="family-archive-list">${archived.map(m=>`<div class="family-archive-row"><span>${esc(m.name)} <small>· archiviato</small></span><button class="btn ghost sm" data-restore-member="${esc(m.id)}">Ripristina</button><button class="btn ghost sm" data-remove-member="${esc(m.id)}">Elimina se inutilizzato</button></div>`).join('')}</div></article>`:''}
 <div class="grid two-col section-spacer"><article class="card"><div class="card-top"><div><h2>Gestione senza quote fisse</h2><p class="subheading">Ogni componente registra i propri movimenti.</p></div></div><p class="explain">Quadra distingue chi ha pagato e i conti utilizzati. I giroconti non diventano spese e le uscite comuni confluiscono nel bilancio familiare.</p><div class="divider"></div><p class="explain">Quando un componente ha già movimenti, conti o rate, la rimozione lo <strong>archivia</strong> invece di cancellarne lo storico. Potrai ripristinarlo in seguito.</p></article>
 <article class="card"><div class="card-top"><div><h2>Qualità dei movimenti</h2><p class="subheading">Registrazioni in attesa di verifica</p></div><span class="badge warn">Revisione</span></div><div class="wide-number">${state.transactions.filter(t=>t.owner==='Non attribuito'||t.confidence==='da verificare').length}</div><p class="explain" style="margin-top:10px">Attribuisci i movimenti al componente corretto, senza alterare i saldi bancari.</p><div class="card-foot"><button class="btn ghost sm" data-nav="movements">Apri movimenti</button></div></article></div>`;
}
function memberUsage(name){
 return {transactions:state.transactions.filter(t=>t.owner===name).length,accounts:state.accounts.filter(a=>a.owner===name).length,recurring:state.recurring.filter(r=>r.owner===name).length,plans:(state.payment_plans||[]).filter(p=>p.owner===name).length,budgets:state.budgets.filter(b=>b.owner===name).length};
}
function openMemberEditor(){
 const modal=document.createElement('div');modal.className='modal-backdrop';
 modal.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="Aggiungi componente"><div class="modal-head"><h2>Nuovo componente</h2><button class="icon-btn" type="button" data-close>${icon('x',18)}</button></div><p class="explain">Il componente potrà avere movimenti, conti, rate e budget propri. Non vengono creati conti automaticamente.</p><form id="member-form">${wrapField('Nome',formInput('name','','text','maxlength="70" required placeholder="Es. Luca"'))}<div class="modal-footer"><button type="button" class="btn ghost" data-close>Annulla</button><button type="submit" class="btn primary">Aggiungi componente</button></div></form></div>`;
 document.body.append(modal);
 $('#member-form',modal).addEventListener('submit',async e=>{e.preventDefault();try{
  const name=String(new FormData(e.currentTarget).get('name')||'').trim().replace(/\s+/g,' ');
  if(name.length<2||name.length>70)throw new Error('Il nome deve contenere tra 2 e 70 caratteri');
  if(RESERVED_OWNERS.some(x=>x.toLocaleLowerCase('it')===name.toLocaleLowerCase('it')))throw new Error('Nome riservato');
  if(state.members.some(x=>x.name.toLocaleLowerCase('it')===name.toLocaleLowerCase('it')))throw new Error('Il componente esiste già. Se archiviato puoi ripristinarlo.');
  if(state.members.length>=30)throw new Error('Massimo 30 componenti');
  const item={id:'member-'+uniqueId(),name,active:true};state.members.push(item);
  try{await persistLocal();closeModal(modal);render();toast('Componente aggiunto');}catch(err){state.members=state.members.filter(x=>x.id!==item.id);throw err;}
 }catch(err){toast(err.message,true);}});
}
async function removeMember(id){
 const m=state.members.find(x=>x.id===id);if(!m)return;
 const usage=memberUsage(m.name);const total=Object.values(usage).reduce((a,b)=>a+b,0);
 if(m.active!==false&&familyMembers().length<=1){toast('Mantieni almeno un componente attivo',true);return;}
 if(total){
  if(m.active===false){toast(`Non puoi eliminare ${m.name}: ci sono ${total} registrazioni collegate. Puoi lasciarlo archiviato.`,true);return;}
  if(!confirm(`${m.name} ha ${total} registrazioni collegate (movimenti, conti, rate o budget). Archiviarlo? Le registrazioni resteranno intatte.`))return;
  m.active=false;
  try{await persistLocal();if(ui.owner===m.name)ui.owner='Famiglia';render();toast('Componente archiviato, storico conservato');}catch(err){m.active=true;toast(err.message,true);}
  return;
 }
 if(!confirm(`Eliminare definitivamente ${m.name}? Non sono presenti registrazioni collegate.`))return;
 state.members=state.members.filter(x=>x.id!==m.id);
 try{await persistLocal();if(ui.owner===m.name)ui.owner='Famiglia';render();toast('Componente eliminato');}catch(err){state.members.push(m);toast(err.message,true);}
}
async function restoreMember(id){const m=state.members.find(x=>x.id===id);if(!m)return;m.active=true;try{await persistLocal();render();toast('Componente ripristinato');}catch(err){m.active=false;toast(err.message,true);}}
function renderSettings(){return `${pageHead('Impostazioni','Archivi privati, ripristino verificato, backup e preferenze.')}
<div class="grid two-col">
 <article class="card">
  <div class="card-top"><div><h2>Ripristina un archivio completo</h2><p class="subheading">Migra qui il backup di una versione precedente di Quadra</p></div>${icon('folder',20)}</div>
  <p class="explain">Seleziona un <strong>backup ZIP completo</strong> con archivio, scontrini e PDF oppure un JSON senza documenti. Prima di qualsiasi sostituzione Quadra mostra l'anteprima e conserva una copia di sicurezza dell'archivio attuale.</p>
  <div class="upload-zone"><div class="list-icon">${icon('upload',22)}</div><strong>Backup Quadra ZIP o JSON</strong>
  ${styledFilePicker('restore-file','.zip,.json,application/zip,application/json')}
  <button class="btn primary sm" data-action="inspect-restore">${icon('search',15)} Controlla il backup</button></div>
  <div id="restore-preview" class="restore-preview" aria-live="polite"></div>
 </article>
 <article class="card">
  <div class="card-top"><div><h2>Dove sono i dati</h2><p class="subheading">Separati dal programma, senza cloud</p></div>${icon('shield',20)}</div>
  <div class="settings-block"><div><h3>Cartella attiva</h3><p><code class="data-dir-display">${esc(storageInfo?.data_dir||'Cartella personale Quadra')}</code></p></div><span class="badge soft">Privata</span></div>
  <div class="settings-block"><div><h3>Archivio e documenti</h3><p><code>archivio.json</code>, <code>allegati/</code>, <code>estratti/</code> e <code>backup/</code> sono in questa cartella, non nei file del programma.</p></div></div>
  <div class="settings-block"><div><h3>Cambia posizione</h3><p>Chiudi Quadra ed esegui <code>CONFIGURA_DATI_WINDOWS.bat</code> (Windows) oppure <code>configura_dati_mac_linux.command</code>. Il cambio posizione non cancella né trasferisce automaticamente l'archivio precedente.</p></div></div>
  <div class="settings-block"><div><h3>Sicurezza</h3><p>Il server ascolta soltanto su <code>127.0.0.1</code>. Proteggi l'account del PC e conserva i backup in un luogo privato.</p></div><span class="badge soft">Offline</span></div>
 </article>
</div>
<article class="card section-spacer"><div class="card-top"><div><h2>Unisci dati da un JSON</h2><p class="subheading">Funzione avanzata: importa solo registrazioni, non documenti</p></div>${icon('file-json',19)}</div><p class="explain">Per trasferire l'intera contabilità usa invece <strong>Ripristina un archivio completo</strong>. L'unione evita gli ID duplicati, ma non sostituisce i saldi esistenti e non importa immagini o PDF.</p><div class="upload-zone"><strong>JSON da unire allo storico corrente</strong>${styledFilePicker('seed-file','.json,application/json')}<button class="btn ghost sm" data-action="import">Unisci JSON (senza allegati)</button></div><p class="form-hint" id="import-status">Nessun documento viene copiato con questa funzione.</p></article>
${renderCategoryManager()}
${renderNotificationSettings()}
<div class="grid two-col section-spacer"><article class="card"><div class="card-top"><div><h2>Esporta una copia</h2><p class="subheading">Proteggi le tue registrazioni</p></div>${icon('download',18)}</div><p class="explain">Il <strong>backup completo ZIP</strong> include movimenti, conti, categorie, foto e PDF con verifica d'integrità. Il JSON e il CSV contengono soltanto dati contabili. Conserva le copie in una cartella privata.</p><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:22px"><button class="btn primary" data-action="export-zip">${icon('download',16)} Backup completo ZIP</button><button class="btn" data-action="export">${icon('download',16)} Solo JSON</button><button class="btn" data-action="export-csv">${icon('download',16)} Movimenti CSV</button></div><div class="card-foot">${state.transactions.length} movimenti / ${state.recurring.length} ricorrenze / ${(state.payment_plans||[]).length} piani / ${state.budgets.length} budget</div></article>
<article class="card"><div class="card-top"><div><h2>Google Calendar</h2><p class="subheading">Esportazione manuale, nessun account collegato</p></div>${icon('calendar',18)}</div><p class="explain">Scarica il file .ics delle scadenze selezionate e importalo in Google Calendar. Nessuna sincronizzazione o trasferimento automatico.</p><button class="btn primary" data-action="export-calendar">${icon('calendar',16)} Prepara file .ics</button></article></div>
<div class="grid two-col section-spacer"><article class="card"><div class="card-top"><div><h2>Aspetto</h2><p class="subheading">Quattro temi grafici</p></div>${icon('settings',18)}</div><div class="settings-block"><div><h3>Tema</h3><p>Oat Milk, Forest Green e Tomato Red, oppure Midnight Black, Electric Blue e Sunset Orange.</p></div><button class="btn" data-action="theme">${icon('palette',16)} ${esc(THEME_NAMES[ui.theme])}</button></div></article></div>`;}

function onClick(e){
 const themeChoice=e.target.closest('[data-set-theme]');if(themeChoice){applyTheme(themeChoice.dataset.setTheme);themeChoice.closest('.modal-backdrop')?.remove();render();toast('Tema aggiornato');return;}
 const nav=e.target.closest('[data-nav]');if(nav){ui.page=nav.dataset.nav;ui.pageIndex=0;location.hash=ui.page;render();window.scrollTo(0,0);return;}
 const month=e.target.closest('[data-month]');if(month){ui.month=monthShift(ui.month,Number(month.dataset.month));ui.year=Number(ui.month.slice(0,4));ui.quarter=Math.ceil(Number(ui.month.slice(5,7))/3);ui.pageIndex=0;render();return;}
 if(handleScheduleClick(e))return;
 if(handlePaymentClick(e))return;
 if(handleAccountingClick(e))return;
 const own=e.target.closest('[data-owner]');if(own){ui.owner=own.dataset.owner;ui.pageIndex=0;render();return;}
 const delMember=e.target.closest('[data-remove-member]');if(delMember){removeMember(delMember.dataset.removeMember);return;}
 const restoreMemberBtn=e.target.closest('[data-restore-member]');if(restoreMemberBtn){restoreMember(restoreMemberBtn.dataset.restoreMember);return;}
 const editCat=e.target.closest('[data-edit-cat]');if(editCat){openCategoryModal(editCat.dataset.editCat);return;}
 const delCat=e.target.closest('[data-delete-cat]');if(delCat){deleteCategoryWithReassignment(delCat.dataset.deleteCat);return;}
 const editTx=e.target.closest('[data-edit-tx]');if(editTx){openModal('transactions',editTx.dataset.editTx);return;}
 const editRec=e.target.closest('[data-edit-rec]');if(editRec){openModal('recurring',editRec.dataset.editRec);return;}
 const editBudget=e.target.closest('[data-edit-budget]');if(editBudget){openModal('budgets',editBudget.dataset.editBudget);return;}
 const editGoal=e.target.closest('[data-edit-goal]');if(editGoal){openModal('goals',editGoal.dataset.editGoal);return;}
 const close=e.target.closest('[data-close]');if(close){closeModal(close.closest('.modal-backdrop'));return;}
 if(e.target.classList.contains('modal-backdrop')){closeModal(e.target);return;}
 const action=e.target.closest('[data-action]');if(!action)return;
 switch(action.dataset.action){
 case 'theme':openThemeModal();break;
 case 'notification-enable':enableNotifications();break;
 case 'notification-disable':disableNotifications();break;
 case 'notification-test':testNotification();break;
 case 'add-tx':openModal('transactions');break;
 case 'add-rec':openModal('recurring');break;
 case 'add-member':openMemberEditor();break;
 case 'add-budget':openModal('budgets');break;
 case 'add-goal':openModal('goals');break;
 case 'page-prev':ui.pageIndex=Math.max(0,ui.pageIndex-1);render();break;
 case 'page-next':ui.pageIndex++;render();break;
 case 'export':exportBackup();break;
 case 'export-zip':downloadFullBackup();break;
 case 'export-csv':exportCsv();break;
 case 'import':importBackup();break;
 case 'inspect-restore':inspectRestore();break;
 case 'confirm-restore':confirmRestore();break;
 case 'add-cat':openCategoryModal();break;
 case 'apply-cashflow-cats':restoreSourceCategories();break;
 case 'export-calendar':openCalendarExport();break;
 }
}
function onChange(e){
 if(e.target.id==='restore-file'){restoration=null;const preview=$('#restore-preview');if(preview)preview.innerHTML='';}
 if(e.target.matches('input.file-picker-input')){
   const label=document.getElementById(e.target.id+'-filename');
   if(label){label.textContent=e.target.files?.length?Array.from(e.target.files).map(f=>f.name).join(', '):'Nessun file selezionato';label.title=label.textContent;}
 }
 if(e.target.matches('[data-notification-days]')){changeNotificationDays(e.target.value);return;}
 if(handleScheduleChange(e))return;
 if(handlePaymentChange(e))return;
 if(handleAccountingChange(e))return;
 const field=e.target.dataset.field;
 if(field==='kind'){ui.kind=e.target.value;ui.pageIndex=0;render();}
 if(field==='category'){ui.category=e.target.value;ui.pageIndex=0;render();}
 if(field==='attachments-only'){ui.attachmentsOnly=e.target.checked;ui.pageIndex=0;render();}
}
function onInput(e){
 if(e.target.id==='category-search'){ui.categorySearch=e.target.value;refreshCategorySearch();return;}
 if(handleAccountingInput(e))return;
 if(e.target.dataset.field==='search'){
  ui.filter=e.target.value;ui.pageIndex=0;
  const a=e.target.selectionStart,b=e.target.selectionEnd;render();
  const fresh=$('[data-field="search"]');if(fresh){fresh.focus();fresh.setSelectionRange(a,b);}
 }
}
function wrapField(label,inner,hint=''){return `<div class="field"><label>${label}</label>${inner}${hint?`<div class="form-hint" style="margin-top:6px">${hint}</div>`:''}</div>`;}
function formInput(name,value='',type='text',extra=''){return `<input name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;}
function formSelect(name,options,chosen){return `<select name="${name}">${opt(options,chosen)}</select>`;}
function moneyInput(name,value){return formInput(name,Number(value||0).toFixed(2),'text','inputmode="decimal" required placeholder="0,00"');}
function styledFilePicker(id,accept,name=''){
  return `<div class="styled-file-picker"><input class="file-picker-input" type="file" id="${esc(id)}" ${name?`name="${esc(name)}"`:''} accept="${esc(accept)}" aria-describedby="${esc(id)}-filename"><label class="btn ghost file-picker-button" for="${esc(id)}">${icon('folder',15)} Scegli file</label><span id="${esc(id)}-filename" class="file-picker-filename" aria-live="polite">Nessun file selezionato</span></div>`;
}

const ATTACH_TAGS=['scontrino','ricevuta','garanzia','documento','altro'];
const ATTACH_TYPES=['image/jpeg','image/png','image/webp','application/pdf'];
const attachFmt=(bytes)=>bytes>1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1024))+' KB';
function closeModal(modal){if(!modal)return;modal._dispose?.();modal.remove();}
async function downloadFullBackup(){
 try{
  const response=await fetch('/api/backup-completo.zip',{credentials:'same-origin'});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Backup non disponibile');}
  const blob=await response.blob();const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='Quadra_backup_completo.zip';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
  toast('Backup completo ZIP scaricato: archivio, allegati e PDF.');
 }catch(err){toast('Backup non riuscito: '+err.message,true);}
}
function renderAttachmentCards(items,editing=false){
 return items.map(a=>{
  const href='/api/attachments/'+encodeURIComponent(a.id);
  return `<div class="attachment-card"><a class="attachment-preview" href="${href}" target="_blank" rel="noopener" title="Apri ${esc(a.name)}">
  ${a.mime_type.startsWith('image/')?`<img loading="lazy" src="${href}" alt="Anteprima di ${esc(a.name)}">`:icon('receipt',30)}
  </a><div class="attachment-caption"><strong title="${esc(a.name)}">${esc(a.name)}</strong><span>${esc(a.tag)} · ${attachFmt(a.size)}</span>
  <a href="${href}?download=1" class="attachment-download" download>Scarica</a></div>
  ${editing?`<button type="button" class="attachment-remove" data-remove-attachment="${esc(a.id)}" aria-label="Rimuovi ${esc(a.name)}" title="Elimina allegato">${icon('trash',14)}</button>`:''}</div>`;
 }).join('');
}
// Metadata and files are deliberately separate. Browser previews use temporary URLs
// and all photos are recompressed as JPEG when supported, stripping camera metadata.
function setupAttachmentEditor(modal,id){
 const input=modal.querySelector('[name="attachment_files"]');
 const zone=modal.querySelector('.attachment-dropzone');
 const box=modal.querySelector('#attachment-list');
 const pending=[];
 const getTx=()=>state.transactions.find(t=>t.id===id);
 const draw=()=>{
  const current=getTx()?.attachments||[];
  box.innerHTML=(current.length?`<p class="attachment-subtitle">Gia salvati (${current.length})</p>${renderAttachmentCards(current,true)}`:'')+
   (pending.length?`<p class="attachment-subtitle">Da aggiungere al salvataggio (${pending.length})</p>`:'')+
   pending.map((p,i)=>`<div class="attachment-card pending-attachment"><div class="attachment-preview">${p.file.type.startsWith('image/')?`<img src="${p.url}" alt="Anteprima ${esc(p.file.name)}">`:icon('receipt',30)}</div>
   <div class="attachment-caption"><strong title="${esc(p.file.name)}">${esc(p.file.name)}</strong><span>${attachFmt(p.file.size)}</span>
   <select data-pending-tag="${i}" aria-label="Tipo documento">${ATTACH_TAGS.map(tag=>`<option value="${tag}" ${p.tag===tag?'selected':''}>${tag}</option>`).join('')}</select></div>
   <button class="attachment-remove" type="button" data-drop-pending="${i}" title="Rimuovi dalla coda" aria-label="Rimuovi ${esc(p.file.name)}">${icon('x',14)}</button></div>`).join('')+
   (!current.length&&!pending.length?`<div class="attachment-empty">Nessun allegato. Puoi aggiungere uno o piu scontrini, ricevute o PDF.</div>`:'');
 };
 function enqueue(files){
  for(const file of files){
   if(!ATTACH_TYPES.includes(file.type)||file.size===0){toast('Formato non supportato: '+file.name+'. Usa JPG, PNG, WEBP o PDF.',true);continue;}
   if(file.size>25*1024*1024){toast('File troppo grande: '+file.name+' (max 25 MB per foto originale).',true);continue;}
   if((getTx()?.attachments?.length||0)+pending.length>=20){toast('Massimo 20 allegati per movimento',true);break;}
   pending.push({file,tag:'scontrino',url:URL.createObjectURL(file)});
  }
  draw();
 }
 input?.addEventListener('change',()=>{enqueue(input.files);input.value='';});
 zone?.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragover');});
 zone?.addEventListener('dragleave',()=>zone.classList.remove('dragover'));
 zone?.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragover');enqueue(e.dataTransfer?.files||[]);});
 box.addEventListener('change',e=>{const tag=e.target.closest('[data-pending-tag]');if(tag)pending[Number(tag.dataset.pendingTag)].tag=tag.value;});
 box.addEventListener('click',async e=>{
  const pendingDel=e.target.closest('[data-drop-pending]');
  if(pendingDel){const [p]=pending.splice(Number(pendingDel.dataset.dropPending),1);URL.revokeObjectURL(p.url);draw();return;}
  const existingDel=e.target.closest('[data-remove-attachment]');
  if(!existingDel)return;
  if(!confirm('Eliminare questo allegato dal disco? Questa operazione non puo essere annullata.'))return;
  existingDel.disabled=true;
  try{
   const result=await fetchJSON('/api/attachments/'+encodeURIComponent(existingDel.dataset.removeAttachment),{method:'DELETE'});
   const tx=state.transactions.find(t=>t.id===result.transaction_id);if(tx)tx.attachments=result.attachments;
   draw();toast('Allegato eliminato');
  }catch(err){existingDel.disabled=false;toast(err.message,true);}
 });
 draw();
 modal._dispose=()=>{for(const p of pending)URL.revokeObjectURL(p.url);};
 return {count:()=>pending.length,upload:async(txid)=>{
   let uploaded=0,failures=[];
   for(const p of pending){
    try{
     const result=await uploadAttachment(txid,p.file,p.tag);
     const tx=state.transactions.find(t=>t.id===txid);if(tx)tx.attachments=result.attachments;
     uploaded++;
    }catch(err){failures.push(p.file.name+': '+err.message);}
   }
   return {uploaded,failures};
 }};
}
async function compressedImage(file){
 if(!file.type.startsWith('image/'))return {blob:file,name:file.name};
 let bitmap;
 try{
  bitmap=await createImageBitmap(file);
  const max=2000,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
  const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Browser non supportato');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
  if(!blob)throw new Error('Impossibile ridurre la foto');
  return {blob,name:file.name.replace(/\.[^.]+$/,'')+'.jpg'};
 }finally{bitmap?.close?.();}
}
async function uploadAttachment(txid,file,tag){
 const {blob,name}=await compressedImage(file);
 if(blob.size>12*1024*1024)throw new Error('Supera il limite di 12 MB dopo la compressione');
 const response=await fetch('/api/transactions/'+encodeURIComponent(txid)+'/attachments',{
  method:'POST',credentials:'same-origin',headers:{'Content-Type':blob.type||'application/octet-stream','X-Quadra-Filename':encodeURIComponent(name),'X-Quadra-Tag':encodeURIComponent(tag)},body:blob});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||'Caricamento non riuscito');
 return data;
}

function openModal(table,id=null,preset='other'){
 const existing=state[table]?.find(x=>x.id===id)||null;
 const isEdit=!!existing;
 let title='',body='';
 if(table==='transactions'){
  const t=existing||{occurred_on:today,owner:familyMembers()[0]?.name||'Famiglia',kind:'expense',account_id:state.accounts.find(a=>a.active!==false&&a.type==='bank'&&a.owner===familyMembers()[0]?.name)?.id||'',payment_method:'debit',category:defaultCategory('Spesa: alimentare e prodotti'),merchant:'',description:'',details:'',attachments:[],amount_cents:0,confidence:'verificato'};
  title=isEdit?'Modifica movimento':'Nuovo movimento';
  body=`${wrapField('Descrizione / esercente',formInput('merchant',t.merchant,'text','maxlength="140" required'))}
  <div class="field-row">${wrapField('Data',formInput('occurred_on',t.occurred_on,'date','required'))}${wrapField('Importo in euro',moneyInput('amount_eur',num(t.amount_cents)))}</div>
  <div class="field-row">${wrapField('Tipo',`<select name="kind">${KINDS.map(k=>`<option value="${k.id}" ${k.id===t.kind?'selected':''}>${k.label}</option>`).join('')}</select>`)}${wrapField('Pagato da',formSelect('owner',ownerOptions(t.owner),t.owner))}</div>
  ${accountFields(t)}
  ${wrapField('Categoria',`<select name="category">${categoryOptions(t.category)}</select>`)}${wrapField('Nota breve',`<textarea name="description" rows="2" maxlength="300">${esc(t.description||'')}</textarea>`)}
  ${wrapField('Descrizione estesa / motivo della spesa',`<textarea name="details" rows="4" maxlength="4000" placeholder="Esempio: regalo per il compleanno, spesa mista, dettaglio della cena...">${esc(t.details||'')}</textarea>`)}
  ${wrapField('Affidabilita',formSelect('confidence',['verificato','stimato','provvisorio','da verificare'],t.confidence))}
  <div class="attachment-section"><div class="attachment-section-title">${icon('paperclip',17)} <strong>Foto e documenti</strong></div>
  <label class="attachment-dropzone" for="attachment-files">${icon('upload',18)} <span>Trascina qui foto o PDF, oppure <strong>scegli i file</strong></span>
  <small>JPG, PNG, WEBP, PDF · massimo 20 allegati · le foto vengono ridimensionate</small></label>
  <input id="attachment-files" class="sr-only" name="attachment_files" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" multiple>
  <div id="attachment-list" class="attachment-grid"></div><p class="form-hint">I file restano sul PC, nella cartella allegati/. Per salvarli tutti insieme usa Backup completo ZIP.</p></div>`;
 }
 if(table==='recurring'){
  const r=existing||{title:'',owner:'Famiglia',category:defaultCategory(preset==='financing'?'Finanziamento':preset==='subscription'?'Abbonamenti':'Utenze'),amount_cents:0,frequency:'monthly',due_day:Number(today.slice(8)),confidence:'verificato',note:'',active:1,start_on:today,end_on:'',schedule_type:preset,track_payments:1};
  title=isEdit?'Modifica scadenza':'Nuova scadenza';
  const initialScheduleType=r.schedule_type||scheduleType(r);
  body=`${wrapField('Descrizione',formInput('title',r.title,'text','required maxlength="120"'))}
  <div class="field-row">${wrapField('Importo in euro',moneyInput('amount_eur',num(r.amount_cents)))}${wrapField('Periodicita',`<select name="frequency"><option value="monthly" ${r.frequency==='monthly'?'selected':''}>Mensile</option><option value="yearly" ${r.frequency==='yearly'?'selected':''}>Annuale</option></select>`)}</div>
  <div class="field-row">${wrapField('Tipo',`<select name="schedule_type"><option value="subscription" ${initialScheduleType==='subscription'?'selected':''}>Abbonamento</option><option value="financing" ${initialScheduleType==='financing'?'selected':''}>Finanziamento / prestito</option><option value="other" ${initialScheduleType==='other'?'selected':''}>Altra ricorrenza</option></select>`)}${wrapField('Riferito a',formSelect('owner',ownerOptions(r.owner,false),r.owner))}</div>
  ${wrapField('Categoria',`<select name="category">${categoryOptions(r.category)}</select>`)}
  <div class="field-row">${wrapField('Giorno di scadenza (1-31)',formInput('due_day',r.due_day||1,'number','min="1" max="31" required'))}${wrapField('Affidabilita',formSelect('confidence',['verificato','stimato','provvisorio','da verificare'],r.confidence))}</div>
  <div class="field-row">${wrapField('Valida dal (facoltativo)',formInput('start_on',r.start_on||'','date'))}${wrapField('Termina il (facoltativo)',formInput('end_on',r.end_on||'','date'))}</div>
  ${wrapField('Note',`<textarea name="note" rows="3" maxlength="300">${esc(r.note||'')}</textarea>`,'Se il giorno non e\u0300 confermato, scrivi "data da verificare" nelle note: non comparira\u0300 nel calendario delle scadenze.')}
  <label class="checkbox-label"><input type="checkbox" name="track_payments" ${r.track_payments?'checked':''}> Mostra le scadenze da confermare in Movimenti</label>
  ${wrapField('Stato',`<select name="active"><option value="1" ${r.active!==0?'selected':''}>Attiva</option><option value="0" ${r.active===0?'selected':''}>Sospesa</option></select>`)}`;
 }
 if(table==='budgets'){
  const b=existing||{category:defaultCategory('Spesa: alimentare e prodotti'),owner:'Famiglia',amount_cents:0,note:''};title=isEdit?'Modifica budget':'Nuovo budget';
  body=`${wrapField('Categoria',`<select name="category">${categoryOptions(b.category)}</select>`)}<div class="field-row">${wrapField('Limite mensile in euro',moneyInput('amount_eur',num(b.amount_cents)))}${wrapField('Riferito a',formSelect('owner',ownerOptions(b.owner,false),b.owner))}</div>${wrapField('Note',formInput('note',b.note||'','text','maxlength="300"'))}`;
 }
 if(table==='goals'){
  const g=existing||{title:'',target_cents:0,current_cents:0,note:''};title=isEdit?'Modifica obiettivo':'Nuovo obiettivo';
  body=`${wrapField('Obiettivo',formInput('title',g.title,'text','required maxlength="100"'))}<div class="field-row">${wrapField('Traguardo in euro',moneyInput('target_eur',num(g.target_cents)))}${wrapField('Accantonato in euro',moneyInput('current_eur',num(g.current_cents)))}</div>${wrapField('Note',formInput('note',g.note||'','text','maxlength="300"'))}`;
 }
 const modal=document.createElement('div');modal.className='modal-backdrop';
 modal.innerHTML=`<div class="modal ${table==='transactions'?'modal-wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-close aria-label="Chiudi">${icon('x',18)}</button></div><form id="record-form">${body}<div class="modal-footer"><div>${isEdit?`<button type="button" class="btn danger sm" id="record-delete">${icon('trash',13)} Elimina</button>`:''}</div><div class="right"><button type="button" class="btn ghost" data-close>Annulla</button><button type="submit" class="btn primary">${icon('check',15)} Salva</button></div></div></form></div>`;
 document.body.append(modal);
 const attachmentsEditor=table==='transactions'?setupAttachmentEditor(modal,id):null;
 const form=$('#record-form',modal);form.addEventListener('submit',async(e)=>{
  e.preventDefault();const fd=new FormData(form);const val=(n)=>fd.get(n),cents=(n)=>{
    const clean=String(val(n)).trim().replace(/\s/g,'').replace(',','.');
    const number=Number(clean);
    if(!Number.isFinite(number)||number<0)throw new Error('Importo non valido');
    return Math.round(number*100);
  };
  let item;
  try{
   if(table==='transactions'){
     item={occurred_on:val('occurred_on'),merchant:val('merchant'),amount_cents:cents('amount_eur'),kind:val('kind'),owner:val('owner'),category:val('category'),description:val('description'),details:val('details'),confidence:val('confidence'),account_id:val('account_id')||'',counterparty_account_id:val('counterparty_account_id')||'',account_direction:val('account_direction')||'out',payment_method:val('payment_method')||'other'};
     if(item.account_id&&item.counterparty_account_id===item.account_id)throw new Error('Origine e destinazione devono essere diverse');
     if(!['transfer','withdrawal'].includes(item.kind))item.counterparty_account_id='';
     if(item.amount_cents<=0)throw new Error('Inserisci un importo positivo');
   }
   if(table==='recurring'){
     const schedule_type=String(val('schedule_type')||'other');
     item={title:val('title'),amount_cents:cents('amount_eur'),frequency:val('frequency'),owner:val('owner'),category:val('category'),due_day:Number(val('due_day')),confidence:val('confidence'),start_on:val('start_on')||null,end_on:val('end_on')||null,note:val('note'),active:Number(val('active')),track_payments:fd.has('track_payments')?1:0,track_from:existing?.track_from||(fd.has('track_payments')?today:null),schedule_type,is_subscription:schedule_type==='subscription'?1:0};
     if(item.start_on&&item.end_on&&item.end_on<item.start_on)throw new Error('Il termine non puo precedere l’inizio');
     if(!Number.isInteger(item.due_day)||item.due_day<1||item.due_day>31)throw new Error('Giorno di scadenza non valido');
   }
   if(table==='budgets')item={category:val('category'),amount_cents:cents('amount_eur'),owner:val('owner'),note:val('note')};
   if(table==='goals'){item={title:val('title'),target_cents:cents('target_eur'),current_cents:cents('current_eur'),note:val('note')};if(item.target_cents<=0)throw new Error('Obiettivo minimo: 0,01 euro');}
   // Assign the movement ID before uploading to associate files with the saved row.
   if(table==='transactions'&&!id)item.id=uniqueId();
   const submitBtn=form.querySelector('[type="submit"]');submitBtn.disabled=true;
   try{
    await saveRecord(table,item,id);
    if(attachmentsEditor&&attachmentsEditor.count()){
     const result=await attachmentsEditor.upload(id||item.id);
     closeModal(modal);render();
     if(result.failures.length)toast(`${result.uploaded} allegati salvati. Problemi: ${result.failures.join('; ')}`,true);
     else toast('Movimento salvato con '+result.uploaded+(result.uploaded===1?' allegato':' allegati'));
    }else{closeModal(modal);render();toast('Dati salvati');}
   }finally{submitBtn.disabled=false;}
  }catch(err){toast(err.message,true);}
 });
 if(isEdit){$('#record-delete',modal).addEventListener('click',async()=>{if(!confirm(`Eliminare definitivamente questa voce?`))return;
   try{await deleteRecord(table,id);closeModal(modal);render();toast('Voce eliminata');}catch(err){toast(err.message,true);}
 });}
 form.querySelector('input')?.focus();
}
async function uploadRestore(file,endpoint,confirm=false){
 const headers={'X-Quadra-Filename':encodeURIComponent(file.name),'Content-Type':file.name.toLowerCase().endsWith('.zip')?'application/zip':'application/json'};
 if(confirm)headers['X-Quadra-Action']='SOSTITUISCI';
 const result=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers,body:file});
 const payload=await result.json().catch(()=>({}));
 if(!result.ok)throw new Error(payload.error||`Errore HTTP ${result.status}`);
 return payload;
}
async function inspectRestore(){
 const input=$('#restore-file');const area=$('#restore-preview');
 if(!input?.files?.length){toast('Seleziona un file ZIP o JSON',true);return;}
 const file=input.files[0];
 if(file.size>200*1024*1024){toast('Il backup supera il limite di 200 MB',true);return;}
 area.innerHTML='<p class="form-hint">Controllo del file in corso...</p>';
 try{
  const report=await uploadRestore(file,'/api/archives/inspect');
  restoration={file,report};
  const detail=[['Movimenti',report.transactions],['Componenti',report.members],['Conti',report.accounts],['Categorie',report.categories],['Scadenze ricorrenti',report.recurring],['Piani a rate',report.payment_plans],['Estratti conto',report.statements],['Allegati e PDF',report.files]];
  area.innerHTML=`<div class="restore-summary"><h3>Archivio verificato · ${esc(report.kind)}</h3><div class="restore-summary-grid">${detail.map(([name,count])=>`<span>${esc(name)}</span><strong>${Number(count)||0}</strong>`).join('')}</div><p class="account-caution">Il ripristino <strong>sostituirà</strong> l'archivio attuale e i relativi documenti. Prima viene creato un backup completo nella cartella dati.</p><button class="btn primary" data-action="confirm-restore">${icon('check',16)} Ripristina questo archivio</button></div>`;
 }catch(err){restoration=null;area.innerHTML=`<p class="account-caution">${esc(err.message)}</p>`;toast(err.message,true);}
}
async function confirmRestore(){
 if(!restoration?.file){toast('Controlla prima il backup da ripristinare',true);return;}
 if(!confirm('ATTENZIONE: Quadra sostituirà tutto l’archivio attivo, compresi movimenti, categorie, conti, scontrini e PDF. Verrà creato un backup preventivo. Continuare?'))return;
 const confirmation=prompt('Per confermare digita RIPRISTINA (maiuscolo):');
 if(confirmation!=='RIPRISTINA'){toast('Ripristino annullato');return;}
 const {file}=restoration;const button=$('[data-action="confirm-restore"]');if(button)button.disabled=true;
 try{
   const result=await uploadRestore(file,'/api/archives/restore',true);
   toast(`Ripristinati ${result.transactions} movimenti e ${result.files} documenti. Ricarico Quadra...`);
   window.location.hash='overview';window.location.reload();
 }catch(err){if(button)button.disabled=false;toast(err.message,true);}
}
async function importBackup(){
 const input=$('#seed-file');if(!input?.files?.length){toast('Seleziona prima un file JSON',true);return;}
 const status=$('#import-status');const btn=$('[data-action="import"]');
 try{
  const raw=await input.files[0].text();if(raw.length>5000000)throw new Error('File troppo grande');
  const data=JSON.parse(raw);if(!['nido-family-v1','quadra-family-v1'].includes(data.format))throw new Error('Formato backup incompatibile.');
  if((data.transactions||[]).some(t=>(t.attachments||[]).length)||(data.statements||[]).some(x=>x.document))throw new Error('Questo JSON contiene riferimenti a documenti: usa il ripristino completo ZIP per non perdere le foto e i PDF.');
  const all={transactions:data.transactions||[],recurring:data.recurring||[],payment_plans:data.payment_plans||[],budgets:data.budgets||[],goals:data.goals||[]};
  const importCategories=Array.isArray(data.categories)?data.categories:[];
  for(const key of Object.keys(all)){if(!Array.isArray(all[key]))throw new Error('Sezione '+key+' non valida');}
  let total=0;for(const items of Object.values(all))total+=items.length;
  if(total<1)throw new Error('Il file non contiene record');
  if(!confirm(`Importare ${total} record? Le voci con ID gia presenti non verranno duplicate.`))return;
  btn.disabled=true;
  if(isLocal){

    const existingCategoryIds=new Set((state.categories||[]).map(x=>x.id));
    for(const cat of importCategories){if(cat&&typeof cat.id==='string'&&typeof cat.name==='string'&&typeof cat.group==='string'&&!existingCategoryIds.has(cat.id)){state.categories.push(cat);existingCategoryIds.add(cat.id);}}
    for(const [table,items] of Object.entries(all)){
      const existingIds=new Set(state[table].map(x=>x.id));const sources=new Set(state[table].map(x=>x.source_key).filter(Boolean));
      for(const item of items){if(existingIds.has(item.id)||(item.source_key&&sources.has(item.source_key)))continue;state[table].push(item);existingIds.add(item.id);if(item.source_key)sources.add(item.source_key);}
    }
    await addMissingLegacyCategories();
    for(const key of ['accounts','statements','import_rules']){const seen=new Set((state[key]||[]).map(x=>x.id));for(const row of (data[key]||[])){if(row?.id&&!seen.has(row.id)){state[key].push(row);seen.add(row.id);}}}
    for(const m of data.members||[]){if(m?.name&&!state.members.some(x=>x.name.toLocaleLowerCase('it')===String(m.name).toLocaleLowerCase('it')))state.members.push(m);}
    // Le esportazioni precedenti non contengono members: non perdere gli intestatari dei loro record.
    for(const sec of ['accounts','transactions','recurring','payment_plans','budgets'])for(const row of state[sec]||[]){const name=row.owner;if(name&&!RESERVED_OWNERS.includes(name)&&!state.members.some(m=>m.name===name))state.members.push({id:'member-'+uniqueId(),name,active:true});}
    await persistLocal();
  }else{
    const flat=Object.entries(all).flatMap(([table,items])=>items.map(item=>({table,item})));
    let imported=0;
    for(let i=0;i<flat.length;i+=175){const group={transactions:[],recurring:[],budgets:[],goals:[]};
      for(const x of flat.slice(i,i+175))group[x.table].push(x.item);
      const result=await fetchJSON('/api/import',{method:'POST',body:JSON.stringify(group)});
      imported+=result.imported;status.textContent=`Importati ${i+Math.min(175,flat.length-i)} / ${flat.length} record. Nuovi: ${imported}.`;
    }
    state=await fetchJSON('/api/state');
  }
  ui.month=(state.transactions.map(t=>t.occurred_on.slice(0,7)).filter(Boolean).sort().at(-1))||presentMonth;
  render();toast('Importazione completata. Duplicati ignorati.');
 }catch(err){toast('Importazione: '+err.message,true);if(status)status.textContent=err.message;}
 finally{if(btn)btn.disabled=false;}
}
function exportCsv(){
 const header=['Data','Persona','Tipo','Gruppo','Categoria','Esercente','Importo EUR','Note','Conferma','Fonte','Descrizione estesa','Numero allegati','Conto','Metodo','Conto destinazione'];
 const sep=';';const csvCell=(v)=>'"'+String(v??'').replace(/"/g,'""')+'"';
 const records=state.transactions.map(t=>[t.occurred_on,t.owner,t.kind,categoryGroup(t.category),categoryLabel(t.category),t.merchant,(t.amount_cents/100).toFixed(2).replace('.',','),t.description,t.confidence,t.source_key||'',t.details||'',(t.attachments||[]).length,accountName(t.account_id),t.payment_method||'',accountName(t.counterparty_account_id)]);
 const csv='\ufeff'+[header,...records].map(r=>r.map(csvCell).join(sep)).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=`quadra-movimenti-${today}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('CSV esportato');
}
function exportBackup(){
 const data={format:'quadra-family-v1',version:5,exported_at:new Date().toISOString(),transactions:state.transactions,recurring:state.recurring,payment_plans:state.payment_plans,budgets:state.budgets,goals:state.goals,categories:state.categories,accounts:state.accounts,statements:state.statements,import_rules:state.import_rules,members:state.members,accounts_initialized:state.accounts_initialized===true};
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=`quadra-backup-${today}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('JSON esportato. Per includere foto e PDF usa Backup completo ZIP.');
}
// Catalogo iniziale neutro, completamente personalizzabile.
function categoryById(id){return (state.categories||[]).find(x=>x.id===id);}
function categoryGroup(id){return categoryById(id)?.group||'Categoria non catalogata';}
function categoryLabel(id,withGroup=false){
  const item=categoryById(id);
  if(!item)return String(id||'Da classificare');
  return withGroup?`${item.group} / ${item.name}`:item.name;
}
function defaultCategory(name){return (state.categories||[]).find(c=>c.name===name)?.id||'Da classificare';}
function categoryOptions(selected,onlyUsed=false){
  const used=new Set([...state.transactions,...state.recurring,...state.budgets].map(x=>x.category).filter(Boolean));
  const groups=new Map();
  for(const c of state.categories||[]){
    if(onlyUsed&&!used.has(c.id))continue;
    if(!groups.has(c.group))groups.set(c.group,[]);
    groups.get(c.group).push(c);
  }
  let html='';
  for(const [group,items] of groups){
    html+=`<optgroup label="${esc(group)}">${items.map(c=>`<option value="${esc(c.id)}" ${c.id===selected?'selected':''}>${esc(c.name)}</option>`).join('')}</optgroup>`;
  }
  if(selected&&!((state.categories||[]).some(c=>c.id===selected)))html+=`<option value="${esc(selected)}" selected>${esc(selected)} (non catalogata)</option>`;
  return html;
}
async function addMissingLegacyCategories(){
  if(!Array.isArray(state.categories))state.categories=[];
  const present=new Set(state.categories.map(c=>c.id));
  let changed=0;
  for(const x of [...state.transactions,...state.recurring,...state.budgets]){
    if(typeof x.category!=='string'||!x.category.trim()||present.has(x.category))continue;
    state.categories.push({id:x.category,name:x.category,group:'Categorie importate',origin:'importata'});
    present.add(x.category);changed++;
  }
  return changed;
}
async function ensureCategoryCatalog(){
  let changed=false;
  if(!Array.isArray(state.categories)||!state.categories.length){
    const catalog=await fetchJSON('/catalogo_categorie.json');
    if(!Array.isArray(catalog)||catalog.length<1)throw new Error('Categorie iniziali non disponibili');
    state.categories=catalog;changed=true;
  }
  if(await addMissingLegacyCategories())changed=true;
  if(changed)await persistLocal();
}
function categoryUsage(id){
  return ['transactions','recurring','budgets'].reduce((count,tab)=>count+state[tab].filter(x=>x.category===id).length,0);
}
function renderCategoryManager(){
  const groups=new Map();
  for(const item of (state.categories||[])){
    if(!groups.has(item.group))groups.set(item.group,[]);
    groups.get(item.group).push(item);
  }
  const groupRows=[...groups].map(([group,items],i)=>`<details class="cat-group" ${i===0?'open':''}>
    <summary><span>${esc(group)}</span><span class="category-count">${items.length} voci</span></summary>
    <div class="cat-rows">${items.map(cat=>`<div class="cat-row"><span class="cat-name">${esc(cat.name)}<small>${categoryUsage(cat.id)} registrazioni</small></span><span class="cat-actions"><button class="tiny-btn" data-edit-cat="${esc(cat.id)}" aria-label="Modifica ${esc(cat.name)}" title="Rinomina o sposta">${icon('edit',15)}</button><button class="tiny-btn" data-delete-cat="${esc(cat.id)}" aria-label="Elimina o unisci ${esc(cat.name)}" title="Elimina o unisci">${icon('trash',15)}</button></span></div>`).join('')}</div>
  </details>`).join('');
  const n=state.categories?.length||0;
  return `<article class="card section-spacer" id="categorie"><div class="card-top"><div><h2>Categorie e sottocategorie</h2><p class="subheading">Categorie generali di partenza, modificabili o eliminabili liberamente.</p></div><span class="badge soft">${n} voci</span></div>
   <div class="cat-toolbar"><button class="btn primary sm" data-action="add-cat">${icon('plus',15)} Nuova categoria</button><div class="cat-search-field">${icon('search',16)}<input id="category-search" type="search" value="${esc(ui.categorySearch||'')}" placeholder="Cerca categoria o sezione…" autocomplete="off" aria-label="Cerca tra tutte le categorie"><span class="cat-search-clear" aria-hidden="true">⌕</span></div></div>
   <p class="explain">Le categorie sono esempi generici, non registrazioni finanziarie. Personalizzale liberamente; quando una categoria contiene movimenti, Quadra ti chiederà dove riassegnarli prima di eliminarla.</p>
   <div id="category-search-results" class="category-search-results" hidden></div><div class="cat-groups" id="category-group-list">${groupRows}</div></article>`;
}

function categorySearchNorm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('it').trim();}
function refreshCategorySearch(){
 const holder=$('#category-search-results'),groups=$('#category-group-list');
 if(!holder||!groups)return;
 const text=(ui.categorySearch||'').trim(),query=categorySearchNorm(text);
 holder.hidden=!query;groups.hidden=!!query;
 if(!query){holder.innerHTML='';return;}
 const found=(state.categories||[]).filter(c=>categorySearchNorm(c.name+' '+c.group).includes(query));
 holder.innerHTML=`<p class="cat-search-summary" role="status">${found.length} ${found.length===1?'categoria trovata':'categorie trovate'} per «${esc(text)}»</p>`+(found.length?
   `<div class="cat-search-list">${found.map(c=>`<div class="cat-row cat-search-item"><div class="cat-result-label"><strong>${esc(c.name)}</strong><small>${esc(c.group)} · ${categoryUsage(c.id)} registrazioni</small></div><span class="cat-actions"><button class="tiny-btn" data-edit-cat="${esc(c.id)}" aria-label="Modifica ${esc(c.name)}" title="Modifica">${icon('edit',15)}</button><button class="tiny-btn" data-delete-cat="${esc(c.id)}" aria-label="Elimina ${esc(c.name)}" title="Elimina o unisci">${icon('trash',15)}</button></span></div>`).join('')}</div>`:
   '<div class="cat-search-empty">Nessuna corrispondenza. Prova un altro termine o crea una nuova categoria.</div>');
}

function categoryGroups(){return [...new Set((state.categories||[]).map(x=>x.group))];}
function openCategoryModal(id=null){
  const existing=categoryById(id),isEdit=!!existing;
  const modal=document.createElement('div');modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="${isEdit?'Modifica categoria':'Nuova categoria'}"><div class="modal-head"><h2>${isEdit?'Modifica categoria':'Nuova categoria'}</h2><button class="icon-btn" data-close type="button" aria-label="Chiudi">${icon('x',18)}</button></div>
  <form id="category-form">${wrapField('Nome categoria',formInput('name',existing?.name||'','text','maxlength="140" required'))}
  ${wrapField('Gruppo di categorie',`<select name="group">${opt(categoryGroups(),existing?.group||'Casa e utenze')}</select>`)}
  ${wrapField('Oppure crea una nuova sezione',formInput('new_group','','text','maxlength="120" placeholder="Lascia vuoto per usare la sezione scelta"'))}
  <p class="form-hint">Se rinomini una categoria già usata, i movimenti, i budget e le ricorrenze restano associati perché il suo identificativo non cambia.</p>
  <div class="modal-footer"><div></div><div class="right"><button type="button" class="btn ghost" data-close>Annulla</button><button type="submit" class="btn primary">${icon('check',15)} Salva</button></div></div></form></div>`;
  document.body.append(modal);
  $('#category-form',modal).addEventListener('submit',async(e)=>{
    e.preventDefault();const data=new FormData(e.currentTarget),name=String(data.get('name')||'').trim(),group=String(data.get('new_group')||'').trim()||String(data.get('group')||'').trim();
    if(!name||!group){toast('Inserisci nome e sezione',true);return;}
    if(state.categories.some(c=>c.id!==id&&c.name.toLocaleLowerCase('it')===name.toLocaleLowerCase('it')&&c.group.toLocaleLowerCase('it')===group.toLocaleLowerCase('it'))){toast('Esiste già una categoria con questo nome nella stessa sezione',true);return;}
    const old=JSON.stringify(state.categories);
    try{
      if(isEdit){const c=categoryById(id);c.name=name;c.group=group;}
      else state.categories.push({id:'personale-'+uniqueId(),name,group,origin:'personalizzata'});
      await persistLocal();modal.remove();render();toast(isEdit?'Categoria aggiornata':'Categoria aggiunta');
    }catch(err){state.categories=JSON.parse(old);toast('Salvataggio: '+err.message,true);}
  });
  $('input[name="name"]',modal)?.focus();
}
async function deleteCategoryWithReassignment(id){
  const cat=categoryById(id);if(!cat)return;
  const count=categoryUsage(id);
  if(!count){
    if(!confirm(`Eliminare "${cat.name}" dalla sezione "${cat.group}"?`))return;
    const prev=state.categories;
    state.categories=state.categories.filter(c=>c.id!==id);
    try{await persistLocal();render();toast('Categoria eliminata');}catch(err){state.categories=prev;toast(err.message,true);}
    return;
  }
  const modal=document.createElement('div');modal.className='modal-backdrop';
  const options=categoryOptionsExcept(id);
  modal.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="Unisci categorie"><div class="modal-head"><h2>Unisci o elimina</h2><button class="icon-btn" data-close type="button" aria-label="Chiudi">${icon('x',18)}</button></div>
    <p class="explain">La categoria <strong>${esc(cat.group)} / ${esc(cat.name)}</strong> è usata in <strong>${count} registrazioni</strong>. Per non perdere lo storico, scegli dove spostare tutti i movimenti, le ricorrenze e i budget collegati.</p>
    <form id="merge-category-form" style="margin-top:20px">${wrapField('Categoria di destinazione',`<select name="replacement" required>${options}</select>`)}
      <div class="modal-footer"><div></div><div class="right"><button class="btn ghost" data-close type="button">Annulla</button><button class="btn danger" type="submit">${icon('check',15)} Sposta ed elimina</button></div></div></form></div>`;
  document.body.append(modal);
  $('#merge-category-form',modal).addEventListener('submit',async(e)=>{
    e.preventDefault();const dest=new FormData(e.currentTarget).get('replacement');
    if(!dest||dest===id){toast('Seleziona una categoria diversa',true);return;}
    if(!confirm(`Spostare ${count} registrazioni in "${categoryLabel(dest,true)}" ed eliminare "${cat.name}"?`))return;
    const old=JSON.stringify({categories:state.categories,transactions:state.transactions,recurring:state.recurring,budgets:state.budgets});
    try{
      for(const table of ['transactions','recurring','budgets'])for(const x of state[table])if(x.category===id)x.category=dest;
      state.categories=state.categories.filter(c=>c.id!==id);
      if(ui.category===id)ui.category='Tutte';
      await persistLocal();modal.remove();render();toast(`${count} registrazioni spostate; categoria eliminata`);
    }catch(err){Object.assign(state,JSON.parse(old));toast('Errore salvataggio: '+err.message,true);}
  });
}
function categoryOptionsExcept(id){
  const groups=new Map();for(const c of state.categories||[]){if(c.id===id)continue;if(!groups.has(c.group))groups.set(c.group,[]);groups.get(c.group).push(c);}
  return [...groups].map(([g,cs])=>`<optgroup label="${esc(g)}">${cs.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
}
async function restoreSourceCategories(){toast('Le categorie di questa installazione sono personalizzabili dalle Impostazioni.');}

// Esportazione iCalendar interamente locale: nessuna autenticazione o API Google.
const isoDay=(y,m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const monthLastDay=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
function nextIsoDay(iso){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return isoDay(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());}
function calendarDateKnown(r){
  if(r._isPaymentPlan&&Array.isArray(r._paymentDates))return true;
  const day=Number(r.due_day);
  if(!Number.isInteger(day)||day<1||day>31)return false;
  if(!['monthly','yearly'].includes(r.frequency))return false;
  if(/data da verificare|giorno da confermare|data da confermare|scadenza da verificare|giorno effettivo.*verificare/i.test(r.note||''))return false;
  if(r.frequency==='yearly'&&!/^\d{4}-\d{2}-\d{2}$/.test(r.start_on||''))return false;
  return true;
}
function getCalendarOccurrences(r,from,to){
  if(r._isPaymentPlan&&Array.isArray(r._paymentDates))return r._paymentDates.filter(d=>d>=from&&d<=to);
  if(!calendarDateKnown(r))return [];
  const start=String(r.start_on||'0000-01-01'),end=String(r.end_on||'9999-12-31');
  const lower=from>start?from:start,upper=to<end?to:end;
  if(lower>upper)return [];
  const a=Number(lower.slice(0,4)),b=Number(upper.slice(0,4));
  if(!Number.isFinite(a)||!Number.isFinite(b)||b-a>50)throw new Error('Intervallo calendario troppo ampio (massimo 50 anni)');
  const events=[],day=Number(r.due_day);
  if(r.frequency==='yearly'){
    const m=Number(r.start_on.slice(5,7));
    for(let y=a;y<=b;y++){const iso=isoDay(y,m,Math.min(day,monthLastDay(y,m)));if(iso>=lower&&iso<=upper)events.push(iso);}
  }else{
    for(let y=a;y<=b;y++)for(let m=1;m<=12;m++){
      const iso=isoDay(y,m,Math.min(day,monthLastDay(y,m)));if(iso>=lower&&iso<=upper)events.push(iso);
    }
  }
  return events;
}
function openCalendarExport(){
  const safeEnd=`${Number(today.slice(0,4))+2}-12-31`;
  const recs=[...state.recurring.filter(r=>r.active===1||r.active===true||r.active===undefined),...paymentCalendarEntries()];
  const modal=document.createElement('div');modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="Esporta ricorrenze su Google Calendar"><div class="modal-head"><h2>Esporta scadenze .ics</h2><button class="icon-btn" data-close type="button" aria-label="Chiudi">${icon('x',18)}</button></div>
  <p class="explain">Seleziona le ricorrenze da aggiungere al calendario. Il file viene creato sul PC, senza accessi a Google. Le date non confermate restano disabilitate finché non le correggi in Scadenze e rate.</p>
  <form id="calendar-export-form"><div class="field-row" style="margin-top:16px">${wrapField('Dal',formInput('from',today,'date','required'))}${wrapField('Fino al',formInput('to',safeEnd,'date','required'))}</div>
  <div class="field-row">${wrapField('Promemoria',`<select name="reminder"><option value="0">Nessuno</option><option value="1">1 giorno prima</option><option value="3" selected>3 giorni prima</option><option value="7">7 giorni prima</option></select>`)}<div class="field"><label>Privacy</label><label class="checkbox-label"><input type="checkbox" name="amounts" value="1"> Includi gli importi nelle descrizioni</label></div></div>
  <p class="form-hint">Di norma il titolo include nome della scadenza e persona, non la cifra. Le informazioni scelte saranno visibili nel calendario Google dopo l'importazione.</p>
  <div class="rec-select-head"><strong>Ricorrenze da esportare</strong><span class="category-count">${recs.length} in archivio</span></div><div class="calendar-rec-list">${recs.map(r=>{
   const known=calendarDateKnown(r),future=known&&getCalendarOccurrences(r,today,safeEnd).length>0;
   return `<label class="calendar-rec-row ${!known?'rec-unknown':''}"><input type="checkbox" name="rec_id" value="${esc(r.id)}" ${future&&r.confidence==='verificato'?'checked':''} ${!known?'disabled':''}><span><strong>${esc(r.title)}</strong><small>${esc(r.owner)} · ${r._isPaymentPlan?'piano a rate · '+r._paymentDates.length+' rate future':r.frequency==='yearly'?'annuale':'mensile'} · ${r._isPaymentPlan?'scadenze definite':known?'giorno '+r.due_day:'data da confermare'}${r.end_on?' · termine '+formatDate(r.end_on):''}</small></span>${!known?`<span class="badge warn">Verifica</span>`:''}</label>`;
  }).join('')}</div>
  <div class="modal-footer"><span class="form-hint">Non sincronizza automaticamente le modifiche future.</span><div class="right"><button class="btn ghost" type="button" data-close>Annulla</button><button class="btn primary" type="submit">${icon('download',15)} Scarica .ics</button></div></div>
  </form></div>`;
  document.body.append(modal);
  $('#calendar-export-form',modal).addEventListener('submit',(e)=>{
    e.preventDefault();const form=e.currentTarget,fd=new FormData(form),from=String(fd.get('from')),to=String(fd.get('to'));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to){toast('Verifica le date di inizio e fine',true);return;}
    const selected=new Set(fd.getAll('rec_id').map(String)),recurrences=recs.filter(r=>selected.has(r.id));
    if(!recurrences.length){toast('Seleziona almeno una scadenza con data confermata',true);return;}
    try{
      const {text:ics,count}=createIcs(recurrences,from,to,Number(fd.get('reminder'))||0,fd.has('amounts'));
      if(!count)throw new Error('Nessuna scadenza nel periodo selezionato');
      saveDownload(`quadra-scadenze-${from}-${to}.ics`,ics,'text/calendar;charset=utf-8');
      modal.remove();toast(`${count} scadenze preparate. Importa il file da Google Calendar > Impostazioni > Importazione ed esportazione.`);
    }catch(err){toast('Calendario: '+err.message,true);}
  });
}
function icsEscape(text){return String(text??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');}
function icsFold(line){
  let result='',byteCount=0;const enc=new TextEncoder();
  for(const ch of line){const bytes=enc.encode(ch).length;if(byteCount+bytes>75){result+='\r\n ';byteCount=1;}result+=ch;byteCount+=bytes;}
  return result;
}
function createIcs(recs,from,to,reminder,amounts=false){
  if(to.slice(0,4)-from.slice(0,4)>50)throw new Error('Periodo massimo 50 anni');
  const parts=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Quadra Offline//Scadenze familiari//IT','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Quadra - Scadenze familiari'];
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  let count=0;
  for(const r of recs){
    const dates=getCalendarOccurrences(r,from,to);
    if(!dates.length)continue;
    count+=dates.length;
    if(count>10000)throw new Error('Troppi eventi: restringi il periodo');
    // For days 29-31 use separate events so short months use their last day.
    const repeating=!r._isPaymentPlan&&dates.length>1&&Number(r.due_day)<=28;
    const series=repeating?[dates[0]]:dates;
    for(const iso of series){
      const key=repeating?'serie':iso.replace(/-/g,'');
      const uid=`quadra-${String(r.id).replace(/[^a-zA-Z0-9-]/g,'-')}-${key}@quadra.offline`;
      const summary=`Quadra · ${r.title}${r._isPaymentPlan?' · rata '+r._paymentNumbers[iso]+'/'+r._paymentTotal:''}`;
      let desc=`Scadenza familiare - ${r.owner}. Categoria: ${categoryLabel(r.category,true)}. Esportata manualmente da Quadra Offline.`;
      if(amounts)desc+=` Importo indicativo: ${fmt(r.amount_cents)}.`;
      parts.push('BEGIN:VEVENT',`UID:${uid}`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${iso.replace(/-/g,'')}`,`DTEND;VALUE=DATE:${nextIsoDay(iso).replace(/-/g,'')}`,`SUMMARY:${icsEscape(summary)}`,`DESCRIPTION:${icsEscape(desc)}`,'TRANSP:TRANSPARENT');
      if(repeating)parts.push(`RRULE:FREQ=${r.frequency==='monthly'?'MONTHLY':'YEARLY'};INTERVAL=1;UNTIL=${dates.at(-1).replace(/-/g,'')}`);
      if(reminder>0)parts.push('BEGIN:VALARM',`TRIGGER:-P${reminder}D`,'ACTION:DISPLAY',`DESCRIPTION:${icsEscape(summary)}`,'END:VALARM');
      parts.push('END:VEVENT');
    }
  }
  parts.push('END:VCALENDAR');
  return {text:parts.map(icsFold).join('\r\n')+'\r\n',count};
}
function saveDownload(filename,content,mime){
  const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}

init();
