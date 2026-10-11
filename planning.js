/* Enveloppes et arrondis : suivi uniquement, aucun ordre bancaire. */
(function(scope){
'use strict';
const F=scope.Finance;
const envelopes=[['fixed','Charges et abonnements'],['food','Courses'],['transport','Essence, péages et parking'],['tobacco','Tabac'],['pets','Animaux'],['health','Santé'],['gifts','Cadeaux'],['fun','Plaisirs'],['buffer','Imprévus']];
function allocation(db,t){
 if(t.budgetEnvelope&&(t.budgetEnvelope==='unassigned'||envelopes.some(([id])=>id===t.budgetEnvelope)))return t.budgetEnvelope;
 const label=F.norm(t.label),cat=F.norm(db.categories.find(c=>c.id===t.catId)?.name);
 if(/pret|credit|cotisation|assurance|bnp|sfr|netflix|apple|amazon.*digital|openai|chatgpt|anthropic|lsa/.test(label)||/abonnement|telephone|banque/.test(cat))return 'fixed';
 if(/escota|peage|parking|station|totalenergies/.test(label))return 'transport';
 if(/tabac/.test(cat))return 'tobacco';
 if(/anim|veterin/.test(cat)||/maxi.?zoo|argos|veterin/.test(label))return 'pets';
 if(/sante|medical/.test(cat))return 'health';
 if(/cadeau/.test(cat))return 'gifts';
 if(/course|aliment/.test(cat))return 'food';
 if(/voiture|transport|essence/.test(cat))return 'transport';
 if(/beaute|loisir|sortie|maison|shopping|plaisir|restaurant/.test(cat))return 'fun';
 return 'unassigned';
}
function plan(db,month,now=F.today()){
 const p=db.params.monthlyPlan;if(!p||month<p.start)return null;
 const spent=m=>{const out={};db.transactions.filter(t=>t.type==='dep'&&!t.internalTransfer&&t.date.startsWith(m)&&t.date<=now).forEach(t=>{const k=allocation(db,t);out[k]=(out[k]||0)+F.cents(t.amount);});return out;};
 const actual=spent(month);
 const rows=envelopes.map(([id,name])=>{let carry=0;let m=p.start,n=0;
 if(p.rollovers?.includes(id))while(m<month&&n++<240){carry=Math.max(0,carry+F.cents(p.limits[id])- (spent(m)[id]||0));m=F.monthShift(m+'-01',1,1).slice(0,7);}
 const limit=F.cents(p.limits[id])+carry,used=actual[id]||0;return {id,name,limit:F.euros(limit),carry:F.euros(carry),spent:F.euros(used),remaining:F.euros(limit-used)};});
 return {rows,unassigned:F.euros(actual.unassigned||0),allocated:F.euros(envelopes.reduce((s,[id])=>s+F.cents(p.limits[id]),F.cents(p.savings))),income:p.income};
}
function roundup(db,month,now=F.today()){
 const p=db.params.roundups;const cap=F.cents(p?.cap||0);let total=0;
 const rows=[];
 if(p?.enabled)db.transactions.filter(t=>t.type==='dep'&&!t.internalTransfer&&t.amount>0&&t.date>=p.start&&t.date.startsWith(month)&&t.date<=now).sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id))).forEach(t=>{const amount=F.cents(t.amount),raw=(100-amount%100)%100,add=Math.min(raw,Math.max(0,cap-total));total+=add;if(add)rows.push({id:t.id,label:t.label,date:t.date,amount:F.euros(add)});});
 const transferred=F.cents(p?.transferred?.[month]||0);
 return {total:F.euros(total),cap:F.euros(cap),remaining:F.euros(Math.max(0,total-transferred)),transferred:F.euros(transferred),rows};
}
const P={envelopes,allocation,plan,roundup};scope.Planning=P;
if(typeof module!=='undefined')module.exports=P;
if(typeof document==='undefined')return;
function ensure(id,before){let el=document.getElementById(id);if(!el){el=document.createElement('div');el.id=id;document.getElementById(before).before(el);}return el;}
scope.renderPlanning=function(){
 const p=plan(DB,currentMonth),settings=DB.params.monthlyPlan;
 ensure('sun-plan','sun-budget').innerHTML=`<div class="card"><div class="sun-section"><h2>Mon budget mensuel</h2><button class="sun-link" onclick="planEditor()">${settings?'Ajuster':'Définir mon budget'}</button></div>${p?`<p>Revenus de référence ${money(p.income)} · Réparti ${money(p.allocated)}</p><p class="sun-small">Épargne prévue ${money(settings.savings)} · les arrondis sont inclus dans cette somme.</p>${p.rows.map(r=>`<div class="sun-row"><div class="sun-row-main"><p>${r.name}</p><span class="sun-small">${money(r.spent)} dépensés sur ${money(r.limit)}${r.carry?' · report '+money(r.carry):''}</span></div><strong>${money(r.remaining)}</strong></div>`).join('')}<p class="sun-small">${money(p.unassigned)} à classer. Les réserves non dépensées restent affectées à leur enveloppe.</p><button class="sun-link" onclick="allocationEditor()">Vérifier la répartition des opérations</button><p class="sun-small">Les charges fixes sont séparées des dépenses de voiture du quotidien. La marge Imprévus peut compléter l’épargne en fin de mois, après vérification des paiements restants.</p>`:`<p class="sun-small">${settings?'Ton plan commence en '+esc(settings.start)+'.':'Répartis tes revenus entre dépenses, réserves et épargne.'}</p>`}</div>`;
 const r=roundup(DB,currentMonth);
 ensure('sun-roundups','sun-goals').innerHTML=`<div class="card"><div class="sun-section"><h2>Ma tirelire d’arrondis ♡</h2><button class="sun-link" onclick="roundupEditor()">Réglages</button></div><p class="sun-value">${money(r.total)}</p><p>À l’euro supérieur · plafond ${money(r.cap)} par mois</p><p class="sun-small">${DB.params.roundups?.enabled?'Activée depuis le '+fdate(DB.params.roundups.start):'Désactivée'} · dépenses enregistrées uniquement, virements internes exclus. Un montant entier ne produit pas d’arrondi.</p><p>Reste à virer : ${money(r.remaining)}</p><p class="sun-small">${money(r.transferred)} déclarés virés ce mois. Cette tirelire est un calcul : l’argent reste sur ton compte jusqu’à ton virement dans ta banque. Elle ne modifie pas ton solde et ne crée aucune opération.</p><button class="btn" onclick="roundupTransferEditor()">Noter un virement déjà effectué</button><details><summary>Voir les arrondis (${r.rows.length})</summary>${r.rows.map(t=>`<div class="sun-row"><span class="sun-row-main">${esc(t.label)} · ${fdate(t.date)}</span>${money(t.amount)}</div>`).join('')}</details></div>`;
};
scope.planEditor=function(){const p=DB.params.monthlyPlan||{income:0,start:F.monthShift(F.today(),1,1).slice(0,7),savings:20,limits:{},rollovers:['pets','health','gifts']};
 openDialog('Mon budget mensuel',`${field('income','Revenus mensuels réguliers (€)',p.income,'number','min="0" step="0.01" required')}${field('start','Premier mois',p.start,'month','required')}${envelopes.map(([id,name])=>field(id,name+' (€)',p.limits[id]||0,'number','min="0" step="0.01" required')).join('')}${field('savings','Épargne mensuelle, arrondis inclus (€)',p.savings,'number','min="0" step="0.01" required')}${['pets','health','gifts'].map(id=>`<label class="sun-checkbox"><input name="roll-${id}" type="checkbox" ${p.rollovers.includes(id)?'checked':''}>Reporter la réserve ${envelopes.find(e=>e[0]===id)[1]}</label>`).join('')}<p class="sun-small">Les revenus occasionnels ne sont pas inclus. Les dépenses sont réparties automatiquement ; tu peux corriger chaque opération. Les reports positifs sont recalculés depuis le premier mois si tu modifies les montants.</p>`,async d=>{const limits=Object.fromEntries(envelopes.map(([id])=>[id,amountValue(d.get(id))]));const income=amountValue(d.get('income')),savings=amountValue(d.get('savings')),start=d.get('start');if(!F.validDate(start+'-01')||[income,savings,...Object.values(limits)].some(n=>n<0))throw Error('Vérifie les montants et le mois.');if(envelopes.reduce((s,[id])=>s+F.cents(limits[id]),F.cents(savings))!==F.cents(income))throw Error('La somme des enveloppes et de l’épargne doit être égale aux revenus.');if(DB.params.roundups?.enabled&&DB.params.roundups.cap>savings)throw Error('Le plafond des arrondis doit rester dans ton budget épargne.');if(await mutate(()=>DB.params.monthlyPlan={income,savings,start,limits,rollovers:['pets','health','gifts'].filter(id=>d.has('roll-'+id))},'Budget enregistré.'))closeDialog();});};
