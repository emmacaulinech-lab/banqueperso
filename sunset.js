'use strict';
const F=Finance;
let currentImport=null, currentView='home', selectedCalendarDate=F.today(), deletedTx=null, undoTimer=null;
let persistQueue=Promise.resolve(), activeMutation=false, loadedRevision=0;
const icons={home:'⌂',operations:'≡',budget:'◷',calendar:'▦',savings:'◇'};
const labels={home:'Accueil',operations:'Opérations',budget:'Budget',calendar:'Calendrier',savings:'Épargne'};
const money=n=>`<span data-money>${new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(Number(n)||0)}</span>`;
const attr=s=>esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const idNew=()=>crypto.randomUUID();
function defaults(){
  DB.params ||= {};DB.transactions ||= [];DB.categories ||= [];
  ['schedules','ignoredRecurrences','handledEvents','refunds','goals','imports'].forEach(k=>DB.params[k] ||= []);
  DB.params.categoryRules ||= {};
  DB.params.nextSeq=DB.transactions.reduce((n,t)=>Math.max(n,(Number(t.seq)||0)+1),Number(DB.params.nextSeq)||1);
  DB.transactions.forEach(t=>{t.amount=F.euros(F.cents(t.amount));});
}
function notify(text,undo=false){
  const el=document.getElementById('sun-toast');el.replaceChildren();
  const span=document.createElement('span');span.textContent=text;el.append(span);
  if(undo){const b=document.createElement('button');b.textContent='Annuler';b.onclick=undoDelete;el.append(b);}
  else{const b=document.createElement('button');b.textContent='Fermer';b.onclick=()=>el.hidden=true;el.append(b);}
  el.hidden=false;
}
function save(){
  if(!uid)return Promise.reject(Error('Reconnecte-toi pour enregistrer.'));
  const snapshot={transactions:JSON.stringify(DB.transactions),categories:JSON.stringify(DB.categories),params:JSON.stringify(DB.params)};
  // Serialiser les sauvegardes pour éviter qu'une ancienne écriture remplace la nouvelle.
  const ref=db.collection('users').doc(uid);
  const job=persistQueue.catch(()=>{}).then(async()=>{
    const expected=loadedRevision;
    await db.runTransaction(async transaction=>{
      const doc=await transaction.get(ref);const revision=doc.exists?(Number(doc.data().revision)||0):0;
      if(revision!==expected)throw Error('CONFLICT');
      transaction.set(ref,{...snapshot,revision:expected+1});
    });
    loadedRevision=expected+1;
  });persistQueue=job;return job;
}
async function mutate(fn,message){
  if(activeMutation){notify('Enregistrement en cours…');return false;}
  activeMutation=true;const backup=JSON.stringify(DB);
  try{fn();await save();renderAll();if(message)notify(message);return true;}
  catch(e){DB=JSON.parse(backup);renderAll();notify(e.message==='CONFLICT'?'Tes données ont changé sur un autre appareil. Recharge la page avant de réessayer.':'Enregistrement impossible. Tes changements n’ont pas été enregistrés. Réessaie.');console.error(e);return false;}
  finally{activeMutation=false;}
}
async function loadData(){
  document.getElementById('loading').style.display='flex';
  try{
    const doc=await db.collection('users').doc(uid).get();
    const d=doc.exists?doc.data():{};
    const loaded={transactions:d.transactions?JSON.parse(d.transactions):[],categories:d.categories?JSON.parse(d.categories):[],params:d.params?JSON.parse(d.params):{soldeInitial:0,nextSeq:1}};
    if(!Array.isArray(loaded.transactions)||!Array.isArray(loaded.categories)||!loaded.params||typeof loaded.params!=='object')throw Error('Données invalides');
    DB=loaded;loadedRevision=Number(d.revision)||0;defaults();initUI();
    document.getElementById('login-page').classList.remove('on');document.getElementById('app').classList.add('on');
  }catch(e){
    console.error(e);document.getElementById('app').classList.remove('on');document.getElementById('login-page').classList.add('on');document.getElementById('l-err').textContent='Impossible de charger tes données. Reconnecte-toi pour réessayer.';
  }finally{document.getElementById('loading').style.display='none';}
}
function mountSunset(){
  if(document.getElementById('sun-nav'))return;
  document.querySelector('.app-name').textContent='ma banque ♡';
  const top=document.querySelector('.topbar-right');
  top.insertAdjacentHTML('afterbegin','<button class="sun-privacy" id="sun-privacy" aria-label="Masquer les montants" aria-pressed="false" onclick="togglePrivacy()">◉</button><button class="sun-add" onclick="showView(\'add\')">+ Ajouter</button>');
  const nav=document.createElement('nav');nav.id='sun-nav';nav.className='sun-nav';nav.setAttribute('aria-label','Navigation principale');
  nav.innerHTML=Object.keys(labels).map(k=>`<button data-view="${k}" onclick="showView('${k}')"><span aria-hidden="true">${icons[k]}</span>${labels[k]}</button>`).join('');
  document.querySelector('.tabs').after(nav);
  document.getElementById('pane-0').innerHTML='<div id="sun-home"></div>';
  document.getElementById('pane-3').insertAdjacentHTML('afterbegin','<div><h1 class="sun-heading">Ton budget</h1><p class="sun-sub">Comprendre tes dépenses, choisir tes limites.</p></div><div id="sun-budget"></div><div class="sun-actions"><button class="btn" onclick="showView(\'report\')">Bilan mensuel</button></div>');
  const h=document.querySelector('#pane-2 .filters');h.insertAdjacentHTML('beforeend','<input id="h-search" type="text" placeholder="Nom ou montant" aria-label="Chercher une opération" oninput="renderHistorique()"/><input id="h-start" type="date" aria-label="À partir du" onchange="renderHistorique()"/><input id="h-end" type="date" aria-label="Jusqu’au" onchange="renderHistorique()"/>');
  document.getElementById('pane-2').insertAdjacentHTML('afterbegin','<div><h1 class="sun-heading">Tes opérations</h1><p class="sun-sub">Chaque mouvement, à sa place.</p></div><div class="sun-actions"><button class="btn" onclick="showView(\'import\')">Importer un relevé</button><button class="btn" onclick="refundEditor()">Remboursement attendu</button></div><div id="sun-refunds"></div>');
  document.getElementById('pane-1').insertAdjacentHTML('afterbegin','<h1 class="sun-heading">Ajouter une opération</h1>');
  document.querySelector('#pane-1 .card').insertAdjacentHTML('beforeend','<label class="sun-checkbox"><input type="checkbox" id="s-transfer"/> Virement entre mes comptes</label>');
  document.getElementById('pane-4').insertAdjacentHTML('afterbegin','<h1 class="sun-heading">Importer un relevé</h1><p class="sun-sub">Les paiements identiques sont conservés. Le solde du relevé sert de contrôle.</p><div id="sun-import-check" aria-live="polite"></div>');
  document.getElementById('pane-5').innerHTML='<h1 class="sun-heading">Ton bilan mensuel</h1><div id="sun-report"></div>';
  document.getElementById('app').insertAdjacentHTML('beforeend','<section class="pane" id="pane-6"><h1 class="sun-heading">Ton calendrier</h1><p class="sun-sub">Les mouvements enregistrés et ceux à venir.</p><div class="sun-actions"><button class="btn" onclick="scheduleEditor()">+ Paiement ou rentrée</button></div><div class="card"><div id="sun-calendar"></div></div><div class="card" id="sun-calendar-detail"></div><div id="sun-schedule-list"></div></section><section class="pane" id="pane-7"><h1 class="sun-heading">Ton épargne</h1><p class="sun-sub">Tes objectifs, à ton rythme.</p><div class="sun-actions"><button class="btn" onclick="goalEditor()">+ Nouvel objectif</button></div><div id="sun-goals"></div><div class="card" id="sun-transfers"></div></section><div class="sun-settings"><button class="btn gray" onclick="exportBackup()">Exporter une sauvegarde</button><button class="btn gray" onclick="editSoldeInitial()">Vérifier mon solde</button></div>');
  document.body.insertAdjacentHTML('beforeend','<div class="sun-modal" id="sun-modal" hidden><section class="sun-dialog" role="dialog" aria-modal="true" aria-labelledby="sun-dialog-title"><form id="sun-form"></form></section></div><div id="sun-toast" class="sun-toast" role="status" hidden></div>');
  document.getElementById('s-label').addEventListener('blur',()=>{const cat=DB.params.categoryRules[F.norm(document.getElementById('s-label').value)+'|'+newTxType];if(cat)document.getElementById('s-cat').value=cat;});
  document.addEventListener('keydown',e=>{
    const modal=document.getElementById('sun-modal');if(modal.hidden)return;
    if(e.key==='Escape')closeDialog();
    if(e.key==='Tab'){const els=[...modal.querySelectorAll('button,input,select,textarea')].filter(x=>!x.disabled);const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  });
}
const originalInitUI=initUI;
let initializedSunset=false;
initUI=function(){mountSunset();if(!initializedSunset){document.getElementById('swatch-row').replaceChildren();originalInitUI();initializedSunset=true;}else{document.getElementById('s-date').value=F.today();updateCurrentMonthLabel();}showView(currentView);};
function showView(view){
  const map={home:0,add:1,operations:2,budget:3,import:4,report:5,calendar:6,savings:7};
  currentView=view;document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.id==='pane-'+map[view]));
  const active=['add','import'].includes(view)?'operations':view==='report'?'budget':view;
  document.querySelectorAll('#sun-nav button').forEach(b=>{b.classList.toggle('active',b.dataset.view===active);b.setAttribute('aria-current',b.dataset.view===active?'page':'false');});
  renderAll();window.scrollTo({top:0,behavior:'auto'});
}
gT=function(i){showView(['home','add','operations','budget','import','report','calendar','savings'][i]);};
function togglePrivacy(){
  const hidden=document.body.classList.toggle('money-hidden');const b=document.getElementById('sun-privacy');b.setAttribute('aria-pressed',String(hidden));b.setAttribute('aria-label',hidden?'Afficher les montants':'Masquer les montants');b.textContent=hidden?'◎':'◉';
}
function monthTx(month=currentMonth){return DB.transactions.filter(t=>t.date.startsWith(month)&&t.date<=F.today());}
function totals(txs){return {rec:F.euros(txs.filter(t=>t.type==='rec'&&!t.internalTransfer).reduce((s,t)=>s+F.cents(t.amount),0)),dep:F.euros(txs.filter(t=>t.type==='dep'&&!t.internalTransfer).reduce((s,t)=>s+F.cents(t.amount),0))};}
function forecast(){
  const now=F.today(),end=F.monthShift(now,1,1);const last=F.shift(end,-1);
  const events=F.scheduleEvents(DB,now,last);
  const bookedFuture=DB.transactions.filter(t=>t.date>now&&t.date<=last);
  const delta=events.reduce((s,e)=>s+F.signed(e),0)+bookedFuture.reduce((s,t)=>s+F.signed(t),0);
  const after=F.euros(F.cents(F.balance(DB))+delta);
  // Estimer uniquement les dépenses variables ; les paiements réguliers sont exclus de la moyenne.
  const schedules=[...DB.params.schedules,...F.recurrenceCandidates(DB)];
  const variable=DB.transactions.filter(t=>t.type==='dep'&&!t.internalTransfer&&t.date<now.slice(0,7)+'-01'&&!schedules.some(s=>s.type==='dep'&&F.norm(s.label)===F.norm(t.label)));
  const months=[...new Set(DB.transactions.filter(t=>t.date<now.slice(0,7)+'-01').map(t=>t.date.slice(0,7)))];
  const first=DB.transactions.map(t=>t.date).sort()[0];
  const enough=months.length>=2&&first&&F.shift(first,45)<=now;
  const remaining=Math.max(0,Math.round((new Date(last+'T12:00:00')-new Date(now+'T12:00:00'))/86400000));
  const variableRemaining=enough?F.euros(Math.round(variable.reduce((s,t)=>s+F.cents(t.amount),0)/(months.length*30)*remaining)):null;
  return {events,bookedFuture,after,variableRemaining,end:variableRemaining===null?null:F.euros(F.cents(after)-F.cents(variableRemaining))};
}
function renderDashboard(){
  const el=document.getElementById('sun-home');if(!el)return;
  const amount=F.balance(DB),summary=totals(monthTx()),p=forecast(),a=DB.params.balanceAnchor;
  const latest=DB.transactions.filter(t=>t.date<=F.today()).sort((a,b)=>b.date.localeCompare(a.date)||(Number(b.seq)||0)-(Number(a.seq)||0)).slice(0,4);
  const through=DB.params.imports.map(i=>i.end).filter(Boolean).sort().at(-1);
  el.innerHTML=`<h1 class="sun-heading">Bonjour Emma</h1><p class="sun-sub">Un peu de clarté dans ton quotidien.</p><div class="sun-grid" style="margin-top:22px"><div><div class="sun-balance"><div>Sur ton compte aujourd’hui</div><div class="sun-value">${money(amount)}</div><p class="sun-sub">${a?'Vérifié le '+fdate(a.date):'Solde calculé · à vérifier avec ta banque'}</p><button class="sun-link" onclick="editSoldeInitial()">Vérifier mon solde ↗</button><div class="sun-stats"><div><span class="sun-small">Rentrées · ${esc(formatMonth(currentMonth))}</span><br><strong>${money(summary.rec)}</strong></div><div><span class="sun-small">Dépenses du mois</span><br><strong>${money(summary.dep)}</strong></div></div></div><p class="sun-sub" style="margin:14px 0">${through?'Relevés importés jusqu’au '+fdate(through):'Aucun relevé vérifié importé'} · les virements internes sont exclus des dépenses.</p><div class="card" style="margin-top:20px"><div class="sun-section"><h2>Ce qu’il te restera</h2></div><div class="sun-projection"><div class="sun-estimate"><span class="sun-small">Après les mouvements prévus ce mois</span><strong>${money(p.after)}</strong><span class="sun-small">Rentrées et paiements ${p.events.some(e=>!e.confirmed)?'estimés inclus':'confirmés'}</span></div><div class="sun-estimate"><span class="sun-small">Estimation de fin de mois</span><strong>${p.end===null?'À préciser':money(p.end)}</strong><span class="sun-small">${p.end===null?'Historique insuffisant pour estimer les dépenses variables':'Dont '+money(p.variableRemaining)+' de dépenses variables estimées'}</span></div></div></div></div><div><div class="card"><div class="sun-section"><h2>Les prochains mouvements</h2><button class="sun-link" onclick="showView('calendar')">Calendrier</button></div>${p.events.slice(0,5).map(eventRow).join('')||'<div class="empty">Aucune échéance détectée ce mois.<br>Tu peux en ajouter dans Calendrier.</div>'}${p.bookedFuture.length?'<p class="sun-small">'+p.bookedFuture.length+' opération(s) future(s) déjà saisie(s) incluse(s).</p>':''}</div><div class="card" style="margin-top:20px"><div class="sun-section"><h2>Dernières opérations</h2><button class="sun-link" onclick="showView('operations')">Historique</button></div>${latest.map(t=>`<div class="sun-row"><span class="sun-icon" aria-hidden="true">${t.internalTransfer?'⇄':t.type==='dep'?'↗':'↙'}</span><div class="sun-row-main"><p>${esc(t.label)}</p><span class="sun-small">${fdate(t.date)}${t.internalTransfer?' · Virement interne':''}</span></div><span class="sun-number">${t.type==='dep'?'−':'+'}${money(t.amount)}</span></div>`).join('')||'<div class="empty">Tes opérations apparaîtront ici.</div>'}</div></div></div>`;
}
function eventRow(e){return `<div class="sun-row"><span class="sun-icon" aria-hidden="true">${e.type==='dep'?'↗':'↙'}</span><div class="sun-row-main"><p>${esc(e.label)}</p><span class="sun-small">${fdate(e.date)} · ${e.confirmed?'Confirmé':'Estimation à confirmer'}</span></div><span class="sun-number">${e.type==='dep'?'−':'+'}${money(e.amount)}</span></div>`;}
function renderAll(){
  defaults();if(!document.getElementById('sun-home'))return;
  const cat=document.getElementById('h-cat').value;
  renderSaisieSelects();renderHistoriqueSelects();document.getElementById('h-cat').value=cat;
  renderDashboard();renderHistorique();renderCategories();renderCalendar();renderSavings();renderRefunds();renderReport();
}
renderRecurrences=function(){};renderProjectionFinMois=function(){};
renderAnalyse=function(){renderReport();};renderAnalyseSelects=function(){};
function renderHistorique(){
  const list=document.getElementById('h-list');if(!list)return;
  const period=document.getElementById('h-period').value,cat=document.getElementById('h-cat').value,type=document.getElementById('h-type').value;
  const query=F.norm(document.getElementById('h-search').value),start=document.getElementById('h-start').value,end=document.getElementById('h-end').value;
  const txs=DB.transactions.filter(t=>(period==='all'||(period==='year'?t.date.startsWith(currentMonth.slice(0,4)):t.date.startsWith(currentMonth)))&&(!cat||t.catId===cat)&&(!type||t.type===type)&&(!start||t.date>=start)&&(!end||t.date<=end)&&(!query||F.norm(t.label).includes(query)||String(t.amount).includes(query.replace(',','.')))).sort((a,b)=>b.date.localeCompare(a.date)||(Number(b.seq)||0)-(Number(a.seq)||0));
  list.innerHTML=txs.map(t=>{const c=DB.categories.find(c=>c.id===t.catId);return `<div class="tx-item"><div class="tx-dot ${t.type}"></div><div class="tx-main"><div class="tx-label">${esc(t.label)}</div><div class="tx-meta">${fdate(t.date)} · ${esc(c?.name||'Sans catégorie')} ${t.internalTransfer?'<span class="sun-badge">Virement interne</span>':''} ${t.date>F.today()?'<span class="sun-badge">À venir</span>':''}</div></div><div class="tx-amount ${t.type}" data-money>${t.type==='dep'?'−':'+'}${fa(t.amount)}</div><button class="tx-del" aria-label="Modifier ${attr(t.label)}" onclick="editTransaction(${attr(JSON.stringify(t.id))})">✎</button><button class="tx-del" aria-label="Supprimer ${attr(t.label)}" onclick="delTransaction(${attr(JSON.stringify(t.id))})">×</button></div>`;}).join('')||'<div class="empty">Aucune opération pour ces filtres.</div>';
}
let dialogFocus=null;
function openDialog(title,html,submit){
  dialogFocus=document.activeElement;const m=document.getElementById('sun-modal'),form=document.getElementById('sun-form');
  form.innerHTML=`<h2 id="sun-dialog-title">${esc(title)}</h2>${html}<div id="sun-dialog-error" class="sun-error" role="alert"></div><div class="sun-actions"><button class="sun-add" type="submit">Enregistrer</button><button class="btn gray" type="button" onclick="closeDialog()">Annuler</button></div>`;
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;try{await submit(new FormData(form));}catch(err){document.getElementById('sun-dialog-error').textContent=err.message;}finally{button.disabled=false;}};
  m.hidden=false;form.querySelector('input,select,button')?.focus();
}
function closeDialog(){document.getElementById('sun-modal').hidden=true;dialogFocus?.focus();}
function field(name,label,value='',type='text',extra=''){return `<label>${esc(label)}<input name="${name}" type="${type}" value="${attr(value)}" ${extra}></label>`;}
function amountValue(s){const n=Number(String(s).trim().replace(/\s/g,'').replace(',','.'));if(!Number.isFinite(n))throw Error('Montant invalide');return F.euros(F.cents(n));}
async function editSoldeInitial(){
  const existing=DB.params.balanceAnchor;
  openDialog('Vérifier ton solde',`<p class="sun-small" style="margin-bottom:18px">Indique le solde comptabilisé par ta banque à la fin de cette date. Les anciens relevés importés ensuite ne modifieront pas ce repère.</p>${field('amount','Solde bancaire (€)',F.balance(DB),'text','required inputmode="decimal"')}${field('date','Date du solde',F.today(),'date','required')}<p class="sun-small">${existing?'Dernier repère : '+fdate(existing.date):'Les anciennes opérations sont conservées.'}</p>`,async data=>{
    const amount=amountValue(data.get('amount')),date=data.get('date');if(!F.validDate(date)||date>F.today())throw Error('Choisis une date valide, aujourd’hui ou avant.');
    if(await mutate(()=>DB.params.balanceAnchor=F.anchor(DB,amount,date),'Solde vérifié et daté.'))closeDialog();
  });
}
function categoryOptions(selected='',type){return '<option value="">Sans catégorie</option>'+DB.categories.filter(c=>!type||c.type===type).map(c=>`<option value="${attr(c.id)}" ${c.id===selected?'selected':''}>${esc(c.name)}</option>`).join('');}
function transactionForm(t){return `${field('label','Libellé',t.label,'text','required')}${field('amount','Montant (€)',t.amount,'text','required inputmode="decimal"')}${field('date','Date de l’opération',t.date,'date','required')}<label>Type<select name="type"><option value="dep" ${t.type==='dep'?'selected':''}>Dépense</option><option value="rec" ${t.type==='rec'?'selected':''}>Rentrée</option></select></label><label>Catégorie<select name="catId">${categoryOptions(t.catId)}</select></label><label class="sun-checkbox"><input name="internalTransfer" type="checkbox" ${t.internalTransfer?'checked':''}>Virement entre mes comptes</label>`;}
function editTransaction(id){
  const t=DB.transactions.find(t=>String(t.id)===String(id));if(!t)return;
  openDialog('Modifier l’opération',transactionForm(t),async d=>{
    const amount=amountValue(d.get('amount')),date=d.get('date'),label=d.get('label').trim(),type=d.get('type'),catId=d.get('catId');
    if(amount<=0||!F.validDate(date)||!label)throw Error('Vérifie le montant, la date et le libellé.');
    const category=DB.categories.find(c=>c.id===catId);if(category&&category.type!==type)throw Error('Choisis une catégorie correspondant au type.');
    if(await mutate(()=>{const current=DB.transactions.find(v=>String(v.id)===String(id));if(!current)throw Error('Opération introuvable');Object.assign(current,{amount,date,label,type,catId,internalTransfer:d.has('internalTransfer')});if(catId)DB.params.categoryRules[F.norm(label)+'|'+type]=catId;},'Opération modifiée.'))closeDialog();
  });
}
async function addTransaction(){
  const label=document.getElementById('s-label').value.trim(),date=document.getElementById('s-date').value;
  let amount;try{amount=amountValue(document.getElementById('s-amount').value);}catch(e){notify(e.message);return;}
  if(amount<=0||!label||!F.validDate(date)){notify('Vérifie le montant, la date et le libellé.');return;}
  const catId=document.getElementById('s-cat').value,internalTransfer=document.getElementById('s-transfer').checked;
  if(await mutate(()=>{DB.transactions.push({id:idNew(),seq:nextSeqVal(),amount,date,label,type:newTxType,catId,internalTransfer});if(catId)DB.params.categoryRules[F.norm(label)+'|'+newTxType]=catId;},'Opération ajoutée.')){document.getElementById('s-amount').value='';document.getElementById('s-label').value='';document.getElementById('s-transfer').checked=false;}
}
async function delTransaction(id){
  const index=DB.transactions.findIndex(t=>String(t.id)===String(id));if(index<0)return;
  const tx=structuredClone(DB.transactions[index]);const countBefore=DB.transactions.filter(t=>F.signature(t)===F.signature(tx)).length;
  if(await mutate(()=>DB.transactions.splice(index,1))){deletedTx={tx,index,countBefore};clearTimeout(undoTimer);notify('Opération supprimée.',true);undoTimer=setTimeout(()=>{deletedTx=null;document.getElementById('sun-toast').hidden=true;},30000);}
}
async function undoDelete(){
  if(!deletedTx)return;const {tx,index,countBefore}=deletedTx;
  if(DB.transactions.filter(t=>F.signature(t)===F.signature(tx)).length>=countBefore){deletedTx=null;notify('Cette opération a déjà été restaurée.');return;}
  if(await mutate(()=>DB.transactions.splice(index,0,tx),'Suppression annulée.')){deletedTx=null;clearTimeout(undoTimer);}
}
function renderCategories(){
  const el=document.getElementById('sun-budget');if(!el)return;
  const cats=DB.categories.filter(c=>c.type==='dep');
  el.innerHTML=cats.map(c=>{const b=F.budget(DB,c,currentMonth),diff=F.euros(F.cents(b.spent)-F.cents(b.previous));return `<article class="sun-budget"><div class="sun-budget-head"><h3>${esc(c.name)}</h3><button class="sun-link" onclick="budgetEditor(${attr(JSON.stringify(c.id))})">Régler le budget</button></div><div class="sun-budget-head"><span>Dépensé ${money(b.spent)}</span><span class="sun-small">${c.budget>0?'Limite '+money(b.limit):'Sans limite'}</span></div>${c.budget>0?`<div class="sun-progress" role="progressbar" aria-label="Budget ${attr(c.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,Math.round(b.spent/b.limit*100))}"><span style="width:${Math.min(100,b.spent/b.limit*100)}%"></span></div><p class="sun-small">${b.remaining>=0?'Il reste '+money(b.remaining):'Dépassement de '+money(-b.remaining)}${b.carry>0?' · dont '+money(b.carry)+' reportés':''}</p>`:''}<p class="sun-small">${diff>0?'+':'−'}${money(Math.abs(diff))} par rapport au mois précédent</p><button class="sun-link" onclick="viewCategory(${attr(JSON.stringify(c.id))})">Voir les opérations →</button></article>`;}).join('')||'<div class="card empty">Crée tes catégories ci-dessous pour organiser ton budget.</div>';
  document.getElementById('cat-list-dep').innerHTML=cats.map(c=>`<div class="sun-row"><span class="sun-row-main">${esc(c.name)}</span><button class="sun-link" onclick="editCategory(${attr(JSON.stringify(c.id))})">Renommer</button><button class="sun-link" onclick="delCategory(${attr(JSON.stringify(c.id))})">Supprimer</button></div>`).join('');
  document.getElementById('cat-list-rec').innerHTML=DB.categories.filter(c=>c.type==='rec').map(c=>`<div class="sun-row"><span class="sun-row-main">${esc(c.name)}</span><button class="sun-link" onclick="editCategory(${attr(JSON.stringify(c.id))})">Renommer</button><button class="sun-link" onclick="delCategory(${attr(JSON.stringify(c.id))})">Supprimer</button></div>`).join('');
}
function budgetEditor(id){const c=DB.categories.find(c=>c.id===id);if(!c)return;openDialog('Budget · '+c.name,`${field('budget','Limite mensuelle (€) · 0 = aucune',c.budget||0,'number','min="0" step="0.01" required')}<label class="sun-checkbox"><input type="checkbox" name="rollover" ${c.rollover?'checked':''}>Reporter le budget non dépensé</label>${field('start','Début du report',c.rolloverStart||currentMonth,'month','required')}<p class="sun-small">Le surplus positif se reporte. Un dépassement ne crée pas de dette sur le mois suivant. Modifier la limite recalcule les reports depuis cette date.</p>`,async d=>{const n=amountValue(d.get('budget')),start=d.get('start');if(n<0||!/^\d{4}-\d{2}$/.test(start)||!F.validDate(start+'-01'))throw Error('Budget ou période invalide.');if(await mutate(()=>Object.assign(DB.categories.find(v=>v.id===id),{budget:n,rollover:d.has('rollover')&&n>0,rolloverStart:start}),'Budget mis à jour.'))closeDialog();});}
function viewCategory(id){showView('operations');document.getElementById('h-period').value='month';document.getElementById('h-cat').value=id;renderHistorique();}
async function addCategory(){const name=document.getElementById('nc-name').value.trim(),type=document.getElementById('nc-type').value,color=document.getElementById('nc-color').value;let budget;try{budget=amountValue(document.getElementById('nc-budget').value||0);}catch(e){notify(e.message);return;}if(!name||budget<0){notify('Vérifie le nom et le budget.');return;}if(await mutate(()=>DB.categories.push({id:idNew(),name,type,color,budget}),'Catégorie ajoutée.')){document.getElementById('nc-name').value='';document.getElementById('nc-budget').value='';}}
async function editCategory(id){const c=DB.categories.find(c=>c.id===id);if(!c)return;openDialog('Renommer la catégorie',field('name','Nom',c.name,'text','required'),async d=>{const name=d.get('name').trim();if(!name)throw Error('Nom requis.');if(await mutate(()=>DB.categories.find(v=>v.id===id).name=name,'Catégorie renommée.'))closeDialog();});}
async function delCategory(id){if(!confirm('Supprimer la catégorie ? Les opérations seront conservées sans catégorie.'))return;await mutate(()=>{DB.categories=DB.categories.filter(c=>c.id!==id);DB.transactions.forEach(t=>{if(t.catId===id)t.catId='';});Object.keys(DB.params.categoryRules).forEach(k=>{if(DB.params.categoryRules[k]===id)delete DB.params.categoryRules[k];});},'Catégorie supprimée.');}
async function updateBudget(id,val){const c=DB.categories.find(c=>c.id===id);if(c)await mutate(()=>DB.categories.find(v=>v.id===id).budget=amountValue(val),'Budget mis à jour.');}
function scheduleEditor(id){
  const s=DB.params.schedules.find(s=>s.id===id)||F.recurrenceCandidates(DB).find(s=>s.id===id)||{label:'',amount:'',date:F.today(),type:'dep',cadence:'monthly',confirmed:true};
  openDialog(id?'Ajuster la prévision':'Prévoir un mouvement',`${field('label','Libellé',s.label,'text','required')}${field('amount','Montant (€)',s.amount,'text','required inputmode="decimal"')}${field('date','Prochaine date',s.date,'date','required')}<label>Type<select name="type"><option value="dep" ${s.type==='dep'?'selected':''}>Paiement</option><option value="rec" ${s.type==='rec'?'selected':''}>Rentrée</option></select></label><label>Fréquence<select name="cadence"><option value="monthly" ${s.cadence==='monthly'?'selected':''}>Mensuelle</option><option value="once" ${s.cadence==='once'?'selected':''}>Une seule fois</option><option value="interval" ${s.cadence==='interval'?'selected':''}>Tous les N jours</option></select></label>${field('interval','N jours (si nécessaire)',s.interval||30,'number','min="1" max="365"')}<label class="sun-checkbox"><input type="checkbox" name="confirmed" ${s.confirmed?'checked':''}>Date et montant confirmés par moi</label>`,async d=>{
    const amount=amountValue(d.get('amount')),date=d.get('date'),label=d.get('label').trim(),interval=Number(d.get('interval'));
    if(amount<=0||!F.validDate(date)||!label||interval<1||interval>365)throw Error('Vérifie les informations.');
    const value={id:s.auto?idNew():s.id||idNew(),label,amount,date,type:d.get('type'),cadence:d.get('cadence'),interval,day:Number(date.slice(-2)),confirmed:d.has('confirmed'),autoKey:s.auto?s.id:s.autoKey};
    if(await mutate(()=>{const i=DB.params.schedules.findIndex(v=>v.id===value.id);if(i<0)DB.params.schedules.push(value);else DB.params.schedules[i]=value;},'Prévision enregistrée.'))closeDialog();
  });
}
async function ignoreSchedule(id){await mutate(()=>{if(id.startsWith('auto:'))DB.params.ignoredRecurrences.push(id);else{const s=DB.params.schedules.find(s=>s.id===id);if(s?.autoKey)DB.params.ignoredRecurrences.push(s.autoKey);DB.params.schedules=DB.params.schedules.filter(s=>s.id!==id);}},'Prévision retirée.');}
async function handleEvent(eventId){await mutate(()=>DB.params.handledEvents.push(eventId),'Cette échéance ne sera plus comptée dans les prévisions.');}
function renderCalendar(){
  const el=document.getElementById('sun-calendar');if(!el)return;
  const start=currentMonth+'-01',end=F.shift(F.monthShift(start,1,1),-1),events=F.scheduleEvents(DB,start,end),txs=DB.transactions.filter(t=>t.date>=start&&t.date<=end);
  if(!selectedCalendarDate.startsWith(currentMonth))selectedCalendarDate=start;
  const offset=(new Date(start+'T12:00:00').getDay()+6)%7;
  let html='<div class="sun-section"><h2>'+esc(formatMonth(currentMonth))+'</h2><button class="sun-link" onclick="openMonthPicker()">Changer</button></div><div class="sun-calendar">'+['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(x=>'<div class="sun-calendar-day">'+x+'</div>').join('')+'<div aria-hidden="true" style="grid-column:span '+(offset||1)+';'+(!offset?'display:none':'')+'"></div>';
  for(let d=1;d<=Number(end.slice(-2));d++){const date=currentMonth+'-'+String(d).padStart(2,'0'),count=events.filter(e=>e.date===date).length+txs.filter(t=>t.date===date).length;html+=`<button class="sun-calendar-cell ${count?'has-event':''} ${date===F.today()?'today':''} ${date===selectedCalendarDate?'selected':''}" onclick="selectCalendar('${date}')" aria-label="${fdate(date)}, ${count} mouvement(s)" aria-pressed="${date===selectedCalendarDate}">${d}${count?'<small>'+count+' mouv.</small>':''}</button>`;}
  el.innerHTML=html+'</div>';
  const detail=document.getElementById('sun-calendar-detail');
  detail.innerHTML='<div class="sun-section"><h2>'+fdate(selectedCalendarDate)+'</h2></div>'+txs.filter(t=>t.date===selectedCalendarDate).map(t=>eventRow({...t,confirmed:true})).join('')+events.filter(e=>e.date===selectedCalendarDate).map(e=>eventRow(e)+`<div class="sun-actions"><button class="sun-link" onclick="scheduleEditor(${attr(JSON.stringify(e.id))})">Confirmer / modifier</button><button class="sun-link" onclick="handleEvent(${attr(JSON.stringify(e.eventId))})">Déjà passé / ignorer cette fois</button></div>`).join('');
  if(!txs.some(t=>t.date===selectedCalendarDate)&&!events.some(e=>e.date===selectedCalendarDate))detail.innerHTML+='<div class="empty">Aucun mouvement ce jour.</div>';
  const projected=calendarBalance(selectedCalendarDate);detail.innerHTML+=`<div class="sun-note">${selectedCalendarDate>F.today()?'Solde prévu':'Solde reconstitué'} à la fin de la journée : ${money(projected)}${projected<0?' · Le compte pourrait être à découvert.':''}<p class="sun-small">${selectedCalendarDate>F.today()?'Hors dépenses variables non encore saisies. Les prévisions estimées sont incluses.':'D’après les opérations enregistrées et ton dernier solde vérifié.'}</p></div>`;
  const all=[...DB.params.schedules,...F.recurrenceCandidates(DB)];
  document.getElementById('sun-schedule-list').innerHTML=`<div class="card"><div class="sun-section"><h2>Mes prévisions</h2></div>${all.map(s=>`<div class="sun-row"><div class="sun-row-main"><p>${esc(s.label)}</p><span class="sun-small">${s.confirmed?'Confirmé':'Détecté automatiquement'} · ${money(s.amount)} · ${s.cadence==='monthly'?'Mensuel':s.cadence==='once'?'Ponctuel':'Tous les '+s.interval+' jours'}</span></div><button class="sun-link" onclick="scheduleEditor(${attr(JSON.stringify(s.id))})">Modifier</button><button class="sun-link" onclick="ignoreSchedule(${attr(JSON.stringify(s.id))})">Retirer</button></div>`).join('')||'<div class="empty">Ajoute une prévision ou importe ton historique.</div>'}<button class="sun-link" onclick="resetIgnored()">Réafficher les détections ignorées</button></div>`;
}
function selectCalendar(date){selectedCalendarDate=date;renderCalendar();}
function calendarBalance(date){
  if(date<=F.today())return F.balance(DB,date);
  const events=F.scheduleEvents(DB,F.today(),date);
  const future=DB.transactions.filter(t=>t.date>F.today()&&t.date<=date);
  return F.euros(F.cents(F.balance(DB))+events.reduce((s,e)=>s+F.signed(e),0)+future.reduce((s,t)=>s+F.signed(t),0));
}
async function resetIgnored(){await mutate(()=>DB.params.ignoredRecurrences=[],'Détections réaffichées.');}
function goalEditor(id){const g=DB.params.goals.find(g=>g.id===id)||{name:'',target:'',saved:0,monthly:0};openDialog('Objectif d’épargne',`${field('name','Nom de l’objectif',g.name,'text','required')}${field('target','Montant cible (€)',g.target,'number','min="0.01" step="0.01" required')}${field('saved','Déjà mis de côté (€)',g.saved,'number','min="0" step="0.01" required')}${field('monthly','À mettre de côté chaque mois (€) · facultatif',g.monthly||0,'number','min="0" step="0.01"')}<p class="sun-small">Ce suivi ne crée aucun virement et ne modifie pas ton solde.</p>`,async d=>{const name=d.get('name').trim(),target=amountValue(d.get('target')),saved=amountValue(d.get('saved')),monthly=amountValue(d.get('monthly'));if(!name||target<=0||saved<0||monthly<0)throw Error('Vérifie les montants.');if(await mutate(()=>{const value={id:id||idNew(),name,target,saved,monthly};const i=DB.params.goals.findIndex(g=>g.id===id);if(i<0)DB.params.goals.push(value);else DB.params.goals[i]=value;},'Objectif enregistré.'))closeDialog();});}
async function delGoal(id){if(confirm('Supprimer cet objectif ?'))await mutate(()=>DB.params.goals=DB.params.goals.filter(g=>g.id!==id),'Objectif supprimé.');}
function renderSavings(){const el=document.getElementById('sun-goals');if(!el)return;el.innerHTML=DB.params.goals.map(g=>`<article class="sun-budget"><div class="sun-budget-head"><h3>${esc(g.name)}</h3><button class="sun-link" onclick="goalEditor(${attr(JSON.stringify(g.id))})">Modifier</button></div><p>${money(g.saved)} sur ${money(g.target)}</p><div class="sun-progress" role="progressbar" aria-label="Objectif ${attr(g.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,Math.round(g.saved/g.target*100))}"><span style="width:${Math.min(100,g.saved/g.target*100)}%"></span></div><p class="sun-small">${g.saved>=g.target?'Objectif atteint ♡':g.monthly>0?'Environ '+Math.ceil((F.cents(g.target)-F.cents(g.saved))/F.cents(g.monthly))+' mois à '+money(g.monthly)+'/mois':'À ton rythme'}</p><button class="sun-link" onclick="delGoal(${attr(JSON.stringify(g.id))})">Supprimer</button></article>`).join('')||'<div class="card empty">Un projet en tête ? Crée ton premier objectif.</div>';const txs=monthTx().filter(t=>t.internalTransfer);const out=txs.filter(t=>t.type==='dep').reduce((s,t)=>s+F.cents(t.amount),0),back=txs.filter(t=>t.type==='rec').reduce((s,t)=>s+F.cents(t.amount),0);document.getElementById('sun-transfers').innerHTML=`<div class="sun-section"><h2>Virements entre tes comptes</h2></div><p>Sorties ${money(F.euros(out))} · retours ${money(F.euros(back))}</p><p class="sun-small">Ces mouvements changent le compte courant, mais sont exclus des revenus et dépenses. Tous ne sont pas forcément de l’épargne.</p><button class="sun-link" onclick="showView('operations')">Classer mes virements →</button>`;}
function refundEditor(id){const r=DB.params.refunds.find(r=>r.id===id)||{label:'',amount:'',date:F.today()};openDialog('Remboursement attendu',`${field('label','De qui / pour quoi ?',r.label,'text','required')}${field('amount','Montant attendu (€)',r.amount,'number','min="0.01" step="0.01" required')}${field('date','Date attendue',r.date,'date','required')}<p class="sun-small">Ce rappel ne modifie pas le solde et n’entre pas automatiquement dans la projection. Quand le remboursement arrive, enregistre ou importe la rentrée puis marque ce rappel reçu.</p>`,async d=>{const amount=amountValue(d.get('amount')),date=d.get('date'),label=d.get('label').trim();if(amount<=0||!F.validDate(date)||!label)throw Error('Vérifie les informations.');if(await mutate(()=>{const value={id:id||idNew(),label,amount,date,received:false};const i=DB.params.refunds.findIndex(r=>r.id===id);if(i<0)DB.params.refunds.push(value);else DB.params.refunds[i]=value;},'Remboursement suivi.'))closeDialog();});}
async function markRefund(id){await mutate(()=>{const r=DB.params.refunds.find(r=>r.id===id);if(r)r.received=true;},'Rappel marqué reçu.');}
async function delRefund(id){await mutate(()=>DB.params.refunds=DB.params.refunds.filter(r=>r.id!==id),'Rappel supprimé.');}
function renderRefunds(){const el=document.getElementById('sun-refunds');if(!el)return;const rs=DB.params.refunds.filter(r=>!r.received);el.innerHTML=rs.length?'<div class="card"><div class="sun-section"><h2>Remboursements attendus</h2></div>'+rs.map(r=>`<div class="sun-row"><div class="sun-row-main"><p>${esc(r.label)} · ${money(r.amount)}</p><span class="sun-small">${fdate(r.date)}${r.date<F.today()?' · À relancer':''}</span></div><button class="sun-link" onclick="markRefund(${attr(JSON.stringify(r.id))})">Reçu</button><button class="sun-link" onclick="refundEditor(${attr(JSON.stringify(r.id))})">Modifier</button><button class="sun-link" aria-label="Supprimer ce rappel" onclick="delRefund(${attr(JSON.stringify(r.id))})">×</button></div>`).join('')+'</div>':'';}
function renderReport(){const el=document.getElementById('sun-report');if(!el)return;const t=monthTx(),sum=totals(t),previous=totals(monthTx(prevMonth(currentMonth)));const grouped={};t.filter(t=>t.type==='dep'&&!t.internalTransfer).forEach(t=>{const name=DB.categories.find(c=>c.id===t.catId)?.name||'Sans catégorie';grouped[name]=(grouped[name]||0)+F.cents(t.amount);});el.innerHTML=`<div class="card"><div class="sun-section"><h2>${esc(formatMonth(currentMonth))}</h2><button class="sun-link" onclick="openMonthPicker()">Changer</button></div><div class="sun-monthly"><div><span class="sun-small">Rentrées</span><strong>${money(sum.rec)}</strong></div><div><span class="sun-small">Dépenses</span><strong>${money(sum.dep)}</strong></div><div><span class="sun-small">Rentrées − dépenses</span><strong>${money(F.euros(F.cents(sum.rec)-F.cents(sum.dep)))}</strong></div></div><p class="sun-sub" style="margin:18px 0">Dépenses : ${money(sum.dep-previous.dep)} par rapport au mois précédent. ${currentMonth===F.today().slice(0,7)?'Mois en cours, comparaison provisoire.':''}</p>${Object.entries(grouped).sort((a,b)=>b[1]-a[1]).map(([name,n])=>`<div class="sun-row"><span class="sun-row-main">${esc(name)}</span><strong>${money(F.euros(n))}</strong></div>`).join('')||'<div class="empty">Pas encore de dépenses.</div>'}<p class="sun-small" style="margin-top:16px">Les virements internes sont exclus. Le montant restant n’est pas nécessairement de l’épargne disponible.</p></div>`;}
function exportBackup(){const blob=new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),data:DB},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ma-banque-sauvegarde-'+F.today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Sauvegarde téléchargée.');}

