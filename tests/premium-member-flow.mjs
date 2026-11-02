import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=fs.readFileSync(process.argv[2]||'index.html','utf8');
// Default fixtures contain no paid curriculum. Pass a private-content directory to validate the owner's release separately.
const base=process.argv[3];
const ids=['aws-guide','azure-guide','terraform-guide','aws-project','azure-project','terraform-project','aws-serverless-project','azure-linux-project','terraform-drift-project'];
const catalog=base?JSON.parse(fs.readFileSync(base+'/catalog.json')):{notice:'Synthetic member fixture',items:ids.map(id=>({id,title:'Fixture '+id,kind:id.endsWith('guide')?'guide':'project',exam:'Fixture exam'}))};
const contents=Object.fromEntries(catalog.items.map(i=>[i.id,base?JSON.parse(fs.readFileSync(base+'/content/'+i.id+'.json')):{...i,
 intro:'Fixture introduction',studyPlan:['Fixture plan'],chapters:[{id:i.id+'-fixture-chapter',title:'Fixture chapter',domain:'Fixture domain',explanation:'Fixture explanation',practice:'Fixture practice',pitfall:'Fixture pitfall',checkpoint:{question:'Fixture question',answer:'Fixture answer'}}],
 practiceExam:{title:'Fixture review',notice:'Synthetic',questions:Array.from({length:12},()=>({domain:'Fixture',question:'Fixture question',options:['A','B'],answer:0,explanation:'Fixture answer'}))},reference:'https://example.com',
 steps:[['Fixture step','Fixture task','Fixture check']],walkthrough:[{title:'Fixture milestone',steps:['Fixture action'],solution:'Fixture outcome',completionId:i.id+'-fixture-step'}],commands:'echo fixture',deliverables:['Fixture deliverable'],interview:['Fixture question'],files:[{path:'README.md',content:'Synthetic fixture'}],resumeBullets:[{text:'Fixture resume wording',evidence:'Fixture evidence'}],resumeGuidance:'Use completed work only'
 }]));
const script=html.match(/<script id="linform-premium-ui">([\s\S]*?)<\/script>/)[1];
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
const elements=new Map(),events={},docEvents={};
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};this.hidden=false;this.disabled=false;this.value='';this._text='';this.attributes={};}
 set id(v){this._id=v;elements.set(v,this)}get id(){return this._id}
 set textContent(v){this._text=v??'';this.children=[]}get textContent(){return this._text+this.children.map(e=>e.textContent).join(' ')}
 set innerHTML(s){this.html=s;for(const m of s.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const e=new Element(m[1]);e.id=m[3];e.hidden=/\bhidden\b/.test(m[2]);}}
 append(...items){this.children.push(...items)}replaceChildren(...items){this._text='';this.children=[...items]}
 showModal(){this.open=true}close(){this.open=false;this.listeners.close?.()}after(e){this.sibling=e}setAttribute(name,value){this.attributes[name]=value}scrollIntoView(){this.scrolled=true}focus(){this.focused=true}remove(){}click(){return this.listeners.click?.({preventDefault(){}})}
 addEventListener(n,f){this.listeners[n]=f}reset(){this.value=''}
}
const view=new Element();view.id='view-premium';
let ownerGranted=process.env.LINFORM_TEST_OWNER==='1';
let identity='student-a',paid=!ownerGranted,saves=0,failContent=false;const pending=new Map(),calls=[],progress={};
const context=vm.createContext({document:{getElementById:id=>elements.get(id),createElement:tag=>new Element(tag),body:new Element('body'),visibilityState:'visible',addEventListener:(n,f)=>docEvents[n]=f},
 window:{LinformAccount:{identity:()=>identity,configured:()=>true,async request(path,method='GET',value){calls.push({path,method,value});if(path.startsWith('/premium/access'))return {purchased:paid,owner:ownerGranted,checkoutReady:true};if(path==='/premium/catalog')return structuredClone(catalog);if(path.startsWith('/premium/content/')){const id=path.split('/').at(-1);if(pending.has(id))await pending.get(id);if(failContent)throw Object.assign(new Error('Forbidden'),{status:403});return structuredClone(contents[id]);}if(path==='/premium/mentoring')return {requestId:'local-test'};throw Error(path)}},addEventListener:(n,f)=>events[n]=f},
 location:{hash:'#premium',search:'',pathname:'/'},history:{replaceState(){}},URL,URLSearchParams,TextEncoder,Blob,Uint8Array,DataView,encodeURIComponent,sessionStorage:{setItem(){}},setTimeout,progress,isComplete:id=>!!progress[id],saveProgress:()=>saves++,makeCodeBlock:code=>{const e=new Element('pre');e.textContent=code;return e;}});
