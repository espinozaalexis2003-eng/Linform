import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';

const html=readFileSync(process.argv[2] || 'index.html','utf8');
const source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match=>match[1]).find(text=>text.includes('const ACCOUNT_CONFIG ='));
assert.ok(source,'account client exists');
const guestKey='linform-course-progress-v2';
const accountKey=id=>'linform-account-progress-v1:'+id;
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
function storage(seed={}) {
  const values=new Map(Object.entries(seed));
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}
function backend() {
  const users=new Map(); const calls=[];
  return {users,calls,offline:false,putGate:null,
    async fetch(url,options={}) {
      const address=String(url);
      if(address.endsWith('/oauth2/token'))return {ok:true,json:async()=>({access_token:'mock-token',expires_in:900})};
      if(this.offline)throw new Error('Network unavailable');
      calls.push({url:address,...options});
      const user=this.activeUser;
      const completed=users.get(user)||new Set();users.set(user,completed);
      if(options.method==='PUT') {
        if(this.putGate)await this.putGate;
        for(const id of JSON.parse(options.body).completed)completed.add(id);
        return {ok:true,status:200,json:async()=>({saved:true})};
      }
      return {ok:true,status:200,json:async()=>({userId:user,completed:[...completed]})};
    }
  };
}
async function browser({id='student-a',local=storage(),remote=backend(),authenticated=true}={}) {
  const elements=new Map(),timers=new Map(),windowEvents={},documentEvents={};let nextTimer=0;
  class Element {
    constructor(){this.hidden=false;this.disabled=false;this.textContent='';this.listeners={};}
    set id(value){this._id=value;elements.set(value,this);}get id(){return this._id;}
    set innerHTML(value){for(const match of value.matchAll(/id="([^"]+)"/g)){const node=new Element();node.id=match[1];}}
    after(){}before(){}append(){}
    addEventListener(name,handler){this.listeners[name]=handler;}
  }
  for(const id of ['student-account','courses','account-status','account-login','account-sync','account-logout']){
    const node=new Element();node.id=id;
  }
  const header=new Element();
  const document={getElementById:id=>elements.get(id),querySelector:()=>header,createElement:()=>new Element(),visibilityState:'visible',addEventListener:(name,handler)=>documentEvents[name]=handler};
  const now=Date.now();
  const session=storage(authenticated?{'linform-oauth':JSON.stringify({verifier:'test-verifier',state:'test-state',at:now})}:{});
  const location={origin:'https://linformcloud.com',href:'https://linformcloud.com/'+(authenticated?'?code=test-code&state=test-state':''),assign(url){this.assigned=url;}};
  const context=vm.createContext({document,location,history:{replaceState(){}},window:{addEventListener:(name,handler)=>windowEvents[name]=handler},
    URL,URLSearchParams,Date,AbortSignal,TextEncoder,Uint8Array,localStorage:local,sessionStorage:session,
    STORAGE_KEY:guestKey,progress:JSON.parse(local.getItem(guestKey)||'{}'),dialog:{open:false},
    saveProgress(){try{local.setItem(guestKey,JSON.stringify(context.progress));return true;}catch{return false;}},
    isComplete:key=>context.progress[key]===true,renderCourses(){},renderLesson(){},renderLessonNavigation(){},
    setTimeout(fn,ms){const key=++nextTimer;timers.set(key,{fn,ms});return key;},clearTimeout:key=>timers.delete(key),
    fetch:(url,options)=>{remote.activeUser=id;return remote.fetch(url,options);},
    btoa:value=>Buffer.from(value,'binary').toString('base64'),crypto:{getRandomValues:array=>array,subtle:{digest:async()=>new Uint8Array(32)}}});
  vm.runInContext(source,context);await settle();
  async function queued(){for(let turn=0;turn<20;turn++){
    const pending=[...timers.entries()].filter(([,timer])=>timer.ms===0);
    if(!pending.length)break;
    for(const [key,{fn}] of pending){timers.delete(key);fn();}await settle();
  }}
  return {context,local,remote,elements,windowEvents,documentEvents,
    status:()=>elements.get('account-status').textContent,
    async complete(id){context.progress[id]=true;context.saveProgress();await queued();},queued,
    expire(){for(const [key,{fn,ms}]of timers)if(ms>0){timers.delete(key);fn();}},
    async click(id){await elements.get(id).listeners.click();await queued();}};
}

test('a signed-in completion automatically saves to that account',async()=>{
  const b=await browser();await b.complete('linux-location');
  assert.ok(b.remote.users.get('student-a').has('linux-location'));
  assert.equal(JSON.parse(b.local.getItem(accountKey('student-a')))['linux-location'],true);
  assert.match(b.status(),/^Saved to your account/);
  assert.equal(b.local.getItem(guestKey),null);
});
test('account B never inherits account A or guest progress',async()=>{
  const local=storage({[guestKey]:JSON.stringify({'aws-foundations':true}),[accountKey('student-a')]:JSON.stringify({'linux-location':true})});
  const b=await browser({id:'student-b',local});
  assert.deepEqual(Object.keys(b.context.progress),[]);
  assert.equal(b.remote.users.get('student-b').size,0);
});
test('sign-in restores server progress and uploads pending per-account cache',async()=>{
  const remote=backend();remote.users.set('student-a',new Set(['azure-foundations']));
  const local=storage({[accountKey('student-a')]:JSON.stringify({'linux-location':true})});
  const b=await browser({remote,local});
  assert.deepEqual([...remote.users.get('student-a')].sort(),['azure-foundations','linux-location']);
  assert.equal(b.context.progress['azure-foundations'],true);
});
test('offline save remains in the account cache and never claims cloud success',async()=>{
  const b=await browser();b.remote.offline=true;await b.complete('linux-location');
  assert.match(b.status(),/Not synced yet/);
  assert.equal(JSON.parse(b.local.getItem(accountKey('student-a')))['linux-location'],true);
  assert.equal(b.local.getItem(guestKey),null);
  b.remote.offline=false;await b.click('account-sync');
  assert.ok(b.remote.users.get('student-a').has('linux-location'));
});
test('session expiry keeps new completions attached to the original account',async()=>{
  const b=await browser();b.expire();await b.complete('terraform-foundations');
  assert.match(b.status(),/Session expired/);
  assert.equal(JSON.parse(b.local.getItem(accountKey('student-a')))['terraform-foundations'],true);
  assert.equal(b.local.getItem(guestKey),null);
  assert.equal(b.elements.get('account-login').hidden,false);
  const again=await browser({local:b.local,remote:b.remote});
  assert.ok(again.remote.users.get('student-a').has('terraform-foundations'));
});
test('guest lessons join an account only after explicit import',async()=>{
  const b=await browser({local:storage({[guestKey]:JSON.stringify({'linux-location':true})})});
  assert.equal(b.context.progress['linux-location'],undefined);
  assert.equal(b.elements.get('account-import').hidden,false);
  await b.click('account-import');
  assert.ok(b.remote.users.get('student-a').has('linux-location'));
});
test('a lesson finished during an upload gets its own follow-up sync',async()=>{
  const b=await browser();let release;
  b.remote.putGate=new Promise(resolve=>release=resolve);
  b.context.progress['linux-location']=true;b.context.saveProgress();await b.queued();
  b.context.progress['aws-foundations']=true;b.context.saveProgress();await b.queued();
  b.remote.putGate=null;release();await settle();await b.queued();
  assert.deepEqual([...b.remote.users.get('student-a')].sort(),['aws-foundations','linux-location']);
});
test('backgrounding the page attempts a keepalive upload',async()=>{
  const b=await browser();b.context.progress['linux-location']=true;
  b.windowEvents.pagehide();await settle();
  assert.ok(b.remote.calls.some(call=>call.keepalive===true));
  assert.ok(b.remote.users.get('student-a').has('linux-location'));
});