/* Import LCL : conserver chaque ligne, utiliser la date d'opération et contrôler le relevé. */
function parseStatement(items){
  const rows=[];
  [...items].sort((a,b)=>a.page-b.page||a.y-b.y||a.x-b.x).forEach(it=>{if(!it.str.trim())return;let row=rows.find(r=>r.page===it.page&&Math.abs(r.y-it.y)<=3);if(!row){row={page:it.page,y:it.y,items:[]};rows.push(row);}row.items.push(it);});
  rows.forEach(r=>{r.items.sort((a,b)=>a.x-b.x);r.text=r.items.map(i=>i.str).join(' ');});
  const all=rows.map(r=>r.text).join('\n');
  const period=all.match(/du\s+(\d{2})\.(\d{2})\.(\d{4})\s+au\s+(\d{2})\.(\d{2})\.(\d{4})/i);
  const start=period?`${period[3]}-${period[2]}-${period[1]}`:null,end=period?`${period[6]}-${period[5]}-${period[4]}`:null;
  const parseAmt=s=>Number(s.replace(/[\s\u00a0]/g,'').replace(',','.'));
  const amounts=r=>r.items.filter(i=>i.x>=410&&/^\d[\d\s]*[,\.]\d{2}$/.test(i.str.trim()));
  function getBalance(re){const row=rows.find(r=>re.test(r.text));if(!row)return null;const vals=amounts(row);if(!vals.length)return null;const v=vals.at(-1);return (v.x<490?-1:1)*parseAmt(v.str);}
  const opening=getBalance(/ANCIEN\s+SOLDE/i),closing=getBalance(/SOLDE\s+EN\s+EUROS/i);
  const results=[];
  rows.forEach((r,index)=>{
    const date=r.items.filter(i=>i.x<70).map(i=>i.str).join('').trim();
    const value=r.items.filter(i=>i.x>=340&&i.x<410).map(i=>i.str).join('').trim();
    if(!/^\d{2}\.\d{2}$/.test(date)||!/^\d{2}\.\d{2}\.\d{2}$/.test(value))return;
    const label=r.items.filter(i=>i.x>=70&&i.x<340).map(i=>i.str).join(' ').trim();
    if(!label||/ancien\s+solde|solde\s+(en|interm)|totaux/i.test(label))return;
    const year=end?Number(end.slice(0,4)):2000+Number(value.slice(-2));const [day,month]=date.split('.');
    let iso=`${year}-${month}-${day}`;if(start&&iso>end)iso=`${year-1}-${month}-${day}`;
    const debit=r.items.filter(i=>i.x>=410&&i.x<490).map(i=>i.str).join('').replace(/\s/g,'').replace(/^\./,'');
    const credit=r.items.filter(i=>i.x>=490).map(i=>i.str).join('').replace(/\s/g,'').replace(/^\./,'');
    const d=/^\d+[,.]\d{2}$/.test(debit)?parseAmt(debit):0,c=/^\d+[,.]\d{2}$/.test(credit)?parseAmt(credit):0;
    if(!d&&!c)return;
    let continuation='';for(let j=index+1;j<rows.length&&rows[j].page===r.page;j++){if(rows[j].items.some(i=>i.x<70&&/^\d{2}\.\d{2}$/.test(i.str)))break;continuation+=' '+rows[j].text;}
    const mandate=continuation.match(/REF\.MANDAT:\s*(\S+)/i)?.[1]||'';
    const push=(amount,type)=>{const tx={date:iso,label,amount:F.euros(F.cents(amount)),type,catId:'',sourceLine:`${r.page}:${r.y}:${type}`,recurrenceKey:mandate||undefined};const known=DB.params.categoryRules?.[F.norm(label)+'|'+type];const match=DB.transactions.find(t=>t.type===type&&F.norm(t.label)===F.norm(label)&&t.catId);tx.catId=known||match?.catId||'';results.push(tx);};
    if(d)push(d,'dep');if(c)push(c,'rec');
  });
  const account=all.match(/Compte\s*:\s*(\d+\s*[A-Z])/i)?.[1]?.replace(/\s/g,'')||'LCL';
  return {rows:results,start,end,opening,closing,key:start&&end?account+'|'+start+'|'+end:null};
}
parseLCLByCoords=function(items){return parseStatement(items).rows;};
async function handlePDF(file){
  if(!file)return;const status=document.getElementById('sun-import-check');status.innerHTML='<div class="sun-note">Lecture du relevé…</div>';
  document.getElementById('import-results').style.display='none';
  try{
    const bytes=new Uint8Array(await file.arrayBuffer());const digest=await crypto.subtle.digest('SHA-256',bytes);const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const pdf=await pdfjsLib.getDocument({data:bytes}).promise,items=[];
    try{for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p),vp=page.getViewport({scale:1}),text=await page.getTextContent();text.items.forEach(i=>items.push({x:Math.round(i.transform[4]),y:Math.round(vp.height-i.transform[5]),str:i.str.trim(),page:p}));}}finally{await pdf.destroy();}
    const result=parseStatement(items);currentImport={...result,hash,name:file.name};parsedLines=F.missingRows(DB.transactions,result.rows).map(t=>({...t,selected:!t.alreadyPresent}));renderImportTable();
  }catch(e){currentImport=null;parsedLines=[];status.innerHTML='<div class="alert-b red">Lecture impossible. Réessaie avec le PDF original de ton relevé.</div>';console.error(e);}
  document.getElementById('file-input').value='';
}
const originalHandleImage=handleImage;
handleImage=async function(file){currentImport=null;await originalHandleImage(file);};
function importCheck(){
  if(!currentImport)return null;
  if(currentImport.opening===null||currentImport.closing===null)return {ok:false,missing:true};
  if(parsedLines.some(t=>!F.validDate(t.date)||!Number.isFinite(Number(t.amount))||t.amount<=0||t.date<currentImport.start||t.date>currentImport.end))return {ok:false,invalid:true};
  return F.statementCheck(parsedLines,currentImport.opening,currentImport.closing);
}
function renderImportStatus(){const el=document.getElementById('sun-import-check');if(!el)return;const check=importCheck(),duplicate=parsedLines.filter(t=>t.alreadyPresent).length;
  if(!currentImport){el.innerHTML='<div class="sun-note">Import d’image : solde du relevé non vérifié. Vérifie chaque opération et ton solde bancaire après import.</div>';return;}
  el.innerHTML=`<div class="card"><div class="sun-section"><h2>${currentImport.start?fdate(currentImport.start)+' → '+fdate(currentImport.end):'Relevé à vérifier'}</h2></div><p>Solde de départ ${money(currentImport.opening)} · solde final ${money(currentImport.closing)}</p><p class="${check?.ok?'sun-small':'sun-error'}">${check?.ok?'✓ Les opérations correspondent exactement au solde du relevé.':check?.missing?'Solde non reconnu : import bloqué.':check?.invalid?'Une opération est invalide ou hors de la période du relevé.':'Écart de '+(check?money(check.gap):'—')+' : corrige les opérations avant de valider.'}</p><p class="sun-small">${parsedLines.length} opérations · ${duplicate} occurrence(s) déjà présente(s), décochée(s). Les paiements répétés sur le relevé sont conservés.</p></div>`;
  document.querySelector('#import-results .btn.green').disabled=!check?.ok;
}
function renderImportTable(){
  parsedLines=F.missingRows(DB.transactions,parsedLines).map(t=>({...t,selected:t.selected??!t.alreadyPresent}));
  const body=document.getElementById('import-tbody');
  body.innerHTML=parsedLines.map((t,i)=>`<tr><td><input type="checkbox" class="import-chk" ${t.selected?'checked':''} data-i="${i}" onchange="parsedLines[${i}].selected=this.checked" aria-label="Importer la ligne ${i+1}">${t.alreadyPresent?'<span class="sun-badge">Présente</span>':''}</td><td><input class="sun-import-editor" type="date" value="${attr(t.date)}" onchange="changeImport(${i},'date',this.value)" aria-label="Date ligne ${i+1}"></td><td><input class="sun-import-editor sun-import-label" value="${attr(t.label)}" onchange="changeImport(${i},'label',this.value)" aria-label="Libellé ligne ${i+1}"></td><td><input class="sun-import-editor" type="number" step="0.01" min="0.01" value="${t.amount}" onchange="changeImport(${i},'amount',this.value)" aria-label="Montant ligne ${i+1}"><select class="sun-import-editor" onchange="changeImport(${i},'type',this.value)" aria-label="Type ligne ${i+1}"><option value="dep" ${t.type==='dep'?'selected':''}>Dépense</option><option value="rec" ${t.type==='rec'?'selected':''}>Rentrée</option></select></td><td><select class="sun-import-editor" onchange="parsedLines[${i}].catId=this.value" aria-label="Catégorie ligne ${i+1}">${categoryOptions(t.catId,t.type)}</select><label class="sun-small"><input type="checkbox" ${t.internalTransfer?'checked':''} onchange="parsedLines[${i}].internalTransfer=this.checked"> Interne</label></td></tr>`).join('')||'<tr><td colspan="5">Aucune opération reconnue.</td></tr>';
  document.getElementById('import-results').style.display='block';renderImportStatus();
}
function changeImport(i,key,value){parsedLines[i][key]=key==='amount'?Number(value):value;renderImportTable();}
function toggleAllImport(checked){parsedLines.forEach(t=>t.selected=checked);document.querySelectorAll('.import-chk').forEach(c=>c.checked=checked);}
async function doImport(){
  const selected=parsedLines.filter(t=>t.selected);if(!selected.length){notify('Aucune opération cochée.');return;}
  if(selected.some(t=>!F.validDate(t.date)||!t.label.trim()||!Number.isFinite(Number(t.amount))||t.amount<=0)){notify('Une opération est invalide.');return;}
  if(currentImport&&!importCheck()?.ok){notify('Les opérations ne correspondent pas au relevé. Corrige l’écart avant l’import.');return;}
  const fresh=F.missingRows(DB.transactions,parsedLines);
  if(fresh.some(t=>t.selected&&t.alreadyPresent)){notify('Une opération cochée est déjà présente. Décoche-la pour éviter un doublon.');return;}
  const info=currentImport;
  if(await mutate(()=>{
    fresh.filter(t=>t.selected).forEach(t=>{const {selected,alreadyPresent,...row}=t;row.id=idNew();row.seq=nextSeqVal();row.sourceKey=info?.key||info?.hash||'image';DB.transactions.push(row);if(row.catId)DB.params.categoryRules[F.norm(row.label)+'|'+row.type]=row.catId;});
    if(info){const stored={key:info.key||info.hash,hash:info.hash,start:info.start,end:info.end,opening:info.opening,closing:info.closing,importedAt:new Date().toISOString()};DB.params.imports=DB.params.imports.filter(i=>i.key!==stored.key);DB.params.imports.push(stored);
      if(!DB.params.balanceAnchor){const before=F.shift(info.start,-1);if(!DB.transactions.some(t=>t.date<info.start))DB.params.balanceAnchor=F.anchor(DB,info.opening,before);}
    }
  },selected.length+' opération(s) importée(s).')){parsedLines=[];currentImport=null;document.getElementById('import-results').style.display='none';document.getElementById('sun-import-check').replaceChildren();showView('operations');}
}

// Les modules sont tous chargés avant que Firebase puisse ouvrir l'application.
if(typeof auth!=='undefined')auth.onAuthStateChanged(u=>{
  if(u){uid=u.uid;loadData();}
  else{uid=null;document.getElementById('loading').style.display='none';document.getElementById('app').classList.remove('on');document.getElementById('login-page').classList.add('on');}
});