vm.runInContext(script,context);await settle();
const el=id=>elements.get(id);const walk=e=>[e,...e.children.flatMap(walk)];
if(ownerGranted)assert.equal(el('premium-access-label').textContent,'Owner access');
assert.equal(el('premium-private').hidden,false);assert.equal(el('premium-public').hidden,true);assert.equal(el('premium-guide-cards').children.length,3);assert.equal(el('premium-project-cards').children.length,6);
assert.equal(view.attributes['data-member'],'true');assert.equal(el('premium-purchase').hidden,true);assert.equal(el('premium-status').hidden,true);assert.equal(el('premium-member-nav').hidden,false);assert.equal(el('premium-status').sibling.hidden,true);
await el('premium-go-contact').click();assert.ok(el('premium-contact').scrolled);assert.ok(el('premium-mentor-message').focused);
await el('premium-go-guides').click();assert.ok(el('premium-guides').scrolled);
await el('premium-go-projects').click();assert.ok(el('premium-projects').scrolled);
const cardFor=item=>el(item.kind==='guide'?'premium-guide-cards':'premium-project-cards').children[catalog.items.filter(i=>i.kind===item.kind).findIndex(i=>i.id===item.id)];
for(const [index,item]of catalog.items.entries()){
 const button=cardFor(item).children.at(-1);await button.click();await settle();
 const reader=el('premium-reader');assert.equal(reader.hidden,false);assert.match(reader.textContent,new RegExp(item.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 const marks=walk(reader).filter(e=>e.tag==='button'&&/Mark .*complete/.test(e.textContent));
 assert.ok(marks.length>0,item.id+' has completion controls');await marks[0].click();assert.ok(saves>0);
 if(item.kind==='guide'){
  assert.equal(walk(reader).filter(e=>e.tag==='fieldset').length,0);
  const launch=walk(reader).find(e=>e.tag==='button'&&e.textContent==='Start 5-question quiz');assert.ok(launch);await launch.click();
  const modal=walk(reader).find(e=>e.tag==='dialog');assert.equal(modal.open,true);assert.equal(walk(modal).filter(e=>e.tag==='fieldset').length,1);
  await walk(modal).find(e=>e.tag==='button'&&e.textContent==='Close').click();assert.equal(modal.open,false);
 }
 else {assert.ok(reader.textContent.includes('Resume bullets after you finish'));assert.ok(reader.textContent.includes('Download starter files'));}
}
console.log('PASS: paid-member catalog, all 3 complete guide readers, 6 guided project readers, quiz controls, milestones, starter downloads and resume sections render.');
el('premium-mentor-topic').value='resume-review';el('premium-mentor-topic').listeners.change();el('premium-mentor-message').value='A redacted resume with enough detail to request useful feedback.';el('premium-mentor-email').value='fixture@example.com';el('premium-mentor-project').value='';el('premium-mentor-consent').checked=true;
await el('premium-mentor-form').listeners.submit({preventDefault(){}});assert.ok(calls.some(c=>c.path==='/premium/mentoring'&&c.value.topic==='learning-plan'&&c.value.message.startsWith('[Resume review]')));
let release;pending.set('aws-guide',new Promise(resolve=>release=resolve));
const slow=cardFor(catalog.items[0]).children.at(-1).click();await settle();
await cardFor(catalog.items[1]).children.at(-1).click();await settle();
release();await slow;await settle();pending.delete('aws-guide');
assert.ok(el('premium-reader').textContent.includes(catalog.items[1].title),'latest selected guide wins a slow-request race');
console.log('PASS: switching guides ignores a slower previous selection.');
let lateRelease;pending.set('aws-guide',new Promise(resolve=>lateRelease=resolve));
const late=cardFor(catalog.items[0]).children.at(-1).click();await settle();
paid=false;ownerGranted=false;await docEvents.visibilitychange();await settle();lateRelease();await late;await settle();
await settle();assert.equal(el('premium-private').hidden,true);assert.equal(el('premium-reader').hidden,true);assert.equal(el('premium-reader').children.length,0);
console.log('PASS: resume-review request mapping and revoked access clear private content.');


assert.equal(view.attributes['data-member'],'false');assert.equal(el('premium-purchase').hidden,false);assert.equal(el('premium-member-nav').hidden,true);assert.equal(el('premium-guide-cards').children.length,0);assert.equal(el('premium-project-cards').children.length,0);
assert.match(html,/class="premium-tag-logo"/);assert.doesNotMatch(html,/Refresh purchase access/);
console.log('PASS: member and owner presentation hides pricing/retry, separates guides/projects, routes contact shortcuts and restores prospect state after revoked access.');

