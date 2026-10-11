const {JSDOM}=require('jsdom');
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html,{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;
w.structuredClone=structuredClone;w.scrollTo=()=>{};w.confirm=()=>true;w.console={...console,error:()=>{}};
const documentStore={set:async s=>{if(w.failSave)throw Error('offline');w.saved=s;},get:async()=>({exists:true,data:()=>w.saved})};
w.firebase={initializeApp(){},auth(){return {onAuthStateChanged(){},signOut(){}}},firestore(){return {collection(){return {doc(){return documentStore;}}},runTransaction:async fn=>{let pending;await fn({get:async()=>({exists:!!w.saved,data:()=>w.saved}),set:(ref,s)=>{pending=s;}});if(w.failSave)throw Error('offline');w.saved=pending;}};}};
w.pdfjsLib={GlobalWorkerOptions:{}};
const main=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const vm=require('node:vm');const ctx=dom.getInternalVMContext();const run=s=>vm.runInContext(s,ctx);run(main);run(fs.readFileSync('finance.js','utf8'));run(fs.readFileSync('sunset.js','utf8'));run(fs.readFileSync('planning.js','utf8'));
run(`uid='test';DB={transactions:[{id:'a',seq:1,label:'Courses',date:'2026-10-07',amount:30,type:'dep',catId:'food'},{id:'b',seq:2,label:'Salaire',date:'2026-10-01',amount:1000,type:'rec',catId:''},{id:'c',label:'Prêt',date:'2026-08-14',amount:200,type:'dep'},{id:'d',label:'Prêt',date:'2026-09-14',amount:200,type:'dep'}],categories:[{id:'food',name:'Courses',type:'dep',budget:200}],params:{soldeInitial:0}};defaults();DB.params.balanceAnchor=F.anchor(DB,300,F.today());initUI();`);
const data=()=>JSON.parse(run('JSON.stringify(DB)'));
async function tick(){for(let i=0;i<4;i++)await new Promise(r=>setTimeout(r,0));}
async function submit(){w.document.getElementById('sun-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();}
(async()=>{
 for(const view of ['home','operations','budget','calendar','savings','add','report','import']){w.showView(view);assert.equal(w.document.querySelectorAll('.pane.on').length,1);}
 w.showView('operations');w.document.getElementById('h-search').value='Courses';w.renderHistorique();assert.equal(w.document.querySelectorAll('#h-list .tx-item').length,1);
 w.editTransaction('a');w.document.querySelector('[name=amount]').value='32,10';await submit();assert.equal(data().transactions.find(t=>t.id==='a').amount,32.1);assert.equal(w.document.getElementById('sun-modal').hidden,true);
 await w.delTransaction('a');assert(!data().transactions.some(t=>t.id==='a'));await w.undoDelete();assert(data().transactions.some(t=>t.id==='a'));
 w.failSave=true;await w.delTransaction('a');assert(data().transactions.some(t=>t.id==='a'),'Suppression annulée quand la sauvegarde échoue');
 w.editTransaction('a');w.document.querySelector('[name=amount]').value='35';await submit();assert.equal(data().transactions.find(t=>t.id==='a').amount,32.1);w.failSave=false;await submit();assert.equal(data().transactions.find(t=>t.id==='a').amount,35,'Nouvelle tentative après échec');
 w.budgetEditor('food');w.document.querySelector('[name=budget]').value='250';await submit();assert.equal(data().categories[0].budget,250);
 w.goalEditor();w.document.querySelector('[name=name]').value='Voyage';w.document.querySelector('[name=target]').value='500';w.document.querySelector('[name=saved]').value='100';await submit();assert.equal(data().params.goals.length,1);
 w.refundEditor();w.document.querySelector('[name=label]').value='Retour achat';w.document.querySelector('[name=amount]').value='20';await submit();assert.equal(data().params.refunds.length,1);
 w.scheduleEditor();w.document.querySelector('[name=label]').value='Assurance';w.document.querySelector('[name=amount]').value='50';await submit();assert.equal(data().params.schedules.length,1);
 w.planEditor();w.document.querySelector('[name=income]').value='200';w.document.querySelector('[name=food]').value='180';await submit();assert.equal(data().params.monthlyPlan.income,200);
 w.roundupEditor();await submit();assert.equal(data().params.roundups.cap,20);assert(w.document.getElementById('sun-roundups').textContent.includes('Reste à virer'));
 const balanceBefore=run('F.balance(DB)');w.roundupTransferEditor();w.document.querySelector('[name=amount]').value='5';await submit();assert.equal(run('F.balance(DB)'),balanceBefore);assert.equal(data().params.roundups.transferred[run('currentMonth')],5);
 w.saved.revision+=1;const original=data().transactions.length;await w.delTransaction('a');assert.equal(data().transactions.length,original,'Conflit entre appareils détecté');w.saved.revision-=1;
 w.togglePrivacy();assert(w.document.body.classList.contains('money-hidden'));
 const records=[null,{start:'2026-10-01',end:'2026-10-07',opening:0,closing:80,key:'synthetic|2026-10',rows:[{date:'2026-10-01',label:'Rentrée exemple',amount:100,type:'rec',catId:''},{date:'2026-10-07',label:'CB CINEMA',amount:10,type:'dep',catId:'',sourceLine:'1:100:dep'},{date:'2026-10-07',label:'CB CINEMA',amount:10,type:'dep',catId:'',sourceLine:'1:120:dep'}]}];
 run(`DB.transactions=[];DB.params={soldeInitial:0};defaults();currentImport=${JSON.stringify(records[1])};parsedLines=F.missingRows(DB.transactions,currentImport.rows).map(t=>({...t,selected:!t.alreadyPresent}));renderImportTable();`);
 assert.equal(w.document.querySelectorAll('#import-tbody tr').length,3);
 assert.equal(run('importCheck().ok'),true);await w.doImport();assert.equal(data().transactions.length,3);
 run(`currentImport=${JSON.stringify(records[1])};parsedLines=F.missingRows(DB.transactions,currentImport.rows).map(t=>({...t,selected:!t.alreadyPresent}));renderImportTable();`);
 assert.equal(run('parsedLines.filter(t=>t.selected).length'),0,'Réimport sans doublons');
 const toDelete=data().transactions.find(t=>t.label.startsWith('CB CINEMA')&&t.date==='2026-10-07');await w.delTransaction(toDelete.id);
 run(`currentImport=${JSON.stringify(records[1])};parsedLines=F.missingRows(DB.transactions,currentImport.rows).map(t=>({...t,selected:!t.alreadyPresent}));renderImportTable();`);
 assert.equal(run('parsedLines.filter(t=>t.selected).length'),1,'Une occurrence manquante peut être restaurée');await w.doImport();assert.equal(data().transactions.length,3);
 run(`currentImport=${JSON.stringify(records[1])};parsedLines=F.missingRows(DB.transactions,currentImport.rows).map(t=>({...t,selected:true}));parsedLines[0].amount+=1;renderImportTable();`);
 assert.equal(run('importCheck().ok'),false);assert(w.document.querySelector('#import-results .btn.green').disabled);
 console.log('Formulaires et navigation vérifiés : édition, annulation, retour après échec, objectifs, budgets, remboursements, prévisions, confidentialité, import synthétique de 3 lignes, réimport neutre et restauration d’un paiement manquant.');
 w.close();
})().catch(e=>{console.error(e);w.close();process.exit(1);});
