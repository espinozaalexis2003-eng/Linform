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
 set innerHTML(value){this.markup=value;for(const match of value.matchAll(/id="([^"]+)"/g))el(match[1]);for(const attribute of ['data-preview-answer','data-preview-flow','data-preview-node'])groups[attribute]=[...value.matchAll(new RegExp(attribute+'="([^"]+)"','g'))].map(match=>{const e=new Element();e.dataset[{ 'data-preview-answer':'previewAnswer','data-preview-flow':'previewFlow','data-preview-node':'previewNode'}[attribute]]=match[1];return e;});}
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
assert.equal(el('preview-state-value').textContent,'learn');
assert.equal(el('preview-plan').disabled,true);assert.equal(el('preview-apply').disabled,true);
el('preview-apply').handlers.click();assert.equal(el('preview-state-value').textContent,'learn');
el('preview-edit').handlers.click();assert.match(el('preview-config').textContent,/portfolio/);assert.equal(el('preview-state-value').textContent,'learn');assert.equal(el('preview-plan').disabled,false);
el('preview-plan').handlers.click();assert.match(el('preview-plan-result').textContent,/1 to change/);assert.equal(el('preview-state-value').textContent,'learn');assert.equal(el('preview-apply').disabled,false);
el('preview-apply').handlers.click();assert.equal(el('preview-state-value').textContent,'portfolio');assert.equal(el('preview-state-match').textContent,'In sync');
el('preview-reset').handlers.click();assert.equal(el('preview-state-value').textContent,'learn');assert.equal(el('preview-edit').disabled,false);
groups['data-preview-answer'][0].handlers.click();assert.match(el('preview-answer-feedback').textContent,/Correct/);
groups['data-preview-answer'][1].handlers.click();assert.match(el('preview-answer-feedback').textContent,/Review/);
el('preview-project-tab').handlers.click();assert.equal(el('preview-project').hidden,false);assert.equal(el('preview-lesson').hidden,true);
groups['data-preview-flow'].find(e=>e.dataset.previewFlow==='save').handlers.click();
assert.match(el('preview-flow-path').textContent,/Cognito/);
assert.equal(groups['data-preview-node'].find(e=>e.dataset.previewNode==='progress').dataset.active,'true');
assert.equal(groups['data-preview-node'].find(e=>e.dataset.previewNode==='s3').dataset.active,'false');
console.log('PASS: real Terraform sample edit/plan/apply/reset, explanation choices, preview tabs and architecture paths.');

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