scope.roundupEditor=function(){const p=DB.params.roundups||{enabled:true,cap:20,start:F.today()};openDialog('Mes arrondis',`<label class="sun-checkbox"><input name="enabled" type="checkbox" ${p.enabled?'checked':''}>Activer les arrondis à l’euro supérieur</label>${field('cap','Plafond mensuel (€)',p.cap,'number','min="0" step="0.01" required')}${field('start','Commencer le',p.start,'date','required')}<p class="sun-small">48,30 € → 0,70 € · 48 € → 0 €. Le plafond fait partie de l’épargne prévue, sans supplément. Aucun virement automatique.</p>`,async d=>{const cap=amountValue(d.get('cap')),start=d.get('start');if(cap<0||!F.validDate(start))throw Error('Vérifie les réglages.');if(d.has('enabled')&&DB.params.monthlyPlan&&cap>DB.params.monthlyPlan.savings)throw Error('Le plafond dépasse le budget épargne.');if(await mutate(()=>DB.params.roundups={...DB.params.roundups,enabled:d.has('enabled'),cap,start},'Arrondis enregistrés.'))closeDialog();});};
scope.roundupTransferEditor=function(){const r=roundup(DB,currentMonth);openDialog('Virement déjà effectué',`${field('amount','Total déjà viré pour les arrondis de ce mois (€)',r.transferred,'number','min="0" step="0.01" required')}<p class="sun-small">À remplir après ton virement dans ta banque. Ce suivi ne remplace pas l’import ou la saisie du véritable virement interne.</p>`,async d=>{const amount=amountValue(d.get('amount'));if(amount<0)throw Error('Montant invalide.');if(await mutate(()=>{DB.params.roundups||={enabled:false,cap:20,start:F.today()};DB.params.roundups.transferred||={};DB.params.roundups.transferred[currentMonth]=amount;},'Virement noté dans la tirelire.'))closeDialog();});};
scope.allocationEditor=function(){const txs=DB.transactions.filter(t=>t.type==='dep'&&!t.internalTransfer&&t.date.startsWith(currentMonth)&&t.date<=F.today());openDialog('Répartition · '+formatMonth(currentMonth),txs.map((t,i)=>`<label>${esc(t.label)} · ${money(t.amount)}<select name="tx-${i}"><option value="unassigned">À classer</option>${envelopes.map(([id,name])=>`<option value="${id}" ${allocation(DB,t)===id?'selected':''}>${name}</option>`).join('')}</select></label>`).join('')||'<p>Aucune dépense ce mois.</p>',async d=>{if(await mutate(()=>txs.forEach((t,i)=>{const current=DB.transactions.find(v=>String(v.id)===String(t.id));if(current)current.budgetEnvelope=d.get('tx-'+i);}), 'Répartition enregistrée.'))closeDialog();});};
})(typeof window!=='undefined'?window:globalThis);
