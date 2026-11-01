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
      if(address.endsWith('/oauth2/token')) {
        const grant=new URLSearchParams(options.body).get('grant_type');
        calls.push({url:address,...options,grant});
        if(grant==='refresh_token' && this.refreshOffline)throw new Error('Offline');
        if(grant==='refresh_token' && this.rejectRefresh)return {ok:false,status:400};
        if(grant==='refresh_token' && this.refreshGate)await this.refreshGate;
        return {ok:true,json:async()=>({access_token:grant==='refresh_token'?'renewed-token':'mock-token',expires_in:900,...(grant==='authorization_code'||this.rotateRefresh?{refresh_token:grant==='refresh_token'?'rotated-refresh':'mock-refresh'}:{})})};
      }
      if(address.endsWith('/oauth2/userInfo')) {
        if(this.profileOffline)throw new Error('Profile unavailable');
        if(this.profileGate)await this.profileGate;
        return {ok:true,json:async()=>this.profileOverride||{sub:this.activeUser,name:'Test Student',email:this.activeUser+'@example.com'}};
      }
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
async function browser({id='student-a',local=storage(),remote=backend(),authenticated=true,sessionStore=null}={}) {
  const elements=new Map(),timers=new Map(),windowEvents={},documentEvents={};let nextTimer=0;
  class Element {
    constructor(){this.hidden=false;this.disabled=false;this.textContent='';this.listeners={};}
    set id(value){this._id=value;elements.set(value,this);}get id(){return this._id;}
    set innerHTML(value){for(const match of value.matchAll(/id="([^"]+)"/g)){const node=new Element();node.id=match[1];}}
    after(){}before(){}append(){}
    addEventListener(name,handler){this.listeners[name]=handler;}
  }
  for(const id of ['student-account','courses','account-status','account-login','account-logout','account-profile','account-name','account-email']){
    const node=new Element();node.id=id;
  }
  const header=new Element();
  const document={getElementById:id=>elements.get(id),querySelector:()=>header,createElement:()=>new Element(),visibilityState:'visible',addEventListener:(name,handler)=>documentEvents[name]=handler};
  const now=Date.now();
  const session=sessionStore||storage(authenticated?{'linform-oauth':JSON.stringify({verifier:'test-verifier',state:'test-state',at:now})}:{});
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
  return {context,local,remote,elements,windowEvents,documentEvents,session,
    status:()=>elements.get('account-status').textContent,
    async complete(id){context.progress[id]=true;context.saveProgress();await queued();},queued,
    async retry(){const entry=[...timers].find(([,t])=>t.ms>=2000&&t.ms<=30000);assert.ok(entry,'automatic retry is scheduled');timers.delete(entry[0]);entry[1].fn();await settle();await queued();},
    retryDelays:()=>[...timers.values()].map(t=>t.ms).filter(ms=>ms>=2000&&ms<=30000),
    async expire(){for(const [key,{fn,ms}]of [...timers])if(ms>30000){timers.delete(key);fn();}await settle();await queued();},
    async click(id){await elements.get(id).listeners.click();await queued();}};
}

test('a signed-in completion automatically saves to that account',async()=>{
  const b=await browser();await b.complete('linux-location');
  assert.ok(b.remote.users.get('student-a').has('linux-location'));
  assert.equal(JSON.parse(b.local.getItem(accountKey('student-a')))['linux-location'],true);
  assert.match(b.status(),/^Progress saved automatically/);
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
  assert.match(b.status(),/Saved on this device · Retrying online/);
  assert.equal(JSON.parse(b.local.getItem(accountKey('student-a')))['linux-location'],true);
  assert.equal(b.local.getItem(guestKey),null);
  b.remote.offline=false;await b.retry();
  assert.ok(b.remote.users.get('student-a').has('linux-location'));
});
test('session expiry keeps new completions attached to the original account',async()=>{
  const b=await browser();b.remote.rejectRefresh=true;await b.expire();await b.complete('terraform-foundations');
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


test('failed saves retry automatically with capped backoff and recover without a button',async()=>{
  const b=await browser();b.remote.offline=true;await b.complete('linux-location');
  assert.deepEqual(b.retryDelays(),[2000]);
  for(const delay of [4000,8000,16000,30000,30000]){await b.retry();assert.deepEqual(b.retryDelays(),[delay]);}
  b.remote.offline=false;await b.retry();
  assert.ok(b.remote.users.get('student-a').has('linux-location'));
  assert.match(b.status(),/^Progress saved automatically/);
  assert.deepEqual(b.retryDelays(),[]);
});
test('reconnection saves pending lessons automatically',async()=>{
  const b=await browser();b.remote.offline=true;await b.complete('linux-location');
  b.remote.offline=false;await b.windowEvents.online();await settle();await b.queued();
  assert.ok(b.remote.users.get('student-a').has('linux-location'));
  assert.deepEqual(b.retryDelays(),[]);
});
test('sign out cancels automatic retries and restores separate guest progress',async()=>{
  const b=await browser();b.remote.offline=true;await b.complete('linux-location');
  await b.click('account-logout');
  assert.deepEqual(b.retryDelays(),[]);
  assert.equal(b.context.progress['linux-location'],undefined);
  assert.equal(JSON.parse(b.local.getItem(accountKey('student-a')))['linux-location'],true);
});
test('account page is concise and privacy is available in Terms',()=>{
  const panel=html.match(/<section id="student-account"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(panel,/account-sync|<details>|Student data and privacy|AWS Cognito/);
  assert.match(panel,/Terms &amp; privacy/);
  assert.match(html,/terms.insertAdjacentHTML\('beforeend',.*<summary>Privacy<\/summary>/);
});


test('signed-in account displays its Cognito name and email without caching profile details',async()=>{
  const b=await browser();
  assert.equal(b.elements.get('account-profile').hidden,false);
  assert.equal(b.elements.get('account-name').textContent,'Test Student');
  assert.equal(b.elements.get('account-email').textContent,'student-a@example.com');
  assert.doesNotMatch(b.local.getItem(accountKey('student-a')),/Test Student|example.com/);
});
test('missing full name uses given and family name; absent name is not invented from email',async()=>{
  const remote=backend();remote.profileOverride={sub:'student-a',given_name:'Alex',family_name:'Student',email:'alex@example.com'};
  let b=await browser({remote});assert.equal(b.elements.get('account-name').textContent,'Alex Student');
  remote.profileOverride={sub:'student-a',email:'alex@example.com'};
  b=await browser({remote});assert.equal(b.elements.get('account-name').textContent,'Not provided');
});
test('a mismatched profile is never displayed and does not stop progress saving',async()=>{
  const remote=backend();remote.profileOverride={sub:'student-b',name:'Other Student',email:'other@example.com'};
  const b=await browser({remote});assert.equal(b.elements.get('account-email').textContent,'Unavailable');
  await b.complete('linux-location');assert.ok(remote.users.get('student-a').has('linux-location'));
});
test('profile request failure does not stop automatic progress saving',async()=>{
  const remote=backend();remote.profileOffline=true;
  const b=await browser({remote});assert.equal(b.elements.get('account-name').textContent,'Unavailable');
  await b.complete('linux-location');assert.ok(remote.users.get('student-a').has('linux-location'));
});
test('guest accounts hide profile and sign out clears account details',async()=>{
  const guest=await browser({authenticated:false});assert.equal(guest.elements.get('account-profile').hidden,true);
  const b=await browser();await b.click('account-logout');
  assert.equal(b.elements.get('account-profile').hidden,true);
  assert.doesNotMatch(b.elements.get('account-email').textContent,/example.com/);
});
test('a late profile response cannot expose account details after sign out',async()=>{
  const remote=backend();let release;remote.profileGate=new Promise(resolve=>release=resolve);
  const b=await browser({remote});await b.click('account-logout');release();await settle();
  assert.equal(b.elements.get('account-profile').hidden,true);
  assert.doesNotMatch(b.elements.get('account-email').textContent,/example.com/);
});

test('refreshing the page restores the account, profile and progress without another sign in',async()=>{
  const first=await browser();await first.complete('linux-location');
  const again=await browser({authenticated:false,sessionStore:first.session,local:first.local,remote:first.remote});
  assert.equal(again.elements.get('account-login').hidden,true);
  assert.equal(again.elements.get('account-email').textContent,'student-a@example.com');
  assert.equal(again.context.progress['linux-location'],true);
  assert.equal(again.remote.calls.filter(c=>c.grant==='authorization_code').length,1);
});
test('expired access token is renewed on reload, including rotating refresh tokens',async()=>{
  const first=await browser();const saved=JSON.parse(first.session.getItem('linform-tab-session-v1'));
  saved.expiresAt=Date.now()-1000;first.session.setItem('linform-tab-session-v1',JSON.stringify(saved));first.remote.rotateRefresh=true;
  const again=await browser({authenticated:false,sessionStore:first.session,local:first.local,remote:first.remote});
  assert.equal(again.elements.get('account-login').hidden,true);
  const renewed=JSON.parse(again.session.getItem('linform-tab-session-v1'));
  assert.equal(renewed.token,'renewed-token');assert.equal(renewed.refreshToken,'rotated-refresh');
  await again.complete('linux-location');assert.ok(again.remote.users.get('student-a').has('linux-location'));
});
test('active account renews before expiry without logging the student out',async()=>{
  const b=await browser();await b.expire();
  assert.equal(b.elements.get('account-login').hidden,true);
  assert.ok(b.remote.calls.some(c=>c.grant==='refresh_token'));
  await b.complete('linux-location');assert.ok(b.remote.users.get('student-a').has('linux-location'));
});
test('rejected refresh credentials clear session and never grant account access',async()=>{
  const first=await browser();const saved=JSON.parse(first.session.getItem('linform-tab-session-v1'));
  saved.expiresAt=Date.now()-1000;first.session.setItem('linform-tab-session-v1',JSON.stringify(saved));first.remote.rejectRefresh=true;
  const again=await browser({authenticated:false,sessionStore:first.session,remote:first.remote});
  assert.equal(again.elements.get('account-login').hidden,false);
  assert.equal(again.session.getItem('linform-tab-session-v1'),null);
  assert.equal(again.elements.get('account-profile').hidden,true);
});
test('sign out removes reload credentials and next reload remains signed out',async()=>{
  const b=await browser();await b.click('account-logout');
  assert.equal(b.session.getItem('linform-tab-session-v1'),null);
  const again=await browser({authenticated:false,sessionStore:b.session,local:b.local,remote:b.remote});
  assert.equal(again.elements.get('account-login').hidden,false);
  assert.equal(again.elements.get('account-profile').hidden,true);
});
test('sign out during refresh prevents a late token response from restoring the session',async()=>{
  const b=await browser();let release;b.remote.refreshGate=new Promise(resolve=>release=resolve);
  await b.expire();await b.click('account-logout');release();await settle();
  assert.equal(b.session.getItem('linform-tab-session-v1'),null);
  assert.equal(b.elements.get('account-login').hidden,false);
});
