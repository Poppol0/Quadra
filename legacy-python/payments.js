'use strict';
// Quadra Offline 1.5 - piani di pagamento e conferme manuali.
// Le scadenze sono proiezioni in memoria: NON sono registrazioni contabili.
function paymentDateShift(date,months){
  const [y,m,d]=date.split('-').map(Number);
  const first=new Date(Date.UTC(y,m-1+months,1));
  const yy=first.getUTCFullYear(),mm=first.getUTCMonth()+1;
  return isoDay(yy,mm,Math.min(d,monthLastDay(yy,mm)));
}
function paymentIsActive(x){return x.active!==0&&x.active!==false;}
function planDates(p){
  if(!p||!/^\d{4}-\d{2}-\d{2}$/.test(p.first_due_on||''))return [];
  const n=Math.min(240,Math.max(0,Number(p.installment_count)||0));
  const interval=Math.min(12,Math.max(1,Number(p.interval_months)||1));
  return Array.from({length:n},(_,i)=>({date:paymentDateShift(p.first_due_on,i*interval),number:i+1}));
}
function paymentSlots(from,to){
  const res=[];
  for(const p of (state.payment_plans||[])){
    if(!paymentIsActive(p))continue;
    for(const d of planDates(p)){
      if(d.number<=Number(p.paid_before||0)||d.date<from||d.date>to)continue;
      res.push({kind:'payment_plan',id:p.id,slot:String(d.number),date:d.date,number:d.number,total:Number(p.installment_count),title:p.title,owner:p.owner,category:p.category,amount_cents:p.amount_cents,account_id:p.account_id||'',note:p.note||''});
    }
  }
  for(const r of state.recurring){
    if(!paymentIsActive(r)||!r.track_payments||!calendarDateKnown(r))continue;
    const start=r.track_from||r.start_on||today;
    for(const date of getCalendarOccurrences(r,from,to)){
      if(date<start)continue;
      const slot=r.frequency==='yearly'?date.slice(0,4):date.slice(0,7);
      res.push({kind:'recurring',id:r.id,slot,date,title:r.title,owner:r.owner,category:r.category,amount_cents:r.amount_cents,account_id:r.account_id||'',note:r.note||''});
    }
  }
  return res.sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));
}
function paymentLinkedTx(slot){return state.transactions.find(t=>t.payment_ref_kind===slot.kind&&t.payment_ref_id===slot.id&&String(t.payment_slot)===String(slot.slot));}
function pendingPaymentSlots(from,to){return paymentSlots(from,to).filter(s=>!paymentLinkedTx(s));}
function paymentPlanStatus(p){
  const all=planDates(p);let linked=0;
  for(const d of all){if(d.number>Number(p.paid_before||0)&&paymentLinkedTx({kind:'payment_plan',id:p.id,slot:String(d.number)}))linked++;}
  const settled=Math.min(all.length,Number(p.paid_before||0)+linked);
  const pending=all.filter(d=>d.number>Number(p.paid_before||0)&&!paymentLinkedTx({kind:'payment_plan',id:p.id,slot:String(d.number)}));
  return {settled,total:all.length,pending,next:pending[0]||null};
}
function paymentWindow(){const from=paymentDateShift(today,-2),to=paymentDateShift(today,5);return {from,to};}
function isSubscription(r){
  if(r.is_subscription)return true;
  const lbl=(categoryLabel(r.category,true)||'')+' '+r.title;
  return /abbonament|now tv|netflix|icloud|iliad|tim |amazon|prime|spotify|disney|atac|youtube|apple music/i.test(lbl);
}
function paymentUpcoming(limit=8){
  const {from,to}=paymentWindow();
  const planUpcoming=pendingPaymentSlots(from,to).filter(s=>s.date>=today);
  return planUpcoming.slice(0,limit);
}
function renderPaymentManagement(){
  const plans=(state.payment_plans||[]).filter(p=>ui.owner==='Famiglia'||p.owner===ui.owner);
  const subs=state.recurring.filter(r=>isSubscription(r)&&(ui.owner==='Famiglia'||r.owner===ui.owner));
  const financed=state.recurring.filter(r=>!isSubscription(r)&&/mutuo|prestito|finanziament|cofidis|agos|ikea|leasing|rata/i.test(r.title)&&paymentIsActive(r)&&(!r.end_on||r.end_on>=today)&&(ui.owner==='Famiglia'||r.owner===ui.owner));
  const {from,to}=paymentWindow(),pending=pendingPaymentSlots(from,to).filter(s=>ui.owner==='Famiglia'||s.owner===ui.owner);
  const in30=paymentDateShift(today,1),dueSoon=pending.filter(s=>s.date>=today&&s.date<=in30),dueOverdue=pending.filter(s=>s.date<today);
  const outstanding=plans.reduce((n,p)=>n+paymentPlanStatus(p).pending.length*p.amount_cents,0);
  return `${pageHead('Gestione rate','Abbonamenti, acquisti dilazionati e scadenze da verificare.',`<button class="btn ghost" data-action="export-calendar">${icon('calendar',15)} Calendario .ics</button>`)}${selectOwner()}
  <div class="grid kpis">
    ${kpi('Da pagare entro 30 giorni',fmt(dueSoon.reduce((n,s)=>n+s.amount_cents,0)),'Solo impegni monitorati','calendar-check','accent')}
    ${kpi('Rate ancora aperte',fmt(outstanding),'Totale piani a rate, non saldo bancario','wallet')}
    ${kpi('Piani a rate',String(plans.filter(paymentIsActive).length),'PayPal, acquisti a rate e altri piani','layers')}
    ${kpi('Da verificare',String(dueOverdue.length),'Scadenze passate negli ultimi due mesi','alert-circle',dueOverdue.length?'negative':'')}
  </div>
  <div class="info-strip">${icon('info',16)}<span><strong>Importi previsti, non spese registrate.</strong> Le scadenze compaiono anche in Movimenti con lo stato «Da confermare», ma non modificano i saldi. Per confermarle puoi creare un nuovo movimento o collegare un pagamento bancario già presente. Gli esempi PayPal mostrati in chat non sono stati importati.</span></div>
  <article class="card"><div class="card-top"><div><h2>Piani di pagamento</h2><p class="subheading">Rate con un numero e una data di conclusione definiti</p></div><button class="btn primary sm" data-action="add-payment-plan">${icon('plus',15)} Nuovo piano</button></div>
    <div class="pay-plan-grid">${plans.map(p=>renderPaymentPlanCard(p)).join('')||'<div class="empty">Non hai ancora inserito piani di pagamento. Aggiungi PayPal Paga in 3 o altri acquisti dilazionati, indicando la data della prima rata.</div>'}</div>
  </article>
  <article class="card section-spacer"><div class="card-top"><div><h2>Abbonamenti e addebiti continuativi</h2><p class="subheading">Riprende le voci già presenti in Ricorrenze, senza duplicarle</p></div><button class="btn primary sm" data-action="add-subscription">${icon('plus',15)} Nuovo abbonamento</button></div>
  <div class="subscription-list">${subs.map(r=>`<div class="subscription-row"><span class="sub-icon">${icon('calendar-check',18)}</span><div class="sub-main"><strong>${esc(r.title)}</strong><div class="sub-meta">${esc(r.owner)} · ${r.frequency==='yearly'?'annuale':'mensile'} · giorno ${Number(r.due_day)||'?'}${r.end_on?' · fino al '+formatDate(r.end_on):''}</div></div><strong class="sub-price">${fmt(r.amount_cents)}</strong><label class="pay-track"><input type="checkbox" data-track-rec="${esc(r.id)}" ${r.track_payments?'checked':''} title="Mostra i pagamenti da confermare"> <span>Monitora</span></label><button class="tiny-btn" data-edit-rec="${esc(r.id)}" aria-label="Modifica">${icon('edit',16)}</button></div>`).join('')||'<div class="empty">Aggiungi un abbonamento oppure recuperalo dalla sezione Ricorrenze.</div>'}</div>
  <p class="form-hint">Attiva «Monitora» per far apparire le prossime scadenze anche in Movimenti. Se lo abiliti su una voce già esistente, il controllo parte da oggi e non genera pagamenti arretrati.</p><div class="card-foot"><button class="btn ghost sm" data-nav="recurring">Apri tutte le ricorrenze ${icon('chevron-right',14)}</button></div></article>
  ${financed.length?`<article class="card section-spacer"><div class="card-top"><div><h2>Finanziamenti già registrati</h2><p class="subheading">Mutui e rate mensili ripresi da Ricorrenze, senza duplicazioni</p></div><button class="btn ghost sm" data-nav="recurring">Tutte le ricorrenze</button></div><div class="subscription-list">${financed.map(r=>`<div class="subscription-row"><span class="sub-icon">${icon('wallet',18)}</span><div class="sub-main"><strong>${esc(r.title)}</strong><div class="sub-meta">${esc(r.owner)} · ${calendarDateKnown(r)?'giorno '+r.due_day:'data da verificare'}${r.end_on?' · fino al '+formatDate(r.end_on):''}</div></div><strong class="sub-price">${fmt(r.amount_cents)}</strong><label class="pay-track"><input type="checkbox" data-track-rec="${esc(r.id)}" ${r.track_payments?'checked':''} ${calendarDateKnown(r)?'':'disabled'} title="Mostra le rate da confermare"> <span>Monitora</span></label><button class="tiny-btn" data-edit-rec="${esc(r.id)}" aria-label="Modifica">${icon('edit',16)}</button></div>`).join('')}</div><p class="form-hint">Queste rate sono già considerate nelle ricorrenze. Attiva il monitoraggio soltanto se desideri confermarne gli addebiti uno per uno; non creare un secondo piano per lo stesso finanziamento.</p></article>`:''}
  <article class="card section-spacer"><div class="card-top"><div><h2>Prossime scadenze</h2><p class="subheading">Da oggi ai prossimi cinque mesi, comprese eventuali rate non confermate</p></div><button class="btn ghost sm" data-nav="movements">Apri Movimenti</button></div>
  ${renderPaymentSlotList(pending.filter(s=>s.date>=today).slice(0,40),'Nessuna scadenza programmata nel periodo.')}
  ${dueOverdue.length?`<div class="overdue-title">Da verificare · scadenze già trascorse</div>${renderPaymentSlotList(dueOverdue.slice(-15),'')}`:''}</article>`;
}
function renderPaymentPlanCard(p){
  const st=paymentPlanStatus(p),pct=st.total?Math.round(st.settled/st.total*100):0;
  return `<div class="pay-plan-card"><div class="pay-plan-top"><div><span class="badge ${paymentIsActive(p)?'soft':'warn'}">${paymentIsActive(p)?'Piano attivo':'In pausa'}</span><h3>${esc(p.title)}</h3></div><button class="tiny-btn" data-edit-plan="${esc(p.id)}" title="Modifica il piano">${icon('edit',16)}</button></div>
    <div class="pay-plan-row"><span class="pay-ring" style="--progress:${pct}%"><span>${st.settled}<small>/${st.total}</small></span></span><div class="pay-plan-sum"><strong>${fmt(p.amount_cents)}</strong><span>per rata · ${esc(p.owner)}</span><small>${st.next?'Prossima '+formatDate(st.next.date):'Tutte le rate completate'}</small></div></div>
    <div class="progress"><i style="width:${pct}%"></i></div><div class="pay-plan-foot"><span>${fmt(st.pending.length*p.amount_cents)} ancora da registrare</span>${st.next?`<button class="btn primary sm" data-confirm-slot="payment_plan|${esc(p.id)}|${st.next.number}">Conferma rata</button>`:'<span class="badge soft">Completato</span>'}</div></div>`;
}
function renderPaymentSlotList(slots,emptyMessage){
  if(!slots.length)return `<div class="empty">${esc(emptyMessage)}</div>`;
  return `<div class="payment-slot-list">${slots.map(s=>`<div class="payment-slot"><span class="payment-slot-date">${formatDate(s.date)}</span><div class="payment-slot-main"><strong>${esc(s.title)}</strong><span>${esc(s.owner)}${s.number?` · rata ${s.number} di ${s.total}`:''} · ${esc(categoryLabel(s.category))}</span></div><strong>${fmt(s.amount_cents)}</strong><button class="btn ghost sm" data-confirm-slot="${s.kind}|${esc(s.id)}|${esc(s.slot)}">Conferma</button></div>`).join('')}</div>`;
}
function renderPaymentPlaceholders(){
  if(ui.kind!=='all'&&ui.kind!=='expense'||ui.attachmentsOnly)return '';
  const {start,end}=selectedPeriod();
  let pending=pendingPaymentSlots(start,end).filter(s=>(ui.owner==='Famiglia'||s.owner===ui.owner)&&(ui.category==='Tutte'||ui.category===s.category)&&(ui.accountFilter==='all'||(ui.accountFilter==='unassigned'?!s.account_id:ui.accountFilter===s.account_id)));
  const q=ui.filter.trim().toLowerCase();if(q)pending=pending.filter(s=>[s.title,s.owner,categoryLabel(s.category,true)].join(' ').toLowerCase().includes(q));
  if(!pending.length)return '';
  const limit=25;
  return `<div class="pending-box"><div class="pending-heading"><div><h3>${icon('clock',18)} Movimenti previsti <span class="badge warn">${pending.length} da confermare</span></h3><p>Non sono spese contabilizzate. Conferma l'addebito o collegalo a un movimento già importato.</p></div><button class="btn ghost sm" data-nav="recurring">Scadenze e rate</button></div>
  <div class="pending-rows">${pending.slice(0,limit).map(s=>`<div class="pending-row"><div class="pending-row-date">${formatDate(s.date)}</div><div class="pending-row-body"><strong>${esc(s.title)}</strong><span>${esc(s.owner)}${s.number?' · rata '+s.number+'/'+s.total:''} · Da confermare</span></div><strong>${fmt(s.amount_cents)}</strong><button class="btn primary sm" data-confirm-slot="${s.kind}|${esc(s.id)}|${esc(s.slot)}">Conferma</button></div>`).join('')}</div>${pending.length>limit?`<div class="card-foot">Altre ${pending.length-limit} scadenze. Apri Scadenze e rate per consultarle.</div>`:''}</div>`;
}
function openInstallmentModal(id=null){
  const p=(state.payment_plans||[]).find(x=>x.id===id)||{id:'',title:'',owner:familyMembers()[0]?.name||'Famiglia',category:defaultCategory('Finanziamento'),amount_cents:0,installment_count:3,paid_before:0,first_due_on:today,interval_months:1,account_id:'',note:'',active:1};
  const editing=Boolean(id);
  const opts=(state.accounts||[]).filter(a=>a.type==='bank'&&(a.active!==false||a.id===p.account_id));
  const body=`${wrapField('Nome dell’acquisto / esercente',formInput('title',p.title,'text','required maxlength="120" placeholder="Esempio: acquisto PayPal"'))}
  <div class="field-row">${wrapField('Importo di ogni rata (€)',moneyInput('amount_eur',num(p.amount_cents)))}${wrapField('Numero totale rate',formInput('installment_count',p.installment_count,'number','required min="2" max="240"'))}</div>
  <div class="field-row">${wrapField('Prima scadenza',formInput('first_due_on',p.first_due_on,'date','required'))}${wrapField('Cadenza',`<select name="interval_months">${[[1,'Ogni mese'],[2,'Ogni 2 mesi'],[3,'Ogni 3 mesi'],[6,'Ogni 6 mesi'],[12,'Ogni anno']].map(([v,l])=>`<option value="${v}" ${Number(p.interval_months)===v?'selected':''}>${l}</option>`).join('')}</select>`)}</div>
  <div class="field-row">${wrapField('Pagato da',formSelect('owner',ownerOptions(p.owner,false),p.owner))}${wrapField('Categoria',`<select name="category">${categoryOptions(p.category)}</select>`)}</div>
  <div class="field-row">${wrapField('Rate già pagate (prima del monitoraggio)',formInput('paid_before',p.paid_before,'number','required min="0" max="240"'),'Per rate già saldate altrove: non verranno create nuove spese. Gli addebiti storici restano nel registro.')}${wrapField('Conto di addebito',`<select name="account_id"><option value="">Da assegnare alla conferma</option>${opts.map(a=>`<option value="${esc(a.id)}" ${a.id===p.account_id?'selected':''}>${esc(a.owner)} · ${esc(a.label)}</option>`).join('')}</select>`)}</div>
  ${wrapField('Note (facoltative)',`<textarea name="note" maxlength="1000" rows="3">${esc(p.note||'')}</textarea>`)}
  ${wrapField('Stato',`<select name="active"><option value="1" ${paymentIsActive(p)?'selected':''}>Attivo</option><option value="0" ${!paymentIsActive(p)?'selected':''}>In pausa</option></select>`)}
  <div class="info-strip">${icon('info',15)}<span>Il piano genera soltanto scadenze previste. Ogni rata diventa una spesa reale dopo la conferma. Gli addebiti già presenti in Movimenti possono essere collegati senza duplicarli.</span></div>`;
  const modal=document.createElement('div');modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal modal-wide" role="dialog" aria-modal="true"><div class="modal-head"><h2>${editing?'Modifica piano a rate':'Nuovo piano a rate'}</h2><button class="icon-btn" type="button" data-close>${icon('x',18)}</button></div><form id="payment-plan-form">${body}<div class="modal-footer"><div>${editing?`<button type="button" class="btn danger sm" id="delete-payment-plan">${icon('trash',14)} Elimina</button>`:''}</div><div class="right"><button class="btn ghost" type="button" data-close>Annulla</button><button class="btn primary" type="submit">Salva piano</button></div></div></form></div>`;
  document.body.append(modal);
  $('#payment-plan-form',modal).addEventListener('submit',async e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget);
    const a=String(fd.get('amount_eur')).replace(/\s/g,'').replace(',','.');const cents=Math.round(Number(a)*100);
    const count=Number(fd.get('installment_count')),paid=Number(fd.get('paid_before')),due=String(fd.get('first_due_on'));
    if(!Number.isSafeInteger(cents)||cents<1||cents>1000000000){toast('Importo della rata non valido',true);return;}
    if(!Number.isInteger(count)||count<2||count>240||!Number.isInteger(paid)||paid<0||paid>count||!/^\d{4}-\d{2}-\d{2}$/.test(due)){toast('Controlla rate, rate già pagate e prima scadenza',true);return;}
    const plan={title:String(fd.get('title')).trim(),amount_cents:cents,installment_count:count,paid_before:paid,first_due_on:due,interval_months:Number(fd.get('interval_months')),owner:String(fd.get('owner')),category:String(fd.get('category')),account_id:String(fd.get('account_id')||''),note:String(fd.get('note')||''),active:Number(fd.get('active'))};
    if(!plan.title){toast('Inserisci un nome per il piano',true);return;}
    const dup=(state.payment_plans||[]).find(x=>x.id!==id&&x.title.toLowerCase()===plan.title.toLowerCase()&&x.owner===plan.owner&&x.first_due_on===plan.first_due_on&&x.amount_cents===plan.amount_cents);
    if(dup){toast('Questo piano risulta già presente: modificalo invece di crearne una copia',true);return;}
    try{await saveRecord('payment_plans',plan,id);closeModal(modal);render();toast('Piano salvato. Le scadenze sono disponibili in Movimenti e Calendar.');}catch(err){toast('Piano: '+err.message,true);}
  });
  if(editing)$('#delete-payment-plan',modal).addEventListener('click',async()=>{
    if(!confirm('Eliminare il piano? I movimenti effettivi già confermati rimarranno nel registro.'))return;
    try{await deleteRecord('payment_plans',id);closeModal(modal);render();toast('Piano eliminato. Movimenti effettivi conservati.');}catch(err){toast(err.message,true);}
  });
}
function openSubscriptionModal(){
  const p={title:'',owner:familyMembers()[0]?.name||'Famiglia',category:defaultCategory('Abbonamenti'),amount_cents:0,frequency:'monthly',due_day:Number(today.slice(8)),start_on:today,active:1,track_payments:1};
  const modal=document.createElement('div');modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>Nuovo abbonamento</h2><button class="icon-btn" type="button" data-close>${icon('x',18)}</button></div><form id="new-sub-form">${wrapField('Nome abbonamento',formInput('title','','text','required maxlength="120" placeholder="NOW, Iliad, Amazon Prime..."'))}
   <div class="field-row">${wrapField('Importo (€)',moneyInput('amount_eur',0))}${wrapField('Periodicità',`<select name="frequency"><option value="monthly">Mensile</option><option value="yearly">Annuale</option></select>`)}</div>
   <div class="field-row">${wrapField('Prima scadenza prevista',formInput('start_on',today,'date','required'))}${wrapField('Riferito a',formSelect('owner',ownerOptions(familyMembers()[0]?.name,false),familyMembers()[0]?.name||'Famiglia'))}</div>
   ${wrapField('Categoria',`<select name="category">${categoryOptions(defaultCategory('Abbonamenti'))}</select>`)}${wrapField('Note (facoltative)',`<textarea name="note" rows="2" maxlength="300"></textarea>`)}
   <p class="form-hint">L'abbonamento viene salvato anche in Ricorrenze, una sola volta. Le scadenze dalla prima data in poi appariranno in Movimenti da confermare.</p>
   <div class="modal-footer"><span></span><div class="right"><button class="btn ghost" type="button" data-close>Annulla</button><button class="btn primary" type="submit">Salva abbonamento</button></div></div></form></div>`;
  document.body.append(modal);
  $('#new-sub-form',modal).addEventListener('submit',async e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget);const start=String(fd.get('start_on'));
    const cents=Math.round(Number(String(fd.get('amount_eur')).replace(',','.'))*100);
    if(!Number.isSafeInteger(cents)||cents<1||!/^\d{4}-\d{2}-\d{2}$/.test(start)){toast('Controlla l’importo e la data della prima scadenza',true);return;}
    const sub={title:String(fd.get('title')).trim(),owner:String(fd.get('owner')),category:String(fd.get('category')),amount_cents:cents,frequency:String(fd.get('frequency')),start_on:start,due_day:Number(start.slice(8)),end_on:null,confidence:'verificato',active:1,note:String(fd.get('note')||''),is_subscription:1,schedule_type:'subscription',track_payments:1,track_from:start};
    const duplicate=state.recurring.find(r=>r.owner===sub.owner&&r.title.trim().toLowerCase()===sub.title.toLowerCase());
    if(duplicate){toast('Esiste già una ricorrenza con questo nome. Modificala o attiva «Monitora», invece di duplicarla.',true);return;}
    try{await saveRecord('recurring',sub);closeModal(modal);render();toast('Abbonamento salvato in Scadenze e rate.');}catch(err){toast(err.message,true);}
  });
}
function openPaymentConfirmation(raw){
  const [kind,id,slotKey]=raw.split('|');
  let s;
  if(kind==='payment_plan'){
    const p=(state.payment_plans||[]).find(x=>x.id===id);
    const due=p?planDates(p).find(d=>String(d.number)===slotKey):null;
    if(p&&due)s={kind:'payment_plan',id:p.id,slot:String(due.number),date:due.date,number:due.number,total:Number(p.installment_count),title:p.title,owner:p.owner,category:p.category,amount_cents:p.amount_cents,account_id:p.account_id||'',note:p.note||''};
  }else if(kind==='recurring'&&/^\d{4}(-\d{2})?$/.test(slotKey)){
    const from=slotKey.length===4?slotKey+'-01-01':slotKey+'-01';
    const to=slotKey.length===4?slotKey+'-12-31':slotKey+'-31';
    s=paymentSlots(from,to).find(x=>x.kind===kind&&x.id===id&&String(x.slot)===slotKey);
  }
  if(!s){toast('Scadenza non disponibile. Aggiorna la pagina.',true);return;}
  if(paymentLinkedTx(s)){toast('La rata risulta già confermata',true);render();return;}
  const matched=state.transactions.filter(t=>t.kind==='expense'&&!t.payment_ref_id&&(t.owner===s.owner||s.owner==='Famiglia')&&Math.abs(t.amount_cents-s.amount_cents)<=100&&Math.abs(Date.parse(t.occurred_on+'T12:00:00Z')-Date.parse(s.date+'T12:00:00Z'))<=20*86400000).slice(0,15);
  const accounts=(state.accounts||[]).filter(a=>a.type==='bank'&&(a.owner===s.owner||s.owner==='Famiglia')&&(a.active!==false));
  const modal=document.createElement('div');modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>Conferma pagamento</h2><button class="icon-btn" type="button" data-close>${icon('x',18)}</button></div><div class="payment-confirm-summary"><strong>${esc(s.title)}</strong><span>${formatDate(s.date)} · ${fmt(s.amount_cents)} ${s.number?' · rata '+s.number+'/'+s.total:''}</span></div>
  <form id="confirm-payment-form">${wrapField('Come registrare il pagamento?',`<select name="link_mode" id="payment-link-mode"><option value="new">Crea un nuovo movimento effettivo</option>${matched.map(t=>`<option value="${esc(t.id)}">Collega già presente: ${formatDate(t.occurred_on)} · ${esc(t.merchant)} · ${fmt(t.amount_cents)}</option>`).join('')}</select>`)}
  ${wrapField('Data effettiva',formInput('occurred_on',s.date,'date','required'))}
  ${wrapField('Importo effettivo (€)',moneyInput('amount_eur',num(s.amount_cents)))}
  ${wrapField('Conto utilizzato',`<select name="account_id"><option value="">Da attribuire</option>${accounts.map(a=>`<option value="${esc(a.id)}" ${s.account_id===a.id?'selected':''}>${esc(a.owner)} · ${esc(a.label)}</option>`).join('')}</select>`)}
  <p class="form-hint">Selezionando un movimento esistente non verranno creati ulteriori addebiti. I campi di data, importo e conto sopra si applicano solo a un nuovo movimento.</p>
  <div class="modal-footer"><span></span><div class="right"><button class="btn ghost" type="button" data-close>Annulla</button><button class="btn primary" type="submit">Conferma</button></div></div></form></div>`;
  document.body.append(modal);
  $('#confirm-payment-form',modal).addEventListener('submit',async e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget),mode=String(fd.get('link_mode'));
    if(paymentLinkedTx(s)){toast('Il pagamento risulta già associato',true);return;}
    const link={payment_ref_kind:s.kind,payment_ref_id:s.id,payment_slot:s.slot};
    try{
      if(mode!=='new'){
        const t=state.transactions.find(x=>x.id===mode);
        if(!t||t.kind!=='expense'||t.payment_ref_id)throw new Error('Movimento esistente non più disponibile');
        await saveRecord('transactions',link,t.id);
      }else{
        const str=String(fd.get('amount_eur')).trim().replace(',','.'),amount=Math.round(Number(str)*100),date=String(fd.get('occurred_on'));
        if(!Number.isSafeInteger(amount)||amount<1||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Data o importo effettivo non valido');
        const tx={id:uniqueId(),occurred_on:date,amount_cents:amount,kind:'expense',owner:s.owner,category:s.category,merchant:s.title,description:s.number?`Pagamento rata ${s.number}/${s.total}`:'Abbonamento confermato',details:`Scadenza prevista ${formatDate(s.date)}. ${s.note||''}`.trim(),confidence:'verificato',account_id:String(fd.get('account_id')||''),payment_method:'other',source_key:`nido-plan-${s.kind}-${s.id}-${s.slot}`,...link};
        await saveRecord('transactions',tx);
      }
      closeModal(modal);render();toast('Pagamento confermato e associato. Nessun doppio conteggio.');
    }catch(err){toast('Conferma: '+err.message,true);}
  });
}
function paymentCalendarEntries(){
  // Un'unica voce selezionabile per piano, con tutte le rate future non pagate.
  // Anche un piano che termina dopo i due anni preimpostati resta esportabile
  // quando l'utente allarga la data finale nell'esportazione .ics.
  return (state.payment_plans||[]).filter(paymentIsActive).map(p=>{
    const remaining=planDates(p); // Esporta anche scadenze storiche se l'utente seleziona un periodo passato.
    if(!remaining.length)return null;
    return {id:'calendar-plan-'+p.id,title:p.title,owner:p.owner,category:p.category,amount_cents:p.amount_cents,active:1,confidence:'verificato',due_day:1,frequency:'monthly',_isPaymentPlan:true,_paymentDates:remaining.map(d=>d.date),_paymentNumbers:Object.fromEntries(remaining.map(d=>[d.date,d.number])),_paymentTotal:p.installment_count};
  }).filter(Boolean);
}
function handlePaymentClick(e){
  const edit=e.target.closest('[data-edit-plan]');if(edit){openInstallmentModal(edit.dataset.editPlan);return true;}
  const confirmBtn=e.target.closest('[data-confirm-slot]');if(confirmBtn){openPaymentConfirmation(confirmBtn.dataset.confirmSlot);return true;}
  const action=e.target.closest('[data-action]');if(!action)return false;
  if(action.dataset.action==='add-payment-plan'){openInstallmentModal();return true;}
  if(action.dataset.action==='add-subscription'){openSubscriptionModal();return true;}
  return false;
}
function handlePaymentChange(e){
  const node=e.target.closest('[data-track-rec]');if(!node)return false;
  const r=state.recurring.find(x=>x.id===node.dataset.trackRec);if(!r)return true;
  const previous={...r};r.track_payments=node.checked?1:0;
  if(node.checked)r.track_from=today;
  persistLocal().then(()=>{render();toast(node.checked?'Monitoraggio attivato da oggi':'Monitoraggio disattivato');}).catch(err=>{Object.assign(r,previous);toast('Impossibile salvare: '+err.message,true);render();});
  return true;
}
