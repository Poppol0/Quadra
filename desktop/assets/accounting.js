/* QUADRA 1.6 - contabilita annuale e gestione dinamica di conti e componenti, import XLSX / CSV.
   Tutto locale: il browser parla soltanto con il server Python su 127.0.0.1.
*/
'use strict';
const SEED_ACCOUNTS = [];
const ACCOUNT_KINDS=[['personal','Conto personale'],['mortgage','Conto mutuo'],['cash','Contanti'],['joint','Conto cointestato']];
const accountKind=(a)=>a?.account_kind|| (a?.type==='cash'?'cash':/mutuo/i.test(a?.label||'')?'mortgage':a?.owner==='Famiglia'?'joint':'personal');
const accountKindText=(a)=>ACCOUNT_KINDS.find(x=>x[0]===accountKind(a))?.[1]||'Conto bancario';
const activeAccount=(a)=>a.active!==false;
const visibleAt=(a,day)=>activeAccount(a)||(!a.archived_on||a.archived_on>day);
const TYPE_METHOD = [ ['debit','Carta di debito'], ['bank','Conto / addebito diretto'], ['bank_transfer','Bonifico'], ['cash','Contanti'], ['other','Altro / non noto'] ];
let importSession={file:null,parsed:null,sheet:'',accountId:'',mapping:null,candidates:[],invalid:0};
let accountStmtFilter='all';
const accountingText=(v)=>String(v??'').trim();
const validDate=(d)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(new Date(d+'T00:00:00Z').getTime())&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const defaultAccount=(owner,kind='expense')=>kind==='benefit'?'':(state.accounts.find(a=>activeAccount(a)&&a.type==='bank'&&a.owner===owner&&accountKind(a)==='personal')||state.accounts.find(a=>activeAccount(a)&&a.type==='bank'&&a.owner===owner))?.id||'';
const accountById=(id)=>state.accounts.find(x=>x.id===id);
function accountName(id){const a=accountById(id);return a?`${a.owner} · ${a.label}`:id?'Conto non trovato':'Da attribuire';}
function accountOpts(selected='',cash=true){return `<option value="" ${!selected?'selected':''}>Da attribuire (non riconciliato)</option>`+state.accounts.filter(a=>(cash||a.type==='bank')&&(activeAccount(a)||a.id===selected)).map(a=>`<option value="${esc(a.id)}" ${selected===a.id?'selected':''}>${esc(a.owner)} · ${esc(a.label)}${!activeAccount(a)?' (archiviato)':''}</option>`).join('');}
function accountFields(t){
 const selected=t.account_id||'',destination=t.counterparty_account_id||'';
 return `<div class="account-form-fields"><div class="field-row">
 ${wrapField('Conto da cui parte il movimento',`<select name="account_id">${accountOpts(selected)}</select>`,'I pagamenti con carta si addebitano sul conto personale, senza creare un secondo saldo.')}
 ${wrapField('Metodo di pagamento',`<select name="payment_method">${TYPE_METHOD.map(([v,label])=>`<option value="${v}" ${v===(t.payment_method||'other')?'selected':''}>${label}</option>`).join('')}</select>`)}
 </div>${wrapField('Conto di destinazione (solo per giroconto o prelievo)',`<select name="counterparty_account_id">${accountOpts(destination)}</select>`,'Lascia vuoto se il conto di arrivo non è censito. Per un prelievo scegli il portafoglio contanti.')}
 ${wrapField('Direzione sul conto (solo giroconto senza destinazione)',`<select name="account_direction"><option value="out" ${t.account_direction!=='in'?'selected':''}>Uscita dal conto</option><option value="in" ${t.account_direction==='in'?'selected':''}>Entrata nel conto</option></select>`)}
 </div>`;
}
async function initAccounting(){
 let change=false;
 for(const k of ['accounts','statements','import_rules'])if(!Array.isArray(state[k])){state[k]=[];change=true;}
 // Migrazione dagli archivi precedenti: non ricreare i conti eliminati volutamente.
 if(state.accounts_initialized!==true){
   if(state.accounts.length===0){state.accounts=SEED_ACCOUNTS.map(a=>({...a}));change=true;}
   state.accounts_initialized=true;change=true;
 }
 for(const a of state.accounts){
   if(!a.account_kind){a.account_kind=accountKind(a);change=true;}
   if(a.active===undefined){a.active=true;change=true;}
 }
 if(change)await persistLocal();
}
function selectedPeriod(){
 const y=String(ui.year||new Date().getFullYear());
 if(ui.periodMode==='year')return {start:y+'-01-01',end:y+'-12-31',label:'Anno '+y};
 if(ui.periodMode==='quarter'){
  const m=(Math.min(4,Math.max(1,ui.quarter))-1)*3+1;
  const e=new Date(Number(y),m+2,0).getDate();
  return {start:`${y}-${String(m).padStart(2,'0')}-01`,end:`${y}-${String(m+2).padStart(2,'0')}-${String(e).padStart(2,'0')}`,label:`${ui.quarter}° trimestre ${y}`};
 }
 const m=ui.month.startsWith(y)?ui.month:y+'-01';
 return {start:m+'-01',end:m+'-'+String(new Date(Number(m.slice(0,4)),Number(m.slice(5,7)),0).getDate()).padStart(2,'0'),label:formatMonth(m)};
}
function periodTx(){const {start,end}=selectedPeriod();return state.transactions.filter(t=>t.occurred_on>=start&&t.occurred_on<=end);}
function selectedChartMonths(){
 if(ui.periodMode==='year')return Array.from({length:12},(_,i)=>`${ui.year}-${String(i+1).padStart(2,'0')}`);
 if(ui.periodMode==='quarter')return Array.from({length:3},(_,i)=>`${ui.year}-${String((ui.quarter-1)*3+i+1).padStart(2,'0')}`);
 return Array.from({length:6},(_,i)=>monthShift(ui.month,i-5));
}
function periodPicker(){
 const years=new Set([new Date().getFullYear(),2025,2026,ui.year,Number(ui.month.slice(0,4))]);
 for(const x of state.transactions)years.add(Number(x.occurred_on.slice(0,4)));
 for(const y of [...years])years.add(y+1);
 const options=[...years].filter(y=>y>=2020&&y<2100).sort((a,b)=>b-a).map(y=>`<option value="${y}" ${y===ui.year?'selected':''}>${y}</option>`).join('');
 const mode=[['year','Anno'],['quarter','Trimestre'],['month','Mese']].map(([v,label])=>`<button class="period-tab ${ui.periodMode===v?'selected':''}" data-period-mode="${v}">${label}</button>`).join('');
 const quarter=ui.periodMode==='quarter'?`<select data-period-quarter title="Trimestre">${[1,2,3,4].map(q=>`<option value="${q}" ${q===ui.quarter?'selected':''}>${q}° trimestre</option>`).join('')}</select>`:'';
 const month=ui.periodMode==='month'?`<div class="month-control"><button data-month="-1" aria-label="Mese precedente">${icon('chevron-left',15)}</button><span class="month-label">${formatMonth(ui.month)}</span><button data-month="1" aria-label="Mese successivo">${icon('chevron-right',15)}</button></div>`:'';
 return `<div class="period-picker"><label class="period-year-label">Esercizio <select data-period-year aria-label="Seleziona anno">${options}</select></label><div class="period-tabs">${mode}</div>${quarter}${month}</div>`;
}
const previousDay=(iso)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);};
function ledgerEffects(tx,accountId){
 if(tx.kind==='benefit')return 0;
 const amount=Number(tx.amount_cents)||0;
 if(!amount)return 0;
 if(tx.kind==='transfer'){
   if(tx.account_id===accountId)return tx.account_direction==='in'?amount:-amount;
   if(tx.counterparty_account_id===accountId)return tx.account_direction==='in'?-amount:amount;
   return 0;
 }
 if(tx.kind==='withdrawal'){
   if(tx.account_id===accountId)return -amount;
   if(tx.counterparty_account_id===accountId)return tx.account_direction==='in'?-amount:amount;
   return 0;
 }
 if(tx.account_id!==accountId)return 0;
 if(tx.kind==='income')return amount;
 if(tx.kind==='expense'||tx.kind==='investment')return -amount;
 return 0;
}
function accountDelta(id,start,end){return state.transactions.filter(t=>t.occurred_on>=start&&t.occurred_on<=end).reduce((n,t)=>n+ledgerEffects(t,id),0);}
function balanceAt(id,day){
 const a=accountById(id);if(!a)return null;
 const anchor=[];
 if(a.opening_on&&Number.isInteger(a.opening_cents)&&a.opening_on<=day)
    anchor.push({date:a.opening_on,cents:a.opening_cents,opening:true});
 for(const s of state.statements){
   if(s.account_id===id&&s.period_end<=day&&Number.isInteger(s.closing_cents))anchor.push({date:s.period_end,cents:s.closing_cents,opening:false});
 }
 if(!anchor.length)return null;
 anchor.sort((x,y)=>x.date.localeCompare(y.date)||Number(x.opening)-Number(y.opening));
 const last=anchor.at(-1);
 const lo=last.opening?last.date:nextIsoDay(last.date);
 return last.cents+accountDelta(id,lo,day);
}
function balanceBefore(id,day){
 const a=accountById(id);
 if(!a)return null;
 if(a.opening_on===day&&Number.isInteger(a.opening_cents))return a.opening_cents;
 return balanceAt(id,previousDay(day));
}
function reconciliation(s){
 const calculated=s.opening_cents+accountDelta(s.account_id,s.period_start,s.period_end);
 return {calculated,diff:s.closing_cents-calculated};
}
function householdBalance(day){
 const accounts=state.accounts.filter(a=>a.type==='bank'&&visibleAt(a,day));const vals=accounts.map(a=>balanceAt(a.id,day));
 return vals.every(v=>v!==null)?vals.reduce((a,b)=>a+b,0):null;
}
function periodsWithin(year){return Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);}
function yearPeriodTable(year){
 const months=periodsWithin(year),incomeTotal=months.reduce((a,m)=>a+income(m),0),spentTotal=months.reduce((a,m)=>a+spend(m),0);
 return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Periodo</th><th>Entrate</th><th>Uscite effettive</th><th>Risultato</th><th>Movimenti</th><th></th></tr></thead><tbody>${months.map((m,i)=>{const inc=income(m),exp=spend(m);return `<tr><td><strong>${monthNames[i]}</strong></td><td class="money positive">${fmt(inc)}</td><td class="money negative">${fmt(exp)}</td><td class="money ${inc>=exp?'positive':'negative'}">${fmt(inc-exp)}</td><td>${monthTx(m).length}</td><td><button class="btn ghost sm" data-open-month="${m}">Apri</button></td></tr>`;}).join('')}</tbody><tfoot><tr><td><strong>Totale esercizio</strong></td><td><strong>${fmt(incomeTotal)}</strong></td><td><strong>${fmt(spentTotal)}</strong></td><td><strong>${fmt(incomeTotal-spentTotal)}</strong></td><td>${state.transactions.filter(t=>t.occurred_on.startsWith(String(year))).length}</td><td></td></tr></tfoot></table></div>`;
}
function renderExercises(){
 const year=ui.year,rows=scoped(state.transactions.filter(t=>t.occurred_on.startsWith(String(year))));
 const inc=sum(incomes(rows)),ex=sum(expenses(rows)),comparison=state.transactions.filter(t=>t.occurred_on.startsWith(String(year-1)));
 const prevIn=sum(incomes(scoped(comparison))),prevOut=sum(expenses(scoped(comparison)));
 const days=state.transactions.filter(t=>t.occurred_on.startsWith(String(year)));
 const quarterRows=[1,2,3,4].map(q=>{const m0=(q-1)*3+1;const a=days.filter(t=>Number(t.occurred_on.slice(5,7))>=m0&&Number(t.occurred_on.slice(5,7))<=m0+2);return {q,inc:sum(incomes(scoped(a))),ex:sum(expenses(scoped(a))),count:a.length};});
 return `${pageHead('Bilancio per esercizi','Ogni anno ha un riepilogo autonomo, con viste mensili e trimestrali.',periodPicker())}${selectOwner()}
 <div class="grid kpis">${kpi('Entrate '+year,fmt(inc),'Solo incassi registrati','arrow-down-right','positive')}${kpi('Uscite '+year,fmt(ex),'Esclusi giroconti e prelievi','arrow-up-right')}${kpi('Risultato economico',fmt(inc-ex),'Non equivale al saldo dei conti','wallet',inc>=ex?'positive':'negative')}${kpi('Movimenti',String(rows.length),'Operazioni dell’esercizio','receipt')}</div>
 <div class="grid two-col section-spacer"><article class="card"><div class="card-top"><div><h2>Andamento annuale ${year}</h2><p class="subheading">Entrate e spese effettive nei dodici mesi</p></div></div>${sumChart(periodsWithin(year))}</article>
 <article class="card"><div class="card-top"><div><h2>Confronto con ${year-1}</h2><p class="subheading">Comparazione indicativa dei movimenti disponibili</p></div></div>
 ${comparison.length?`<div class="stat-lines"><div class="stat-line"><span>Entrate ${year-1}</span><strong>${fmt(prevIn)}</strong></div><div class="stat-line"><span>Entrate ${year}</span><strong>${fmt(inc)}</strong></div><div class="stat-line"><span>Uscite ${year-1}</span><strong>${fmt(prevOut)}</strong></div><div class="stat-line"><span>Uscite ${year}</span><strong>${fmt(ex)}</strong></div></div>`:'<div class="empty">Non ci sono dati dell’anno precedente. Nessun confronto stimato.</div>'}
 <div class="card-foot">Controlla i saldi bancari nella sezione Conti e saldi.</div></article></div>
 <article class="card section-spacer"><div class="card-top"><div><h2>Quattro trimestri</h2><p class="subheading">Per analizzare una stagione senza scorrere i mesi</p></div></div><div class="quarter-grid">${quarterRows.map(x=>`<button class="quarter-card" data-open-quarter="${x.q}"><span>${x.q}° trimestre</span><strong>${fmt(x.inc-x.ex)}</strong><small>Entrate ${fmt(x.inc)} · Uscite ${fmt(x.ex)}</small><small>${x.count} movimenti · Apri periodo</small></button>`).join('')}</div></article>
 <article class="card section-spacer"><div class="card-top"><div><h2>Registro mensile ${year}</h2><p class="subheading">Dodici mesi dello stesso esercizio, con totali e collegamenti diretti</p></div></div>${yearPeriodTable(year)}</article>
 <div class="info-strip section-spacer">${icon('info',16)}<span><strong>Risultato economico ≠ saldo bancario.</strong> Per i saldi servono un saldo iniziale verificato e i movimenti attribuiti al conto corretto. Le ricorrenze sono previsioni e non vengono aggiunte alle uscite già registrate.</span></div>`;
}
function renderAccounts(){
 const {start,end,label}=selectedPeriod();
 const bank=state.accounts.filter(a=>a.type==='bank'&&activeAccount(a));
 const cash=state.accounts.filter(a=>a.type==='cash'&&activeAccount(a));
 const archived=state.accounts.filter(a=>!activeAccount(a));
 const activeBanksAtDate=state.accounts.filter(a=>a.type==='bank'&&visibleAt(a,end));
 const vals=activeBanksAtDate.map(a=>balanceAt(a.id,end)),complete=vals.every(v=>v!==null)&&vals.length>0;
 const unmatched=periodTx().filter(t=>t.kind!=='benefit'&&!t.account_id);
 const acctCards=(accounts)=>accounts.map(a=>{
   const begin=balanceBefore(a.id,start),close=balanceAt(a.id,end),change=accountDelta(a.id,start,end);
   const missing=periodTx().filter(t=>t.owner===a.owner&&!t.account_id&&t.kind!=='benefit').length;
   const checkpoints=state.statements.filter(s=>s.account_id===a.id&&s.period_start<=end&&s.period_end>=start);
   return `<article class="card account-card ${!activeAccount(a)?'archived-card':''}"><div class="card-top"><div><p class="eyebrow">${esc(a.owner)} · ${esc(accountKindText(a))} ${!activeAccount(a)?'· Archiviato':''}</p><h2>${esc(a.label)}</h2></div><div class="account-card-actions"><button class="btn ghost sm" data-account-edit="${esc(a.id)}">${icon('edit',14)} Modifica</button>${activeAccount(a)?`<button class="btn ghost sm" data-account-remove="${esc(a.id)}">${icon('trash',14)} Rimuovi</button>`:`<button class="btn ghost sm" data-account-restore="${esc(a.id)}">Ripristina</button><button class="btn ghost sm" data-account-remove="${esc(a.id)}">Elimina</button>`}</div></div>
   <div class="account-balance">${close===null?'Da verificare':fmt(close)}</div><p class="subheading">Saldo calcolato al ${formatDate(end)} ${close===null?'— inserisci un saldo verificato':'— provvisorio finché non riconciliato'}</p>
   <div class="account-stats"><div><small>Saldo d’apertura</small><strong>${begin===null?'Da impostare':fmt(begin)}</strong></div><div><small>Variazione registrata</small><strong class="${change>=0?'positive':'negative'}">${change>=0?'+':''}${fmt(change)}</strong></div><div><small>Estratti nel periodo</small><strong>${checkpoints.length}</strong></div></div>
   ${missing?`<p class="account-caution">${icon('alert-circle',14)} ${missing} movimenti di ${esc(a.owner)} senza conto assegnato: il saldo potrebbe essere incompleto.</p>`:''}</article>`;
 }).join('');
 const chosen=state.statements.filter(s=>(accountStmtFilter==='all'||s.account_id===accountStmtFilter)&&s.period_start.slice(0,4)===String(ui.year)).sort((a,b)=>b.period_end.localeCompare(a.period_end));
 return `${pageHead('Conti e riconciliazione','Aggiungi conti, scegli la tipologia e verifica saldi e estratti.',`<button class="btn primary" data-action="add-account">${icon('plus',15)} Nuovo conto</button>`)}${periodPicker()}
 <div class="grid kpis section-spacer">${kpi('Liquidità bancaria',complete?fmt(vals.reduce((a,b)=>a+b,0)):'Da verificare',complete?'Saldi registrati e conti del periodo':'Inserisci i saldi bancari verificati','wallet',complete?'accent':'')}${kpi('Conti bancari',String(bank.length),'Personali, mutuo e cointestati','layers')}${kpi('Estratti conto',String(state.statements.filter(s=>s.period_start.startsWith(String(ui.year))).length),'Registrati per l’esercizio','receipt')}${kpi('Movimenti senza conto',String(unmatched.length),'Non contribuiscono alla riconciliazione','alert-circle',unmatched.length?'negative':'positive')}</div>
 <div class="account-section-title"><h2>Conti bancari</h2><div class="right-actions"><button class="btn ghost sm" data-action="add-statement">${icon('receipt',15)} Registra estratto</button><button class="btn primary sm" data-action="add-account">${icon('plus',15)} Aggiungi conto</button></div></div><div class="grid cols-2">${acctCards(bank)}</div>${!bank.length?'<div class="empty">Nessun conto bancario attivo. Aggiungi un conto personale, mutuo o cointestato.</div>':''}
 <div class="account-section-title"><h2>Portafogli contanti</h2><span class="muted" style="font-size:11px">Un prelievo sposta liquidità e non è una spesa</span></div><div class="grid cols-2">${acctCards(cash)}</div>${!cash.length?'<div class="empty">Nessun portafoglio contanti. Puoi aggiungerne uno usando “Nuovo conto”.</div>':''}
 ${archived.length?`<div class="account-section-title"><h2>Conti archiviati</h2><span class="muted" style="font-size:11px">Conservati per non perdere i movimenti storici</span></div><div class="grid cols-2">${acctCards(archived)}</div>`:''}
 <article class="card section-spacer"><div class="card-top"><div><h2>Estratti conto e riconciliazioni</h2><p class="subheading">Periodi mensili o trimestrali, con PDF originale facoltativo.</p></div><button class="btn primary sm" data-action="add-statement">${icon('plus',15)} Nuovo</button></div>
 <div class="tools"><select data-stmt-filter><option value="all">Tutti i conti</option>${state.accounts.filter(a=>a.type==='bank').map(a=>`<option value="${esc(a.id)}" ${accountStmtFilter===a.id?'selected':''}>${esc(a.owner)} · ${esc(a.label)}${!activeAccount(a)?' (archiviato)':''}</option>`).join('')}</select><button class="btn ghost sm" data-nav="file-import">${icon('upload',15)} Importa movimenti</button></div>
 <div class="table-wrap"><table class="data-table"><thead><tr><th>Conto</th><th>Periodo</th><th>Saldo iniziale</th><th>Saldo finale banca</th><th>Saldo calcolato</th><th>Scostamento</th><th></th></tr></thead><tbody>${chosen.map(s=>{const r=reconciliation(s);return `<tr><td>${esc(accountName(s.account_id))}</td><td>${formatDate(s.period_start)} – ${formatDate(s.period_end)}</td><td>${fmt(s.opening_cents)}</td><td>${fmt(s.closing_cents)}</td><td>${fmt(r.calculated)}</td><td><strong class="${r.diff===0?'positive':'negative'}">${r.diff===0?'Quadrato':fmt(r.diff)}</strong></td><td><button class="btn ghost sm" data-stmt-edit="${esc(s.id)}">Apri</button></td></tr>`;}).join('')}</tbody></table></div>${!chosen.length?'<div class="empty">Nessun estratto conto per l’anno selezionato.</div>':''}
 <div class="card-foot"><span>La differenza è il saldo bancario finale meno quello calcolato dai movimenti.</span><span>${chosen.length} estratti</span></div></article>
 <div class="info-strip section-spacer">${icon('shield',16)}<span><strong>Rimozione sicura:</strong> un conto senza collegamenti può essere eliminato definitivamente. Se ha movimenti, rate o estratti, Quadra lo archivia e mantiene tutte le registrazioni.</span></div>`;
}
function openAccountEditor(id=null){
 const a=id?accountById(id):null;
 const defaultOwner=familyMembers()[0]?.name||'Famiglia';
 const kind=a?accountKind(a):'personal';
 const modal=document.createElement('div');modal.className='modal-backdrop';
 const opts=ACCOUNT_KINDS.map(([v,t])=>`<option value="${v}" ${kind===v?'selected':''}>${t}</option>`).join('');
 modal.innerHTML=`<div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="${a?'Modifica conto':'Nuovo conto'}"><div class="modal-head"><h2>${a?'Modifica conto':'Nuovo conto'}</h2><button class="icon-btn" data-close>${icon('x',18)}</button></div><p class="explain">Il conto conserva un saldo distinto. Le carte di debito non vanno aggiunte come conti separati.</p>
 <form id="account-edit-form">
 <div class="field-row">${wrapField('Nome del conto',formInput('label',a?.label||'','text','maxlength="100" required placeholder="Es. Conto banca"'))}${wrapField('Tipologia',`<select name="account_kind">${opts}</select>`)}</div>
 ${wrapField('Intestatario',`<select name="owner">${opt(ownerOptions(a?.owner||defaultOwner,false),a?.owner||defaultOwner)}</select>`,'Per i conti cointestati suggeriamo «Famiglia».')}
 <div class="field-row">${wrapField('Data del saldo iniziale',formInput('opening_on',a?.opening_on||'','date'))}${wrapField('Saldo iniziale (€)',formInput('opening_eur',Number.isInteger(a?.opening_cents)?(a.opening_cents/100).toFixed(2):'','text','inputmode="decimal" placeholder="Es. 1500,00"'))}</div>
 ${wrapField('Note sul conto',`<textarea name="note" rows="2" maxlength="400">${esc(a?.note||'')}</textarea>`)}
 <div class="modal-footer"><button class="btn ghost" type="button" data-close>Annulla</button><button class="btn primary" type="submit">${a?'Salva modifiche':'Crea conto'}</button></div></form></div>`;
 document.body.append(modal);
 const form=$('#account-edit-form',modal);
 form.elements.account_kind.addEventListener('change',()=>{
  if(form.elements.account_kind.value==='joint')form.elements.owner.value='Famiglia';
 });
 form.addEventListener('submit',async e=>{
  e.preventDefault();try{
   if(!a&&state.accounts.length>=40)throw new Error('Massimo 40 conti censiti');
   const fd=new FormData(form),label=String(fd.get('label')||'').trim();
   const kind=String(fd.get('account_kind')||''),owner=String(fd.get('owner')||'');
   const date=String(fd.get('opening_on')||''),raw=String(fd.get('opening_eur')||'').trim();
   if(!label||label.length>100)throw new Error('Indica il nome del conto');
   if(!ACCOUNT_KINDS.some(x=>x[0]===kind))throw new Error('Tipologia conto non valida');
   if(!ownerOptions(a?.owner||'',false).includes(owner))throw new Error('Intestatario non valido');
   if(Boolean(date)!==Boolean(raw))throw new Error('Indica insieme data e saldo, oppure lasciali entrambi vuoti');
   if(date&&!validDate(date))throw new Error('Data saldo non valida');
   const newRec={id:a?.id||'account-'+uniqueId(),label,owner,account_kind:kind,type:kind==='cash'?'cash':'bank',opening_on:date,opening_cents:raw?signedCents(raw):null,note:String(fd.get('note')||'').trim(),active:a?.active!==false};
   if(kind==='joint')newRec.owner='Famiglia';
   if(a&&a.type!==newRec.type&&state.statements.some(s=>s.account_id===a.id))throw new Error('Questo conto ha estratti bancari: elimina o sposta gli estratti prima di trasformarlo in contanti');
   const snapshot=a?{...a}:null;
   if(a)Object.assign(a,newRec);else state.accounts.push(newRec);
   try{await persistLocal();closeModal(modal);render();toast(a?'Conto aggiornato':'Conto aggiunto');}
   catch(err){if(a)Object.assign(a,snapshot);else state.accounts=state.accounts.filter(x=>x.id!==newRec.id);throw err;}
  }catch(err){toast(err.message,true);}
 });
}
function accountUsage(id){
 return {movimenti:state.transactions.filter(t=>t.account_id===id||t.counterparty_account_id===id).length,estratti:state.statements.filter(s=>s.account_id===id).length,rate:(state.payment_plans||[]).filter(p=>p.account_id===id).length,ricorrenze:state.recurring.filter(r=>r.account_id===id).length};
}
async function removeAccount(id){
 const a=accountById(id);if(!a)return;
 const refs=accountUsage(id),n=Object.values(refs).reduce((x,y)=>x+y,0);
 if(n>0){
  if(a.active===false){toast(`Il conto contiene ${n} registrazioni collegate: non può essere eliminato.`,true);return;}
  if(!confirm(`${a.label} contiene ${n} riferimenti (movimenti, rate o estratti). Archiviarlo senza cancellare lo storico?`))return;
  a.active=false;a.archived_on=today;
  try{await persistLocal();render();toast('Conto archiviato senza perdita di dati');}
  catch(err){a.active=true;delete a.archived_on;toast(err.message,true);}
  return;
 }
 if(!confirm(`Eliminare definitivamente il conto «${a.label}»? Non contiene registrazioni collegate.`))return;
 state.accounts=state.accounts.filter(x=>x.id!==id);
 try{await persistLocal();if(accountStmtFilter===id)accountStmtFilter='all';if(importSession.accountId===id)importSession.accountId=state.accounts.find(x=>x.type==='bank'&&activeAccount(x))?.id||'';render();toast('Conto eliminato');}
 catch(err){state.accounts.push(a);toast(err.message,true);}
}
async function restoreAccount(id){const a=accountById(id);if(!a)return;a.active=true;const previous=a.archived_on;delete a.archived_on;try{await persistLocal();render();toast('Conto ripristinato');}catch(err){a.active=false;a.archived_on=previous;toast(err.message,true);}}
function signedCents(raw){
 let s=String(raw??'').trim().replace(/[€\s]/g,'').replace(/[−–]/g,'-');
 if(!s)throw new Error('Importo mancante');
 let minus=s.startsWith('-')||/^\(.*\)$/.test(s)||s.endsWith('-');s=s.replace(/[()\-+]/g,'');
 const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');const sep=Math.max(comma,dot);
 if(sep>=0){const after=s.slice(sep+1);if(after.length<=2){s=s.slice(0,sep).replace(/[.,']/g,'')+'.'+after;}else{s=s.replace(/[.,']/g,'');}}
 if(!/^\d+(\.\d{1,2})?$/.test(s))throw new Error('Importo non riconosciuto: '+raw);
 const c=Math.round(Number(s)*100)*(minus?-1:1);
 if(!Number.isSafeInteger(c)||Math.abs(c)>100000000000)throw new Error('Importo troppo grande');
 return c;
}
function openStatementEditor(id=null){
 const s=id?state.statements.find(x=>x.id===id):null;
 const year=ui.year,defaultMonth=ui.month.startsWith(String(year))?ui.month:`${year}-01`;
 const start=s?.period_start||defaultMonth+'-01';const end=s?.period_end||`${defaultMonth}-${String(new Date(Number(defaultMonth.slice(0,4)),Number(defaultMonth.slice(5,7)),0).getDate()).padStart(2,'0')}`;
 const modal=document.createElement('div');modal.className='modal-backdrop';
 modal.innerHTML=`<div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="Estratto conto"><div class="modal-head"><h2>${s?'Modifica':'Registra'} estratto conto</h2><button class="icon-btn" data-close>${icon('x',18)}</button></div>
 <p class="explain">Riporta i saldi ufficiali del periodo scelto, anche se trimestrale. Il confronto con i movimenti viene calcolato automaticamente e non inventa movimenti mancanti.</p>
 <form id="statement-form">${wrapField('Conto',`<select name="account_id">${state.accounts.filter(x=>x.type==='bank'&&(activeAccount(x)||x.id===s?.account_id)).map(a=>`<option value="${esc(a.id)}" ${a.id===(s?.account_id||accountStmtFilter!=='all'&&accountStmtFilter||state.accounts.find(x=>x.type==='bank'&&activeAccount(x))?.id)?'selected':''}>${esc(accountName(a.id))}</option>`).join('')}</select>`)}
 <div class="field-row">${wrapField('Dal',formInput('period_start',start,'date','required'))}${wrapField('Al',formInput('period_end',end,'date','required'))}</div>
 <div class="field-row">${wrapField('Saldo iniziale (€)',formInput('opening_eur',s?(s.opening_cents/100).toFixed(2):'','text','inputmode="decimal" required placeholder="0,00"'))}${wrapField('Saldo finale banca (€)',formInput('closing_eur',s?(s.closing_cents/100).toFixed(2):'','text','inputmode="decimal" required placeholder="0,00"'))}</div>
 ${wrapField('Note',`<textarea name="note" rows="2" maxlength="1000">${esc(s?.note||'')}</textarea>`)}
 ${wrapField('PDF estratto conto (facoltativo)',`${styledFilePicker('statement-pdf','.pdf,application/pdf','pdf')}`,'Il PDF sarà conservato in estratti/ sul PC e incluso nel Backup completo ZIP.')}
 ${s?.document?`<div class="statement-file">${icon('receipt',16)} <a href="/api/statement-documents/${s.document.id}" target="_blank" rel="noopener">${esc(s.document.name)}</a> <button class="btn ghost sm" type="button" id="remove-stmt-doc">Rimuovi PDF</button></div>`:''}
 <div class="modal-footer"><div>${s?`<button class="btn danger sm" type="button" id="delete-stmt">Elimina estratto</button>`:''}</div><div class="right"><button class="btn ghost" type="button" data-close>Annulla</button><button class="btn primary" type="submit">Salva</button></div></div></form></div>`;
 document.body.append(modal);
 const form=$('#statement-form',modal);
 form.addEventListener('submit',async(e)=>{
  e.preventDefault();let savedId=s?.id||uniqueId(),previous=s?{...s}:null;
  const fd=new FormData(form);try{
   const ps=String(fd.get('period_start')),pe=String(fd.get('period_end'));
   if(!validDate(ps)||!validDate(pe)||ps>pe)throw new Error('Verifica le date del periodo');
   const item={id:savedId,account_id:String(fd.get('account_id')),period_start:ps,period_end:pe,opening_cents:signedCents(fd.get('opening_eur')),closing_cents:signedCents(fd.get('closing_eur')),note:String(fd.get('note')||'')};
   if(state.accounts.find(x=>x.id===item.account_id)?.type!=='bank')throw new Error('Seleziona un conto bancario');
   const overlap=state.statements.find(x=>x.id!==savedId&&x.account_id===item.account_id&&x.period_start<=pe&&x.period_end>=ps);
   if(overlap)throw new Error('Un estratto dello stesso conto copre già parte di queste date. Evita periodi sovrapposti.');
   const pdf=fd.get('pdf');if(pdf?.size>12*1024*1024)throw new Error('PDF troppo grande (max 12 MB)');
   const newRec={...previous,...item};
   if(s)Object.assign(s,newRec);else state.statements.push(newRec);
   try{
    await persistLocal();
    if(pdf&&pdf.size){const res=await fetch('/api/statements/'+encodeURIComponent(savedId)+'/document',{method:'POST',headers:{'Content-Type':'application/pdf','X-Quadra-Filename':encodeURIComponent(pdf.name)},body:pdf});const value=await res.json();if(!res.ok)throw new Error(value.error||'Errore PDF');state.statements.find(x=>x.id===savedId).document=value.document;}
    closeModal(modal);render();toast('Estratto conto registrato');
   }catch(err){if(s)Object.assign(s,previous);else state.statements=state.statements.filter(x=>x.id!==savedId);throw err;}
  }catch(err){toast(err.message,true);}
 });
 if(s){
  $('#delete-stmt',modal).addEventListener('click',async()=>{if(!confirm('Eliminare questo estratto e il suo PDF allegato?'))return;try{if(s.document)await fetch('/api/statements/'+encodeURIComponent(s.id)+'/document',{method:'DELETE'});state.statements=state.statements.filter(x=>x.id!==s.id);await persistLocal();closeModal(modal);render();toast('Estratto eliminato');}catch(err){toast(err.message,true);}});
  $('#remove-stmt-doc',modal)?.addEventListener('click',async()=>{if(!confirm('Eliminare il PDF di questo estratto?'))return;try{const res=await fetch('/api/statements/'+encodeURIComponent(s.id)+'/document',{method:'DELETE'});if(!res.ok)throw new Error('Non è stato possibile rimuovere il PDF');delete s.document;closeModal(modal);render();toast('PDF eliminato');}catch(err){toast(err.message,true);}});
 }
}
function handleAccountingClick(e){
 const mobileGoto=e.target.closest('[data-mobile-go]');if(mobileGoto){closeModal(mobileGoto.closest('.modal-backdrop'));ui.page=mobileGoto.dataset.mobileGo;ui.pageIndex=0;location.hash=ui.page;render();return true;}
 const mode=e.target.closest('[data-period-mode]');if(mode){ui.periodMode=mode.dataset.periodMode;ui.pageIndex=0;render();return true;}
 const openM=e.target.closest('[data-open-month]');if(openM){ui.month=openM.dataset.openMonth;ui.year=Number(ui.month.slice(0,4));ui.periodMode='month';ui.page='overview';location.hash='overview';render();return true;}
 const openQ=e.target.closest('[data-open-quarter]');if(openQ){ui.quarter=Number(openQ.dataset.openQuarter);ui.periodMode='quarter';ui.page='overview';location.hash='overview';render();return true;}
 const editAcct=e.target.closest('[data-account-edit]');if(editAcct){openAccountEditor(editAcct.dataset.accountEdit);return true;}
 const removeAcct=e.target.closest('[data-account-remove]');if(removeAcct){removeAccount(removeAcct.dataset.accountRemove);return true;}
 const restoreAcct=e.target.closest('[data-account-restore]');if(restoreAcct){restoreAccount(restoreAcct.dataset.accountRestore);return true;}
 const editS=e.target.closest('[data-stmt-edit]');if(editS){openStatementEditor(editS.dataset.stmtEdit);return true;}
 const act=e.target.closest('[data-action]');if(!act){const ruleDel=e.target.closest('[data-delete-rule]');if(ruleDel){if(confirm('Eliminare questa regola di importazione?')){const original=[...state.import_rules];state.import_rules=state.import_rules.filter(x=>x.id!==ruleDel.dataset.deleteRule);persistLocal().then(()=>{render();toast('Regola eliminata');}).catch(err=>{state.import_rules=original;toast(err.message,true);});}return true;}return false;}
 if(act.dataset.action==='mobile-menu'){openMobileMenu();return true;}
 if(act.dataset.action==='add-statement'){openStatementEditor();return true;}
 if(act.dataset.action==='add-account'){openAccountEditor();return true;}
 if(act.dataset.action==='parse-bank-file'){loadImportFile();return true;}
 if(act.dataset.action==='commit-bank-import'){commitImport();return true;}
 if(act.dataset.action==='import-select-new'){for(const c of importSession.candidates)c.selected=c.status==='Nuovo';render();return true;}
 if(act.dataset.action==='import-edit-rule'){openRuleModal(act.dataset.ruleId||'');return true;}
 if(act.dataset.action==='import-add-rule'){openRuleModal();return true;}
 if(act.dataset.action==='import-assign-account'){bulkAssignAccount();return true;}
 const delRule=e.target.closest('[data-delete-rule]');if(delRule){if(confirm('Eliminare questa regola di importazione?')){state.import_rules=state.import_rules.filter(x=>x.id!==delRule.dataset.deleteRule);persistLocal().then(()=>{render();toast('Regola eliminata');}).catch(err=>toast(err.message,true));}return true;}
 return false;
}
function handleAccountingChange(e){
 if(e.target.matches('[data-period-year]')){ui.year=Number(e.target.value);ui.month=`${ui.year}-${ui.month.slice(5,7)}`;ui.pageIndex=0;render();return true;}
 if(e.target.matches('[data-period-quarter]')){ui.quarter=Number(e.target.value);ui.pageIndex=0;render();return true;}
 if(e.target.matches('[data-stmt-filter]')){accountStmtFilter=e.target.value;render();return true;}
 if(e.target.matches('[data-account-filter]')){ui.accountFilter=e.target.value;ui.pageIndex=0;render();return true;}
 if(e.target.matches('#bank-file')){importSession.file=e.target.files?.[0]||null;importSession.parsed=null;importSession.candidates=[];return true;}
 if(e.target.matches('[data-import-sheet]')){importSession.sheet=e.target.value;loadImportFile(importSession.sheet);return true;}
 if(e.target.matches('[data-import-account]')){importSession.accountId=e.target.value;buildCandidates();render();return true;}
 if(e.target.matches('[data-import-map]')){const k=e.target.dataset.importMap;importSession.mapping[k]=e.target.value==='none'?-1:Number(e.target.value);buildCandidates();render();return true;}
 const row=e.target.closest('[data-import-row]');
 if(row){const c=importSession.candidates[Number(row.dataset.importRow)];if(!c)return true;const col=e.target.dataset.importCol;
   if(col==='selected')c.selected=e.target.checked;
   else if(col==='kind')c.kind=e.target.value;
   else if(col==='category')c.category=e.target.value;
   else if(col==='method')c.payment_method=e.target.value;
   const summary=$('#import-count');if(summary)summary.textContent=importSession.candidates.filter(x=>x.selected).length+' movimenti selezionati';
   return true;
 }
 return false;
}
function handleAccountingInput(e){return false;}

// ------- Guided, offline bank import: never writes without preview and explicit confirmation. -------
const normMerchant=(s)=>String(s||'').toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
function parseBankDate(raw){
 const s=accountingText(raw);
 if(!s)return '';
 if(validDate(s.slice(0,10)))return s.slice(0,10);
 if(/^\d{1,6}(\.0+)?$/.test(s)){
  const d=new Date(Date.UTC(1899,11,30)+Math.round(Number(s))*86400000);
  const iso=d.toISOString().slice(0,10);return validDate(iso)&&iso.slice(0,4)>='1990'&&iso.slice(0,4)<='2099'?iso:'';
 }
 const m=s.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})(?:\s|$)/);
 if(m){const y=Number(m[3])+(m[3].length===2?(Number(m[3])>70?1900:2000):0),iso=`${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;return validDate(iso)?iso:'';}
 return '';
}
function inferHeader(parsed){
 const rows=parsed.rows.slice(0,14);
 const dict=[['date',/^(data( contabile| operazione| valuta)?|date|posting date|operation date)$/i],['desc',/(operazione|descrizione|causale|movimento|description|esercente|dettagli)/i],['amount',/^(dare|importo|importo eur|amount|somma|valore|netto)$/i],['debit',/^(addebiti|uscite|debit|dare\/uscite)$/i],['credit',/^(accrediti|entrate|credit|avere)$/i],['notes',/^(note|annotazioni|riferimento|dettagli operazione)$/i],['category',/^categori[ae]/i]];
 let best={idx:0,score:-1};
 for(let ri=0;ri<rows.length;ri++){
  const cells=rows[ri].cells.map(x=>String(x).trim());let score=0;
  for(const [,rx] of dict)if(cells.some(c=>rx.test(c)))score++;
  if(score>best.score)best={idx:ri,score};
 }
 const header=rows[best.idx]?.cells||[];
 let mapping={header:best.idx,date:-1,desc:-1,amount:-1,debit:-1,credit:-1,notes:-1,category:-1};
 for(const [key,rx] of dict){let i=header.findIndex(x=>rx.test(String(x).trim()));if(i>=0)mapping[key]=i;}
 // If no obvious descriptions, select the second column. Dates and amounts
 // stay unresolved rather than guessing high-stakes numbers.
 if(mapping.desc<0&&header.length>1)mapping.desc=1;
 return mapping;
}
function importCell(row,index){return index<0?'':String(row?.cells?.[index]??'').trim();}
function parseSignedAmount(row,map){
 if(map.amount>=0){const v=importCell(row,map.amount);if(!v)return null;return signedCents(v);}
 const debit=importCell(row,map.debit),credit=importCell(row,map.credit);
 if(!debit&&!credit)return null;
 if(debit&&credit){const d=signedCents(debit),c=signedCents(credit);return c-Math.abs(d);}
 if(debit)return -Math.abs(signedCents(debit));
 return Math.abs(signedCents(credit));
}
function findImportCategory(text){
 const name=normMerchant(text);if(!name)return null;
 const matches=state.categories.filter(c=>normMerchant(c.name)===name);
 return matches.length===1?matches[0].id:null;
}
function categorySuggestion(merchant,rawCategory){
 const label=normMerchant(merchant);
 const matches=[...state.import_rules].filter(r=>label.includes(normMerchant(r.pattern))).sort((a,b)=>b.pattern.length-a.pattern.length);
 if(matches.length)return {category:matches[0].category||'',kind:matches[0].kind||'',from:'regola'};
 const saved=state.transactions.filter(t=>normMerchant(t.merchant)===label&&t.confidence==='verificato');
 const distinct=[...new Set(saved.map(t=>t.category).filter(Boolean))];
 if(label&&distinct.length===1&&saved.length>=1)return {category:distinct[0],kind:'',from:'storico'};
 return {category:findImportCategory(rawCategory)||'',kind:'',from:''};
}
function candidateIsDuplicate(c,earlier){
 const similar=(a,b)=>{
   if(!a||!b)return false;
   if(a===b)return true;
   if(a.length>12&&b.length>12&&(a.includes(b)||b.includes(a)))return true;
   return false;
 };
 if(c.source_key&&earlier.source_key===c.source_key)return true;
 if(c.occurred_on!==earlier.occurred_on||c.amount_cents!==earlier.amount_cents||c.owner!==earlier.owner)return false;
 // Do not treat two unrelated purchases of equal value as duplicates.
 return similar(normMerchant(c.merchant),normMerchant(earlier.merchant))&&
   ((c.account_id&&earlier.account_id===c.account_id)||!earlier.account_id||!c.account_id);
}
function buildCandidates(){
 const session=importSession,parsed=session.parsed;if(!parsed||!session.mapping)return;
 const map=session.mapping;const account=accountById(session.accountId);if(!account)return;
 const existing=[...state.transactions];const staged=[];session.invalid=0;
 const isLegacy=/^EC-/i.test(parsed.sheet);
 let referenceIndex=0;
 for(let i=map.header+1;i<parsed.rows.length;i++){
  const row=parsed.rows[i],rawDate=importCell(row,map.date),date=parseBankDate(rawDate),merchant=importCell(row,map.desc);
  let signed;
  try{signed=parseSignedAmount(row,map);}catch(err){signed=null;}
  if(!date||signed===null||signed===0||!merchant){if([rawDate,merchant,importCell(row,map.amount)].some(Boolean))session.invalid++;continue;}
  const note=importCell(row,map.notes),originalCat=importCell(row,map.category);
  const hint=categorySuggestion(merchant,originalCat);
  let kind=signed>=0?'income':'expense';
  const combined=normMerchant(merchant+' '+note);
  if(signed<0&&/prelievo (bancomat|contant|carta|sportello|atm)|prelievo bancomat|^prelievo$/.test(combined)&&!/commission|comm |canone/.test(combined))kind='withdrawal';
  if(signed<0&&/giroconto|trasferimento tra (miei|propri) conti|versamento a conto mutuo/.test(combined))kind='transfer';
  if(hint.kind)kind=hint.kind;
  const amount=Math.abs(signed);
  const payment_method=/carta|pagamento pos|bancomat|card|visa|mastercard/.test(combined)?'debit':/bonifico|giroconto/.test(combined)?'bank_transfer':'bank';
  const source_key=isLegacy?`${parsed.sheet}:${row.source_row}`:'';
  const c={id:uniqueId(),occurred_on:date,amount_cents:amount,merchant,description:note||'Importato da estratto conto',owner:account.owner,account_direction:kind==='transfer'&&signed>0?'in':'out',
     account_id:account.id,counterparty_account_id:'',payment_method,kind,category:hint.category||defaultCategory('Da classificare'),confidence:hint.from?'provvisorio':'da verificare',
     source_key,details:`Importazione ${session.file.name} · ${parsed.sheet}, riga ${row.source_row}. ${originalCat?'Categoria banca: '+originalCat+'. ':''}`,
     original_category:originalCat,source_row:row.source_row,status:'Nuovo',selected:true};
  if(existing.some(x=>candidateIsDuplicate(c,x))||staged.some(x=>candidateIsDuplicate(c,x))){c.status='Probabile doppione';c.selected=false;}
  if(kind==='transfer'||kind==='withdrawal'){c.status=c.status==='Nuovo'?'Controlla giroconto/prelievo':c.status;c.selected=false;}
  staged.push(c);
  referenceIndex++;
 }
 session.candidates=staged;
}
async function loadImportFile(sheet){
 const file=importSession.file || $('#bank-file')?.files?.[0];
 if(!file){toast('Seleziona un file Excel o CSV',true);return;}
 if(file.size>12*1024*1024){toast('Il file supera il limite di 12 MB',true);return;}
 const spinner=$('#import-feedback');if(spinner)spinner.textContent='Lettura del file in corso...';
 try{
  const res=await fetch('/api/parse-import',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Quadra-Filename':encodeURIComponent(file.name),'X-Quadra-Sheet':encodeURIComponent(sheet||'')},body:file});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'Impossibile leggere il file');
  importSession.file=file;importSession.parsed=data;importSession.sheet=data.sheet;importSession.mapping=inferHeader(data);
  buildCandidates();render();toast('File letto: controlla la mappatura e seleziona i movimenti da importare');
 }catch(err){const feedback=$('#import-feedback');if(feedback)feedback.textContent=err.message;toast(err.message,true);}
}
function mappingControls(){
 const {parsed,mapping}=importSession;
 if(!parsed)return '';
 const labels=(parsed.rows[mapping.header]?.cells||[]);
 const columns=Array.from({length:Math.min(35,Math.max(labels.length,parsed.rows.slice(0,10).reduce((n,r)=>Math.max(n,r.cells.length),0)))},(_,i)=>({i,label:(labels[i]||'Colonna '+(i+1)).slice(0,42)}));
 const selector=(field,caption)=>wrapField(caption,`<select data-import-map="${field}"><option value="none">Non presente</option>${columns.map(c=>`<option value="${c.i}" ${mapping[field]===c.i?'selected':''}>${c.i+1}. ${esc(c.label)}</option>`).join('')}</select>`);
 const header=wrapField('Riga intestazioni',`<select data-import-map="header">${parsed.rows.slice(0,15).map((r,i)=>`<option value="${i}" ${mapping.header===i?'selected':''}>Riga ${r.source_row}: ${esc(r.cells.slice(0,3).join(' · ').slice(0,68))}</option>`).join('')}</select>`);
 return `<div class="import-mapping"><h3>Associa le colonne del file</h3><p class="form-hint">Per importi con segno usa “Importo unico”; se il file ha due colonne separate usa “Uscite” e “Entrate”.</p><div class="mapping-grid">${header}${selector('date','Data *')}${selector('desc','Descrizione *')}${selector('amount','Importo unico')}${selector('debit','Uscite')}${selector('credit','Entrate')}${selector('notes','Note')}${selector('category','Categoria originale')}</div></div>`;
}
function renderImportPage(){if(!state.accounts.some(a=>a.id===importSession.accountId&&activeAccount(a)&&a.type==='bank'))importSession.accountId=state.accounts.find(a=>a.type==='bank'&&activeAccount(a))?.id||'';
 const session=importSession,parsed=session.parsed,rows=session.candidates;
 const duplicate=rows.filter(x=>x.status==='Probabile doppione').length;
 const caution=rows.filter(x=>x.status==='Controlla giroconto/prelievo').length;
 const selected=rows.filter(x=>x.selected).length;
 return `${pageHead('Importa movimenti Excel / CSV','Carica estratti bancari senza duplicare il registro. Anteprima obbligatoria, nessuna importazione automatica.')}
 <article class="card"><div class="card-top"><div><h2>1. Scegli un file e un conto</h2><p class="subheading">Supporta .xlsx e .csv; lettura completamente offline con Python standard.</p></div>${icon('upload',20)}</div>
 <div class="import-first"><div class="field"> <label>File bancario</label>${styledFilePicker('bank-file','.xlsx,.csv,.txt')}<p class="form-hint">Massimo 12 MB. Per file con fogli mensili, scegli il foglio da importare.</p></div>
 <div class="field"><label>Conto al quale appartengono questi movimenti</label><select data-import-account>${state.accounts.filter(x=>x.type==='bank'&&activeAccount(x)).map(a=>`<option value="${esc(a.id)}" ${session.accountId===a.id?'selected':''}>${esc(accountName(a.id))}</option>`).join('')}</select><p class="form-hint">Scegli il conto corretto: la carta di debito è già collegata al conto personale.</p></div></div>
 <div class="import-actions"><button class="btn primary" data-action="parse-bank-file">${icon('upload',15)} Leggi e prepara anteprima</button><span class="form-hint" id="import-feedback">Il file viene letto soltanto da Quadra sul tuo PC.</span></div>
 ${parsed?`<div class="import-sheet-bar"><div class="field"><label>Foglio</label><select data-import-sheet>${parsed.sheets.map(name=>`<option value="${esc(name)}" ${name===parsed.sheet?'selected':''}>${esc(name)}</option>`).join('')}</select></div><span class="badge ${parsed.truncated?'warn':'soft'}">${parsed.rows.length} righe lette${parsed.truncated?' · limite raggiunto':''}</span></div>${mappingControls()}`:''}</article>
 ${parsed?`<article class="card section-spacer"><div class="card-top"><div><h2>2. Rivedi e seleziona</h2><p class="subheading">I sospetti duplicati e i possibili giroconti non vengono importati automaticamente: li puoi selezionare dopo averli controllati.</p></div><span class="badge soft">${rows.length} movimenti validi</span></div>
 ${session.invalid?`<p class="account-caution">${session.invalid} righe non convertite: date, importi o descrizioni assenti / non validi. I totali potrebbero essere parziali.</p>`:''}
 <div class="import-stats"><div><strong>${rows.length}</strong><small>Candidati</small></div><div><strong>${duplicate}</strong><small>Possibili doppioni</small></div><div><strong>${caution}</strong><small>Da controllare</small></div><div><strong id="import-count">${selected} movimenti selezionati</strong><small>Pronti per l’importazione</small></div></div>
 ${rows.length?`<div class="table-wrap import-table"><table class="data-table"><thead><tr><th>Usa</th><th>Data</th><th>Descrizione</th><th>Importo</th><th>Tipo</th><th>Categoria</th><th>Stato</th></tr></thead><tbody>${rows.map((c,i)=>`<tr data-import-row="${i}" class="${c.status!=='Nuovo'?'row-warn':''}"><td><input type="checkbox" data-import-col="selected" ${c.selected?'checked':''} aria-label="Importa movimento ${i+1}"></td><td>${formatDate(c.occurred_on)}</td><td><strong>${esc(c.merchant)}</strong><div class="td-note">${esc((c.description||'').slice(0,75))}</div></td><td class="money ${c.kind==='income'?'positive':'negative'}">${c.kind==='income'?'+':'−'}${fmt(c.amount_cents)}</td><td><select data-import-col="kind" aria-label="Tipo movimento">${KINDS.map(k=>`<option value="${k.id}" ${c.kind===k.id?'selected':''}>${k.label}</option>`).join('')}</select></td><td><select data-import-col="category" aria-label="Categoria movimento">${categoryOptions(c.category)}</select></td><td><span class="badge ${c.status==='Nuovo'?'soft':'warn'}">${esc(c.status)}</span></td></tr>`).join('')}</tbody></table></div>
 <div class="import-actions"><button class="btn ghost" data-action="import-select-new">Seleziona solo nuovi</button><button class="btn primary" data-action="commit-bank-import" ${selected?'':'disabled'}>${icon('check',15)} Importa selezionati</button></div>`:'<div class="empty">Nessun movimento valido con la mappatura attuale. Verifica le colonne o seleziona un altro foglio.</div>'}
 <div class="info-strip">${icon('info',16)}<span>Prima di ogni importazione Quadra salva un backup completo ZIP in <code>backup/</code>. Gli estratti non sono un saldo: dopo l’importazione registra saldo iniziale e finale nella sezione Conti e saldi.</span></div></article>`:''}
 <article class="card section-spacer"><div class="card-top"><div><h2>Regole di classificazione</h2><p class="subheading">Associano un nome ricorrente a una categoria e a un tipo di movimento, senza servizi online.</p></div><button class="btn primary sm" data-action="import-add-rule">${icon('plus',15)} Nuova regola</button></div>
 <div class="rule-list">${state.import_rules.map(r=>`<div class="rule-row"><div><strong>«${esc(r.pattern)}»</strong><small>${esc(categoryLabel(r.category,true))}${r.kind?' · '+esc(kindLabel(r.kind)):''}</small></div><div class="right-actions"><button class="btn ghost sm" data-action="import-edit-rule" data-rule-id="${esc(r.id)}">Modifica</button><button class="tiny-btn" data-delete-rule="${esc(r.id)}" title="Elimina">${icon('trash',15)}</button></div></div>`).join('')||'<div class="empty">Nessuna regola personale. Quadra può anche proporre categorie già verificate per esercenti identici nello storico.</div>'}</div></article>
 <article class="card section-spacer"><div class="card-top"><div><h2>Contabilità dello storico</h2><p class="subheading">I movimenti precedenti alla versione 1.3 non hanno sempre un conto attribuito.</p></div></div>
 <p class="explain">Per evitare saldi inventati non li ho assegnati automaticamente. Dopo una verifica puoi attribuire in blocco i movimenti ancora senza conto al conto personale del rispettivo intestatario. <strong>Non farlo se una parte proviene da conti mutuo o contante.</strong></p>
 <button class="btn ghost" data-action="import-assign-account">${icon('alert-circle',15)} Assegna conti ai vecchi movimenti (con conferma)</button></article>`;
}
async function commitImport(){
 const entries=importSession.candidates.filter(x=>x.selected);
 if(!entries.length){toast('Nessun movimento selezionato',true);return;}
 const nowExisting=state.transactions;
 const final=entries.filter(x=>!nowExisting.some(t=>candidateIsDuplicate(x,t)));
 const skipped=entries.length-final.length;
 const caution=final.filter(x=>x.kind==='transfer'||x.kind==='withdrawal').length;
 if(!final.length){toast('Tutti i movimenti selezionati risultano già presenti',true);return;}
 if(!confirm(`Importare ${final.length} movimenti sul conto ${accountName(importSession.accountId)}?\n${skipped} duplicati esatti o probabili saranno esclusi.\n${caution} giroconti/prelievi richiedono il controllo della destinazione.\nPrima dell'importazione verrà creato un backup completo sul PC.`))return;
 const btn=$('[data-action="commit-bank-import"]');if(btn)btn.disabled=true;
 try{
  await fetchJSON('/api/pre-import-backup',{method:'POST'});
  const newItems=final.map(({status,selected,original_category,source_row,...t})=>{
    const result={...t};if(!result.source_key)delete result.source_key;
    if(['transfer','withdrawal'].includes(result.kind)){result.counterparty_account_id='';result.confidence='da verificare';}
    return result;
  });
  state.transactions=[...nowExisting,...newItems];
  try{await persistLocal();}catch(err){state.transactions=nowExisting;throw err;}
  ui.year=Number(newItems.at(-1).occurred_on.slice(0,4));ui.month=newItems.at(-1).occurred_on.slice(0,7);ui.periodMode='month';
  importSession.candidates=[];importSession.parsed=null;importSession.file=null;
  render();toast(`${newItems.length} movimenti importati. Backup preventivo creato in backup/.`);
 }catch(err){toast('Importazione non riuscita: '+err.message,true);if(btn)btn.disabled=false;}
}
function openRuleModal(id=''){
 const r=state.import_rules.find(x=>x.id===id)||{pattern:'',category:defaultCategory('Da classificare'),kind:''};
 const modal=document.createElement('div');modal.className='modal-backdrop';
 modal.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="Regola di importazione"><div class="modal-head"><h2>${id?'Modifica':'Nuova'} regola</h2><button class="icon-btn" data-close>${icon('x',18)}</button></div>
 <p class="explain">Quando il nome del movimento contiene la frase indicata, Quadra proporrà questa categoria. Le regole non modificano lo storico senza la tua conferma.</p>
 <form id="rule-form">${wrapField('Testo da riconoscere',formInput('pattern',r.pattern,'text','minlength="2" maxlength="120" required placeholder="Es. SUPERMERCATO"'))}
 ${wrapField('Categoria',`<select name="category">${categoryOptions(r.category)}</select>`)}
 ${wrapField('Tipo suggerito',`<select name="kind"><option value="">Deduci dal segno dell’importo</option>${KINDS.map(k=>`<option value="${k.id}" ${r.kind===k.id?'selected':''}>${k.label}</option>`).join('')}</select>`)}
 <div class="modal-footer"><button class="btn ghost" type="button" data-close>Annulla</button><button class="btn primary" type="submit">Salva regola</button></div></form></div>`;
 document.body.append(modal);
 $('#rule-form',modal).addEventListener('submit',async(e)=>{
  e.preventDefault();const data=new FormData(e.currentTarget);
  const item={id:id||uniqueId(),pattern:String(data.get('pattern')).trim(),category:String(data.get('category')),kind:String(data.get('kind')||'')};
  if(item.pattern.length<2){toast('Inserisci almeno 2 caratteri',true);return;}
  const prev=[...state.import_rules];
  if(id)state.import_rules=state.import_rules.map(x=>x.id===id?item:x);else state.import_rules.push(item);
  try{await persistLocal();closeModal(modal);if(importSession.parsed)buildCandidates();render();toast('Regola salvata');}
  catch(err){state.import_rules=prev;toast(err.message,true);}
 });
}
async function bulkAssignAccount(){
 const old=state.transactions.filter(t=>!t.account_id&&familyMembers(true).some(m=>m.name===t.owner));
 if(!old.length){toast('Nessun movimento da attribuire');return;}
 const question=`ATTENZIONE: ${old.length} movimenti storici non hanno un conto certo.\n\nLa funzione assegna ogni movimento al CONTO PERSONALE di chi l’ha pagato, anche se potrebbe in realtà provenire dal conto mutuo o dal contante.\n\nConfermi di aver verificato che tutti questi movimenti provengano effettivamente dai rispettivi conti personali?`;
 if(!confirm(question))return;
 const previous=old.map(t=>t.account_id);
 for(const t of old)t.account_id=defaultAccount(t.owner,t.kind);
 try{await fetchJSON('/api/pre-import-backup',{method:'POST'});await persistLocal();render();toast(`${old.length} movimenti attribuiti ai conti personali. Ricontrolla i saldi degli estratti.`);}
 catch(err){old.forEach((t,i)=>t.account_id=previous[i]);toast(err.message,true);}
}

function openMobileMenu(){
 const modal=document.createElement('div');modal.className='modal-backdrop';
 modal.innerHTML=`<div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="Menu completo"><div class="modal-head"><h2>Tutte le sezioni</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('x',18)}</button></div><p class="explain">Seleziona dove vuoi andare in Quadra.</p><div class="mobile-menu-grid">${PAGES.map(x=>`<button data-mobile-go="${x.id}" class="mobile-menu-choice ${ui.page===x.id?'selected':''}">${icon(x.icon,18)}<span>${x.label}</span>${icon('chevron-right',15)}</button>`).join('')}</div></div>`;
 document.body.append(modal);
}
