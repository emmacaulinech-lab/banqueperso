/* Calculs monétaires indépendants de l'interface. Montants calculés en centimes. */
(function (scope) {
  'use strict';
  const cents = n => Math.round(Number(n || 0) * 100);
  const euros = n => n / 100;
  const signed = t => (t.type === 'rec' ? 1 : -1) * cents(t.amount);
  const iso = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const today = () => iso(new Date());
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && iso(new Date(s+'T12:00:00')) === s;
  const shift = (s,days) => { const d=new Date(s+'T12:00:00'); d.setDate(d.getDate()+days); return iso(d); };
  const monthShift = (s,n,day) => {const d=new Date(s+'T12:00:00');const y=d.getFullYear(),m=d.getMonth()+n;const last=new Date(y,m+1,0).getDate();return iso(new Date(y,m,Math.min(day || d.getDate(),last),12));};
  const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?/g,'').replace(/\s+/g,' ').trim();
  const signature = t => JSON.stringify([t.date,norm(t.label),t.type,cents(t.amount)]);
  function balance(db,date=today()) {
    const a=db.params.balanceAnchor;
    if(!a) return euros(cents(db.params.soldeInitial)+db.transactions.filter(t=>t.date<=date).reduce((s,t)=>s+signed(t),0));
    const ids=new Set(a.sameDayIds||[]);
    if(date>=a.date) return euros(cents(a.amount)+db.transactions.filter(t=>t.date<=date&&(t.date>a.date||(t.date===a.date&&!ids.has(String(t.id))))).reduce((s,t)=>s+signed(t),0));
    return euros(cents(a.amount)-db.transactions.filter(t=>t.date>date&&(t.date<a.date||(t.date===a.date&&ids.has(String(t.id))))).reduce((s,t)=>s+signed(t),0));
  }
  function anchor(db,amount,date) {
    if(!Number.isFinite(Number(amount))||!validDate(date)) throw Error('Solde ou date invalide');
    return {amount:euros(cents(amount)),date,sameDayIds:db.transactions.filter(t=>t.date===date).map(t=>String(t.id)),verifiedAt:new Date().toISOString()};
  }
  function missingRows(existing,rows) {
    // Comparer les nombres d'occurrences : deux paiements identiques restent deux paiements.
    const counts=new Map();existing.forEach(t=>{const k=signature(t);counts.set(k,(counts.get(k)||0)+1);});
    const seen=new Map();return rows.map(t=>{const k=signature(t),n=(seen.get(k)||0)+1;seen.set(k,n);return {...t,alreadyPresent:n<=(counts.get(k)||0)};});
  }
  function statementCheck(rows,opening,closing) {
    const delta=rows.reduce((s,t)=>s+signed(t),0);
    const expected=cents(closing)-cents(opening);
    return {ok:delta===expected,delta:euros(delta),expected:euros(expected),gap:euros(delta-expected)};
  }
  function recurrenceCandidates(db,now=today()) {
    const groups=new Map();
    db.transactions.filter(t=>t.date<=now&&!t.internalTransfer).forEach(t=>{
      const merchant=norm(t.label).replace(/\d{4,}/g,'').replace(/\s+/g,' ').trim();
      const key=JSON.stringify([merchant,t.type,t.recurrenceKey || Math.round(cents(t.amount)/100)]);
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);
    });
    const out=[];
    groups.forEach((txs,key)=>{
      const sorted=txs.sort((a,b)=>a.date.localeCompare(b.date));
      const dates=[...new Set(sorted.map(t=>t.date))];
      if(dates.length<2)return;
      const intervals=dates.slice(1).map((d,i)=>Math.round((new Date(d+'T12:00:00')-new Date(dates[i]+'T12:00:00'))/86400000));
      const avg=intervals.reduce((s,n)=>s+n,0)/intervals.length;
      const spread=Math.sqrt(intervals.reduce((s,n)=>s+(n-avg)**2,0)/intervals.length);
      const monthly=intervals.every(n=>n>=25&&n<=35);
      if(!monthly&&!(avg>=6&&avg<=95&&spread<=3))return;
      const last=sorted.at(-1);const amount=euros(Math.round(sorted.reduce((s,t)=>s+cents(t.amount),0)/sorted.length));
      const day=Math.round(dates.reduce((s,d)=>s+Number(d.slice(-2)),0)/dates.length);
      const next=monthly?monthShift(last.date,1,day):shift(last.date,Math.round(avg));
      const id='auto:'+key;
      if((db.params.ignoredRecurrences||[]).includes(id))return;
      if((db.params.schedules||[]).some(s=>s.autoKey===id))return;
      out.push({id,label:last.label,type:last.type,amount,date:next,cadence:monthly?'monthly':'interval',interval:Math.round(avg),day,confirmed:false,occurrences:dates.length,auto:true});
    });
    return out;
  }
  function scheduleEvents(db,start,end) {
    const all=[...(db.params.schedules||[]),...recurrenceCandidates(db)];const events=[];
    all.forEach(s=>{
      let date=s.date;let limit=0;
      while(validDate(date)&&date<=end&&limit++<500){
        if(date>=start){
          const eventId=s.id+'@'+date;
          const handled=(db.params.handledEvents||[]).includes(eventId);
          const booked=db.transactions.some(t=>t.type===s.type&&!t.internalTransfer&&norm(t.label)===norm(s.label)&&Math.abs(signed(t))===cents(s.amount)&&Math.abs((new Date(t.date+'T12:00:00')-new Date(date+'T12:00:00'))/86400000)<=4);
          if(!handled&&!booked)events.push({...s,date,eventId});
        }
        if(s.cadence==='once')break;
        date=s.cadence==='monthly'?monthShift(date,1,s.day||Number(s.date.slice(-2))):shift(date,s.interval||30);
      }
    });return events.sort((a,b)=>a.date.localeCompare(b.date));
  }
  function budget(db,cat,month) {
    const spending=m=>db.transactions.filter(t=>t.type==='dep'&&!t.internalTransfer&&t.catId===cat.id&&t.date.startsWith(m)&&t.date<=today()).reduce((s,t)=>s+cents(t.amount),0);
    let carry=0;
    if(cat.rollover&&cat.rolloverStart&&month>cat.rolloverStart){
      let m=cat.rolloverStart;let n=0;
      while(m<month&&n++<240){carry=Math.max(0,carry+cents(cat.budget)-spending(m));m=monthShift(m+'-01',1,1).slice(0,7);}
    }
    const spent=spending(month),limit=cents(cat.budget)+carry;
    return {spent:euros(spent),limit:euros(limit),carry:euros(carry),remaining:euros(limit-spent),previous:euros(spending(monthShift(month+'-01',-1,1).slice(0,7)))};
  }
  scope.Finance={cents,euros,signed,iso,today,validDate,shift,monthShift,norm,signature,balance,anchor,missingRows,statementCheck,recurrenceCandidates,scheduleEvents,budget};
  if(typeof module!=='undefined')module.exports=scope.Finance;
})(typeof window!=='undefined'?window:globalThis);
