'use strict';
// Quadra 1.5 - registro unico e calendario locale delle scadenze.
// Il calendario e' una proiezione: non crea addebiti ne' modifica saldi bancari.
const QUADRA_SCHEDULE_TYPES={all:'Tutte',subscription:'Abbonamenti',financing:'Finanziamenti',installment:'Piani a rate',other:'Altre ricorrenze'};
function scheduleType(r){
  if(r.schedule_type==='subscription'||r.schedule_type==='financing'||r.schedule_type==='other')return r.schedule_type;
  if(isSubscription(r))return 'subscription';
  const name=String(r.title||'')+' '+categoryLabel(r.category,true);
  return /finanziament|mutuo|prestito|cofidis|agos|credito|leasing|rata (auto|casa)|auto bank/i.test(name)?'financing':'other';
}
function scheduleStartEnd(month){
  const [y,m]=month.split('-').map(Number),first=new Date(Date.UTC(y,m-1,1));
  const prev=(first.getUTCDay()+6)%7;
  const start=new Date(first);start.setUTCDate(1-prev);
  const count=Math.ceil((prev+monthLastDay(y,m))/7)*7;
  const last=new Date(start);last.setUTCDate(last.getUTCDate()+count-1);
  const iso=d=>isoDay(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());
  return {first,start,from:iso(start),to:iso(last),cells:count};
}
function scheduleEvents(from,to){
  const items=[];
  const allowed=o=>ui.owner==='Famiglia'||o===ui.owner;
  for(const r of state.recurring){
    if(!allowed(r.owner)||!calendarDateKnown(r))continue;
    const type=scheduleType(r);
    if(ui.scheduleFilter!=='all'&&ui.scheduleFilter!==type)continue;
    for(const date of getCalendarOccurrences(r,from,to)){
      // A paused record is kept for historical reference but does not predict future debts.
      if(!paymentIsActive(r)&&date>=today)continue;
      const slot=r.frequency==='yearly'?date.slice(0,4):date.slice(0,7);
      const ref={kind:'recurring',id:r.id,slot};
      const linked=paymentLinkedTx(ref);
      const monitored=!!r.track_payments&&date>=(r.track_from||r.start_on||today);
      const status=linked?'confirmed':date<today?(monitored?'unconfirmed':'historical'):'upcoming';
      items.push({kind:'recurring',id:r.id,slot,date,title:r.title,owner:r.owner,category:r.category,amount_cents:r.amount_cents,type,status,linked:!!linked,confirmable:!!r.track_payments&&monitored&&paymentIsActive(r),note:r.note||''});
    }
  }
  if(ui.scheduleFilter==='all'||ui.scheduleFilter==='installment'){
    for(const p of (state.payment_plans||[])){
      if(!allowed(p.owner))continue;
      for(const d of planDates(p)){
        if(d.date<from||d.date>to||(!paymentIsActive(p)&&d.date>=today))continue;
        const slot=String(d.number),linked=paymentLinkedTx({kind:'payment_plan',id:p.id,slot});
        const declared=d.number<=Number(p.paid_before||0);
        const status=linked?'confirmed':declared?'declared':d.date<today?'unconfirmed':'upcoming';
        items.push({kind:'payment_plan',id:p.id,slot,date:d.date,title:p.title,owner:p.owner,category:p.category,amount_cents:p.amount_cents,type:'installment',number:d.number,total:p.installment_count,status,linked:!!linked,confirmable:!linked&&!declared&&paymentIsActive(p),note:p.note||''});
      }
    }
  }
  return items.sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
}
const scheduleBadge={confirmed:'Confermato',declared:'Gia pagata (indicata)',unconfirmed:'Da verificare',historical:'Storico previsto',upcoming:'In programma'};
function scheduleTypeLabel(x){return {subscription:'Abbonamento',financing:'Finanziamento',installment:'Piano a rate',other:'Ricorrenza'}[x]||'Ricorrenza';}
function scheduleFiltersHtml(){return `<div class="qs-filters" role="group" aria-label="Filtra tipo scadenza">${Object.entries(QUADRA_SCHEDULE_TYPES).map(([k,label])=>`<button class="chip ${ui.scheduleFilter===k?'selected':''}" data-schedule-filter="${k}" aria-pressed="${ui.scheduleFilter===k}">${label}</button>`).join('')}</div>`;}
function scheduleCalendar(events,month){
  const range=scheduleStartEnd(month),[y,m]=month.split('-').map(Number);
  const byDay=new Map();for(const e of events){const day=byDay.get(e.date)||[];day.push(e);byDay.set(e.date,day);}
  let grid='';
  for(let i=0;i<range.cells;i++){
    const current=new Date(range.start);current.setUTCDate(current.getUTCDate()+i);
    const iso=isoDay(current.getUTCFullYear(),current.getUTCMonth()+1,current.getUTCDate());
    const here=byDay.get(iso)||[];
    const other=current.getUTCMonth()+1!==m;
    const selected=ui.scheduleSelectedDay===iso;
    const n=here.length;
    grid+=`<button type="button" class="qs-day ${other?'qs-outside':''} ${iso===today?'qs-today':''} ${selected?'qs-selected':''}" data-schedule-day="${iso}" aria-pressed="${selected}" aria-label="${formatDate(iso)}: ${n} scadenze">
      <span class="qs-date"><span>${current.getUTCDate()}</span>${n?`<small>${n}</small>`:''}</span>
      <span class="qs-day-events">${here.slice(0,3).map(e=>`<span class="qs-event qs-${e.status}" title="${esc(e.title)} · ${fmt(e.amount_cents)}">${esc(e.title)}</span>`).join('')}${n>3?`<span class="qs-more">+${n-3} altre</span>`:''}</span>
      <span class="qs-mobile-dots">${here.slice(0,4).map(e=>`<i class="qs-dot qs-${e.status}"></i>`).join('')}</span>
    </button>`;
  }
  return `<article class="card qs-calendar-card"><div class="card-top qs-calendar-top"><div><h2>Calendario delle scadenze</h2><p class="subheading">Passate e future, senza generare movimenti effettivi</p></div>
   <div class="qs-calendar-controls"><button class="icon-btn" data-schedule-month="-1" title="Mese precedente" aria-label="Mese precedente">${icon('chevron-left',17)}</button><strong class="qs-month-title">${formatMonth(month)}</strong><button class="icon-btn" data-schedule-month="1" title="Mese successivo" aria-label="Mese successivo">${icon('chevron-right',17)}</button><button class="btn ghost sm" data-schedule-today>Oggi</button><input class="qs-month-picker" type="month" data-schedule-jump value="${month}" aria-label="Vai a mese e anno" title="Vai direttamente al mese e anno"></div></div>
   <div class="qs-scroll"><div class="qs-cal-grid" role="group" aria-label="Calendario mensile di ${formatMonth(month)}">${['Lun','Mar','Mer','Gio','Ven','Sab','Dom'].map(d=>`<span class="qs-weekday">${d}</span>`).join('')}${grid}</div></div>
   <div class="qs-legend"><span><i class="qs-dot qs-confirmed"></i>Confermata</span><span><i class="qs-dot qs-upcoming"></i>Programmata</span><span><i class="qs-dot qs-unconfirmed"></i>Da verificare</span><span><i class="qs-dot qs-historical"></i>Storico previsto</span></div>
   <p class="form-hint">Le scadenze storiche sono ricostruite dalle regole disponibili: non provano che i pagamenti siano avvenuti. Le date non confermate non sono mostrate.</p>
  </article>`;
}
function scheduleEventRow(e){
  const descr=`${scheduleTypeLabel(e.type)} · ${esc(e.owner)}${e.number?` · rata ${e.number}/${e.total}`:''}`;
  return `<div class="qs-agenda-row"><span class="qs-agenda-date">${formatDate(e.date)}</span><div class="qs-agenda-info"><strong>${esc(e.title)}</strong><span>${descr} · <span class="qs-state qs-${e.status}">${scheduleBadge[e.status]}</span></span></div><strong class="qs-agenda-money">${fmt(e.amount_cents)}</strong><div class="qs-agenda-actions">${e.confirmable&&e.status!=='confirmed'?`<button class="btn primary sm" data-confirm-slot="${e.kind}|${esc(e.id)}|${esc(e.slot)}">Conferma</button>`:''}${e.kind==='payment_plan'?`<button class="tiny-btn" data-edit-plan="${esc(e.id)}" title="Modifica piano" aria-label="Modifica piano">${icon('edit',15)}</button>`:`<button class="tiny-btn" data-edit-rec="${esc(e.id)}" title="Modifica ricorrenza" aria-label="Modifica ricorrenza">${icon('edit',15)}</button>`}</div></div>`;
}
function scheduleRegistry(){
  const matchType=x=>ui.scheduleFilter==='all'||ui.scheduleFilter===x;
  const recurring=state.recurring.filter(r=>(ui.owner==='Famiglia'||r.owner===ui.owner)&&matchType(scheduleType(r))).sort((a,b)=>a.title.localeCompare(b.title,'it'));
  const plans=(state.payment_plans||[]).filter(p=>(ui.owner==='Famiglia'||p.owner===ui.owner)&&matchType('installment')).sort((a,b)=>a.title.localeCompare(b.title,'it'));
  const recs=recurring.map(r=>{
   const t=scheduleType(r),known=calendarDateKnown(r);
   return `<div class="qs-reg-row"><span class="qs-reg-symbol">${icon(t==='subscription'?'calendar-check':t==='financing'?'wallet':'repeat',19)}</span><div class="qs-reg-main"><strong>${esc(r.title)}</strong><span>${scheduleTypeLabel(t)} · ${esc(r.owner)} · ${r.frequency==='yearly'?'Annuale':'Mensile'}${known?' · giorno '+r.due_day:' · data da verificare'}${r.end_on?' · fino al '+formatDate(r.end_on):''}</span></div><span class="qs-reg-price">${fmt(r.amount_cents)}<small>/${r.frequency==='yearly'?'anno':'mese'}</small></span><label class="pay-track" title="Genera movimenti previsti da confermare"><input type="checkbox" data-track-rec="${esc(r.id)}" ${r.track_payments?'checked':''} ${!known?'disabled':''}><span>Monitora</span></label><button class="tiny-btn" data-edit-rec="${esc(r.id)}" title="Modifica" aria-label="Modifica ${esc(r.title)}">${icon('edit',16)}</button><button class="tiny-btn qs-trash" data-delete-schedule="recurring|${esc(r.id)}" title="Elimina" aria-label="Elimina ${esc(r.title)}">${icon('trash',16)}</button></div>`;
  }).join('');
  const installments=plans.map(p=>{const s=paymentPlanStatus(p);return `<div class="qs-reg-row"><span class="qs-reg-symbol">${icon('credit-card',19)}</span><div class="qs-reg-main"><strong>${esc(p.title)}</strong><span>Piano a rate · ${esc(p.owner)} · ${s.settled}/${s.total} saldate · ${s.next?'Prossima '+formatDate(s.next.date):'Completato'}</span></div><span class="qs-reg-price">${fmt(p.amount_cents)}<small>/rata</small></span><button class="tiny-btn" data-edit-plan="${esc(p.id)}" title="Modifica" aria-label="Modifica ${esc(p.title)}">${icon('edit',16)}</button><button class="tiny-btn qs-trash" data-delete-schedule="payment_plans|${esc(p.id)}" title="Elimina" aria-label="Elimina ${esc(p.title)}">${icon('trash',16)}</button></div>`;}).join('');
  return `<article class="card qs-register"><div class="card-top"><div><h2>Tutti gli impegni</h2><p class="subheading">Abbonamenti, finanziamenti, piani a rate e altre ricorrenze. Modifica o elimina ogni voce.</p></div><span class="badge soft">${recurring.length+plans.length} voci</span></div><div class="qs-reg-list">${recs+installments||'<div class="empty">Nessuna voce per questo filtro. Puoi crearne una dal pulsante in alto.</div>'}</div><p class="form-hint" style="margin-top:18px">Se elimini un piano o una ricorrenza, le spese bancarie già confermate rimangono in Movimenti. Per conservare le scadenze passate senza prevederne di nuove, imposta una data di termine.</p></article>`;
}
function renderQuadraSchedule(){
  const month=ui.scheduleMonth||presentMonth,range=scheduleStartEnd(month),events=scheduleEvents(range.from,range.to);
  const monthEvents=events.filter(e=>e.date.startsWith(month)),chosen=ui.scheduleSelectedDay,view=chosen?events.filter(e=>e.date===chosen):monthEvents;
  const activeRecs=state.recurring.filter(r=>paymentIsActive(r)&&(ui.owner==='Famiglia'||r.owner===ui.owner));
  const activePlans=(state.payment_plans||[]).filter(p=>paymentIsActive(p)&&(ui.owner==='Famiglia'||p.owner===ui.owner));
  const unknown=activeRecs.filter(r=>!calendarDateKnown(r)&&(ui.scheduleFilter==='all'||ui.scheduleFilter===scheduleType(r)));
  const due=monthEvents.filter(e=>e.status==='unconfirmed').length,done=monthEvents.filter(e=>e.status==='confirmed'||e.status==='declared').length;
  return `${pageHead('Scadenze e rate','Il calendario unico per abbonamenti, finanziamenti, acquisti dilazionati e addebiti ricorrenti.',`<button class="btn ghost" data-action="export-calendar">${icon('download',15)} Esporta su Google Calendar</button>`)}${selectOwner()}
   <div class="qs-toolbar"><div><strong>Aggiungi un impegno</strong><p class="form-hint">Le scadenze previste non incidono sul saldo finché non confermi il pagamento.</p></div><div class="qs-actions"><button class="btn primary sm" data-action="add-subscription">${icon('plus',15)} Abbonamento</button><button class="btn sm" data-action="schedule-add-financing">${icon('plus',15)} Finanziamento</button><button class="btn sm" data-action="add-payment-plan">${icon('plus',15)} Piano a rate</button><button class="btn ghost sm" data-action="schedule-add-other">${icon('plus',15)} Altra ricorrenza</button></div></div>
   ${scheduleFiltersHtml()}
   <div class="grid kpis qs-stats">${kpi('Scadenze del mese',String(monthEvents.length),formatMonth(month),'calendar-check','accent')}${kpi('Impegni programmati',fmt(monthEvents.reduce((s,e)=>s+Number(e.amount_cents||0),0)),'Non sono tutti pagamenti effettivi','wallet')}${kpi('Gia confermate',String(done),'Pagamento registrato o dichiarato','check')}${kpi('Passate da verificare',String(due),'Nel mese selezionato','alert-circle',due?'negative':'')}</div>
   ${scheduleCalendar(events,month)}
   <article class="card section-spacer"><div class="card-top"><div><h2>${chosen?'Scadenze del '+formatDate(chosen):'Scadenze di '+formatMonth(month)}</h2><p class="subheading">${chosen?'Seleziona nuovamente il giorno per tornare al mese':'Seleziona un giorno sul calendario per vedere solo le sue scadenze'}</p></div>${chosen?'<button class="btn ghost sm" data-schedule-clear>Mostra il mese</button>':`<span class="badge soft">${view.length} voci</span>`}</div>
   <div class="qs-agenda-list">${view.length?view.map(scheduleEventRow).join(''):'<div class="empty">Nessuna scadenza per il periodo selezionato.</div>'}</div></article>
   ${unknown.length?`<div class="info-strip qs-undated">${icon('alert-circle',17)}<span><strong>${unknown.length} ${unknown.length===1?'voce senza data attendibile':'voci senza data attendibile'}.</strong> ${unknown.map(r=>esc(r.title)).join(', ')}. Correggi la scadenza nella scheda prima di mostrarla sul calendario.</span></div>`:''}
   ${scheduleRegistry()}`;
}
function handleScheduleClick(e){
  const month=e.target.closest('[data-schedule-month]');if(month){ui.scheduleMonth=monthShift(ui.scheduleMonth||presentMonth,Number(month.dataset.scheduleMonth));ui.scheduleSelectedDay='';render();return true;}
  const jump=e.target.closest('[data-schedule-today]');if(jump){ui.scheduleMonth=presentMonth;ui.scheduleSelectedDay=today;render();return true;}
  const filter=e.target.closest('[data-schedule-filter]');if(filter){ui.scheduleFilter=filter.dataset.scheduleFilter;ui.scheduleSelectedDay='';render();return true;}
  const day=e.target.closest('[data-schedule-day]');if(day){const d=day.dataset.scheduleDay;ui.scheduleSelectedDay=ui.scheduleSelectedDay===d?'':d;if(d.slice(0,7)!==ui.scheduleMonth)ui.scheduleMonth=d.slice(0,7);render();return true;}
  const clear=e.target.closest('[data-schedule-clear]');if(clear){ui.scheduleSelectedDay='';render();return true;}
  const del=e.target.closest('[data-delete-schedule]');if(del){
   const [table,id]=del.dataset.deleteSchedule.split('|');
   if(!['recurring','payment_plans'].includes(table))return true;
   const item=(state[table]||[]).find(x=>x.id===id);if(!item){toast('Voce non trovata',true);return true;}
   if(!confirm(`Eliminare definitivamente «${item.title}»? Le spese bancarie gia registrate resteranno in Movimenti. Per conservare lo storico delle scadenze usa invece una data di termine.`))return true;
   deleteRecord(table,id).then(()=>{render();toast('Voce eliminata; movimenti effettivi conservati');}).catch(err=>toast('Eliminazione: '+err.message,true));return true;
  }
  const action=e.target.closest('[data-action]');if(!action)return false;
  if(action.dataset.action==='schedule-add-financing'){openModal('recurring',null,'financing');return true;}
  if(action.dataset.action==='schedule-add-other'){openModal('recurring',null,'other');return true;}
  return false;
}

function handleScheduleChange(e){
 const node=e.target.closest('[data-schedule-jump]');if(!node)return false;
 if(!/^\d{4}-\d{2}$/.test(node.value))return true;
 ui.scheduleMonth=node.value;ui.scheduleSelectedDay='';render();return true;
}
