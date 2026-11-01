import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(process.argv[2]||'index.html','utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const engine=scripts.find(([all,attrs])=>attrs.includes('id="linform-terraform-engine"'))[2];
const preview=scripts.find(([all,attrs])=>attrs.includes('id="linform-public-preview"'))[2];
const ids=new Map(),groups={};
class Element{
 constructor(id=''){this.id=id;this.children=[];this.dataset={};this.handlers={};this.attributes={};this.textContent='';this.hidden=false;this.disabled=false;}
 set innerHTML(value){this.markup=value;for(const match of value.matchAll(/id="([^"]+)"/g))el(match[1]);for(const match of value.matchAll(/id="([^"]+)"[^>]*>([^<]*)</g))el(match[1]).textContent=match[2];for(const attribute of ['data-risk-flag','data-risk-fix','data-preview-flow','data-preview-node'])groups[attribute]=[...value.matchAll(new RegExp(attribute+'="([^"]+)"','g'))].map(match=>{const e=new Element();e.dataset[{ 'data-risk-flag':'riskFlag','data-risk-fix':'riskFix','data-preview-flow':'previewFlow','data-preview-node':'previewNode'}[attribute]]=match[1];return e;});}
 setAttribute(k,v){this.attributes[k]=v;}
 append(...nodes){this.children.push(...nodes);}
 prepend(...nodes){this.children.unshift(...nodes);}
 remove(){}
 querySelector(){return null;}
 querySelectorAll(selector){return groups[selector.slice(1,-1)]||[];}
 addEventListener(type,callback){this.handlers[type]=callback;}
 focus(){this.focused=true;}
 getClientRects(){return this.hidden?[]:[{}];}
 scrollIntoView(){this.scrolled=true;}
}
const el=id=>{if(!ids.has(id))ids.set(id,new Element(id));return ids.get(id);};
const document={getElementById:el,createElement:()=>new Element(),querySelector:selector=>el(selector)};
const events={},window={matchMedia:()=>({matches:false}),addEventListener:(event,fn)=>events[event]=fn};
const context=vm.createContext({window,document,location:{hash:'#home'},requestAnimationFrame:fn=>fn()});
vm.runInContext(engine,context);vm.runInContext(preview,context);
assert.match(el('preview-config').textContent, /terraform_data/);
assert.match(el('preview-plan-result').textContent,/1 to destroy/);
assert.equal(el('risk-verify').disabled,true);assert.equal(el('risk-handoff').hidden,true);
const originalId=el('risk-object-id').textContent;assert.match(originalId,/local-object-001/);
const flag=name=>groups['data-risk-flag'].find(e=>e.dataset.riskFlag===name);
const fix=name=>groups['data-risk-fix'].find(e=>e.dataset.riskFix===name);
fix('move').handlers.click();assert.doesNotMatch(el('preview-config').textContent,/moved/,'cannot skip the risk review');
el('risk-verify').handlers.click();assert.equal(el('risk-handoff').hidden,true);
flag('format').handlers.click();assert.match(el('risk-flag-feedback').textContent,/Formatting/);assert.equal(el('risk-fix-section').hidden,true);
flag('region').handlers.click();assert.match(el('risk-flag-feedback').textContent,/provider-free/);
flag('destroy').handlers.click();assert.equal(el('risk-fix-section').hidden,false);
fix('delete').handlers.click();assert.match(el('risk-fix-feedback').textContent,/ownership/);assert.equal(el('risk-verify').disabled,true);
fix('apply').handlers.click();assert.match(el('risk-fix-feedback').textContent,/recreation/);assert.equal(el('risk-verify').disabled,true);
fix('move').handlers.click();assert.match(el('preview-config').textContent,/moved/);assert.match(el('risk-plan-label').textContent,/re-run required/);assert.equal(el('risk-verify').disabled,false);
assert.match(el('preview-plan-result').textContent,/1 to destroy/,'changing configuration does not silently replace the stale plan');
el('risk-verify').handlers.click();assert.match(el('preview-plan-result').textContent,/0 to add, 0 to change, 0 to destroy/);assert.equal(el('risk-handoff').hidden,false);assert.equal(el('risk-plan-badge').dataset.safe,'true');
assert.equal(el('risk-object-id').textContent,originalId);assert.match(el('preview-lesson-note').textContent,/State is unchanged/);
el('preview-reset').handlers.click();assert.match(el('preview-plan-result').textContent,/1 to destroy/);assert.equal(el('risk-fix-section').hidden,true);assert.equal(el('risk-handoff').hidden,true);assert.equal(el('risk-verify').disabled,true);
el('preview-project-tab').handlers.click();assert.equal(el('preview-project').hidden,false);assert.equal(el('preview-lesson').hidden,true);
groups['data-preview-flow'].find(e=>e.dataset.previewFlow==='save').handlers.click();
assert.match(el('preview-flow-path').textContent,/Cognito/);
assert.equal(groups['data-preview-node'].find(e=>e.dataset.previewNode==='progress').dataset.active,'true');
assert.equal(groups['data-preview-node'].find(e=>e.dataset.previewNode==='s3').dataset.active,'false');
console.log('PASS: risk identification, wrong-choice explanations, gated correction/replan, unchanged state, portfolio handoff, reset and architecture tabs.');

// Exercise the production purchase listener with fake sign-in/checkout services.
const start=html.indexOf(" el('premium-buy').addEventListener('click'");
const end=html.indexOf(" el('premium-signin').addEventListener",start);
const listener=html.slice(start,end);assert.ok(listener.includes('account?.identity'));
let logins=0,requests=0,redirect='',signedIn=false;const stored={};
el('account-login').click=()=>logins++;
const account={identity:()=>signedIn?'fixture-user':null,request:async()=>{requests++;return {url:'https://checkout.stripe.com/c/pay/fixture'};}};
const purchase=vm.createContext({el,account,document,sessionStorage:{setItem:(k,v)=>stored[k]=v},location:{hash:'#premium',assign:url=>redirect=url},purchased:false,generation:0,URL,say(){},refresh(){}});
vm.runInContext(listener,purchase);
await el('premium-buy').handlers.click();assert.equal(logins,1);assert.equal(requests,0);assert.equal(stored['linform-premium-return'],'1');
signedIn=true;await el('premium-buy').handlers.click();assert.equal(requests,1);assert.equal(new URL(redirect).hostname,'checkout.stripe.com');
account.request=async()=>({url:'https://example.invalid/checkout'});redirect='';await el('premium-buy').handlers.click();assert.equal(redirect,'');
console.log('PASS: guest CTA opens sign-in without requesting checkout; signed-in checkout retains Stripe origin checks.');
