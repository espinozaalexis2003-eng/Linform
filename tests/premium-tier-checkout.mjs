import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=fs.readFileSync('index.html','utf8'),source=html.match(/<script id="linform-premium-ui">([\s\S]*?)<\/script>/)[1];
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};this.hidden=false;this.disabled=false;this.value='';this._text='';this.attributes={};}
 set textContent(v){this._text=v||'';this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join(' ');}
 set innerHTML(s){for(const m of s.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const e=new Element(m[1]);elements.set(m[3],e);e.hidden=/\bhidden\b/.test(m[2]);e.disabled=/\bdisabled\b/.test(m[2]);}}
 append(...items){this.children.push(...items);}replaceChildren(...items){this._text='';this.children=items;}setAttribute(k,v){this.attributes[k]=v;}addEventListener(n,f){this.listeners[n]=f;}after(e){this.sibling=e;}reset(){}focus(){}scrollIntoView(){}click(){if(!this.disabled)return this.listeners.click?.({preventDefault(){}});}
}
let elements;
async function fixture(access){
 elements=new Map([['view-premium',new Element()]]);const captured=elements,calls=[],destinations=[];
 const context=vm.createContext({document:{getElementById:id=>captured.get(id),createElement:t=>new Element(t),body:new Element(),addEventListener(){},visibilityState:'visible'},window:{LinformAccount:{identity:()=> 'fixture-user',configured:()=>true,async request(path,method='GET',data){calls.push({path,method,data});if(path==='/premium/access')return access;if(path==='/premium/catalog')return {items:[]};if(path==='/premium/checkout')return {url:'https://checkout.stripe.com/c/pay/fixture'};throw Error('Unexpected request');}},addEventListener(){}},location:{hash:'#premium',search:'',pathname:'/',assign:url=>destinations.push(url)},history:{replaceState(){}},sessionStorage:{setItem(){}},localStorage:{getItem:()=>null,setItem(){}},URL,URLSearchParams,TextEncoder,Blob,Uint8Array,DataView,encodeURIComponent,setTimeout,progress:{},isComplete:()=>false,saveProgress(){},makeCodeBlock:()=>new Element('pre')});
 vm.runInContext(source,context);for(let i=0;i<6;i++)await new Promise(setImmediate);return {el:id=>captured.get(id),calls,destinations,context};
}
let f=await fixture({purchased:false,checkoutReady:true});
assert.equal(f.el('premium-buy').disabled,true);assert.equal(f.el('premium-buy-mentorship').disabled,true);f.el('premium-buy').disabled=false;await f.el('premium-buy').click();assert.ok(!f.calls.some(c=>c.path==='/premium/checkout'),'old backend cannot receive a newly advertised tier checkout');
f=await fixture({purchased:false,tierPolicyVersion:2,supportAccess:false,checkoutOptions:{digital:true,mentorship:true}});
assert.equal(f.el('premium-buy').disabled,false);assert.equal(f.el('premium-buy-mentorship').disabled,false);
await f.el('premium-buy').click();assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1).data)),{tier:'digital'});assert.equal(f.destinations[0],'https://checkout.stripe.com/c/pay/fixture');
f=await fixture({purchased:false,tierPolicyVersion:2,supportAccess:false,checkoutOptions:{digital:true,mentorship:true}});
await f.el('premium-buy-mentorship').click();assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1).data)),{tier:'mentorship'});
f=await fixture({purchased:true,tierPolicyVersion:2,tier:'digital',supportAccess:false,checkoutOptions:{digital:true,mentorship:true}});
assert.equal(f.el('premium-purchase').hidden,true);assert.equal(f.el('premium-contact').hidden,true);assert.equal(f.el('premium-go-contact').hidden,true);assert.match(f.el('premium-mentor-cta').textContent,/\$60/);await f.el('premium-mentor-form').listeners.submit({preventDefault(){}});assert.ok(!f.calls.some(c=>c.path==='/premium/mentoring'));
assert.match(html,/Lifetime learning/);assert.match(html,/One 30–45-minute one-on-one mentorship call/);assert.match(html,/Private community access — coming soon/);
console.log('PASS: two explicit server-priced checkout choices, old API cannot charge the wrong offer, digital members keep the library without personal support, and both tiers are one-time purchases.');
