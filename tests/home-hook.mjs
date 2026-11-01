import {readFileSync} from 'node:fs';
import {Worker as Thread} from 'node:worker_threads';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=readFileSync(process.argv[2]||'index.html','utf8');
const kernel=html.match(/<script type="text\/plain" id="linform-lab-worker">([\s\S]*?)<\/script>/)[1];
const script=html.match(/<script id="linform-hook">([\s\S]*?)<\/script>/)[1];
const bytes=process.env.LINFORM_WASM_PATH?new Uint8Array(readFileSync(process.env.LINFORM_WASM_PATH)):new Uint8Array(await(await fetch('https://cdn.jsdelivr.net/npm/wasi-sh@0.11.0/dist/busybox.wasm',{signal:AbortSignal.timeout(20000)})).arrayBuffer());
class Element{
 constructor(id=''){this.id=id;this.children=[];this.handlers={};this.dataset={};this.attributes={};this.value='';this.hidden=false;this.textContent='';this.focuses=0;}
 get childNodes(){return this.children;}
 get firstChild(){return this.children[0];}
 append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(name,fn){this.handlers[name]=fn;}
 focus(){this.focuses++;}
}
const ids=new Map();const el=id=>{if(!ids.has(id))ids.set(id,new Element(id));return ids.get(id);};
el('linform-lab-worker').textContent=kernel;el('hook-cloud').hidden=true;
const chips=['pwd','ls','mkdir cloud-lab'].map(command=>{const n=new Element();n.dataset.hookCommand=command;return n;});
const stages=['plan','apply','running'].map(stage=>{const n=new Element();n.dataset.cloudStage=stage;return n;});
const document={getElementById:el,createElement:()=>new Element(),visibilityState:'visible',querySelectorAll:selector=>selector==='[data-hook-command]'?chips:selector==='[data-cloud-stage]'?stages:[]};
const blobs=new Map(),threads=[];let blobId=0,fetches=0;
class Blob{constructor(parts){this.parts=parts;}}
const URL={createObjectURL(blob){const id='blob:fixture-'+(++blobId);blobs.set(id,blob);return id;},revokeObjectURL(id){blobs.delete(id);}};
class Worker{
 constructor(url){const code=blobs.get(url).parts.join('');this.thread=new Thread("const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:data=>parentPort.postMessage(data)};"+code+";parentPort.on('message',data=>self.onmessage({data}));",{eval:true});threads.push(this);this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',error=>this.onerror?.(error));}
 postMessage(data){this.thread.postMessage(data);}
 terminate(){return this.thread.terminate();}
}
const cloudTimers=new Map(),realTimers=new Set();let timerId=0;
function setTimer(fn,delay){if(delay===650||delay===1450){const id='cloud-'+(++timerId);cloudTimers.set(id,{fn,delay});return id;}const id=setTimeout(fn,delay);realTimers.add(id);return id;}
function clearTimer(id){if(cloudTimers.has(id))cloudTimers.delete(id);else {clearTimeout(id);realTimers.delete(id);}}
const window={addEventListener(){}};
const context=vm.createContext({document,window,Blob,URL,Worker,TextDecoder,TextEncoder,AbortSignal,setTimeout:setTimer,clearTimeout:clearTimer,fetch:async url=>{assert.match(url,/^https:\/\/cdn\.jsdelivr\.net\/npm\/wasi-sh@0\.11\.0\/dist\/busybox\.wasm$/);fetches++;return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}});
const waitFor=async check=>{for(let n=0;n<150;n++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw Error('UI condition timed out: '+el('hook-linux-status').textContent);};
const click=node=>node.handlers.click({preventDefault(){}});
const command=async text=>{el('hook-command').value=text;el('hook-form').handlers.submit({preventDefault(){}});await waitFor(()=>!el('hook-run').disabled&&el('hook-linux-status').textContent!=='Running '+text+'…');};
try{
 vm.runInContext(script,context);
 assert.equal(el('hook-command').focuses,0,'landing does not open a mobile keyboard automatically');
 el('hook-command').value='pwd';el('hook-form').handlers.submit({preventDefault(){}});
 await waitFor(()=>el('hook-goal-pwd').dataset.done==='true');
 assert.ok(el('hook-output').children.some(n=>n.textContent.includes('/home/learner')));
 await command('ls');assert.equal(el('hook-goal-ls').dataset.done,'true');
 await command('mkdir cloud-lab');assert.equal(el('hook-goal-folder').dataset.done,'true');
 assert.ok(el('hook-files').children.some(n=>n.children.some(x=>x.textContent==='cloud-lab/')));
 await command('cd cloud-lab');assert.equal(el('hook-prompt').textContent,'learner:~/cloud-lab $');
 await command('touch notes.txt');assert.ok(el('hook-files').children.some(n=>n.children.some(x=>x.textContent==='cloud-lab/notes.txt')));
 await command('clear');assert.equal(el('hook-output').children.length,0);assert.equal(el('hook-goal-folder').dataset.done,'true');
 click(el('hook-reset'));await waitFor(()=>el('hook-linux-status').textContent.startsWith('Ready.'));
 assert.equal(el('hook-goal-folder').dataset.done,'false');assert.equal(el('hook-prompt').textContent,'learner:~ $');
 assert.equal(fetches,1,'reset reuses the downloaded binary');
 click(el('hook-cloud-tab'));assert.equal(el('hook-linux').hidden,true);assert.equal(el('hook-cloud').hidden,false);
 click(el('hook-deploy'));assert.equal(el('hook-architecture').dataset.stage,'plan');
 [...cloudTimers.values()].find(t=>t.delay===650).fn();assert.equal(el('hook-architecture').dataset.stage,'apply');
 [...cloudTimers.values()].find(t=>t.delay===1450).fn();assert.equal(el('hook-architecture').dataset.stage,'running');assert.equal(el('hook-cloud-count').textContent,'1 simulated instance');
 assert.equal(fetches,1,'the EC2 demo never calls a cloud API');
 click(el('hook-cloud-reset'));assert.equal(el('hook-architecture').dataset.stage,'idle');assert.equal(el('hook-cloud-count').textContent,'0 instances');
 click(el('hook-deploy'));const stale=[...cloudTimers.values()].find(t=>t.delay===1450).fn;click(el('hook-cloud-reset'));stale();assert.equal(el('hook-architecture').dataset.stage,'idle','reset cancels a stale animation');
 console.log('PASS: real WASM pwd/ls/mkdir/cd/touch, queued first command, live files, history-safe reset, no autofocus, EC2 stages/reset, and no cloud calls.');
}finally{for(const worker of threads)await worker.terminate();for(const timer of realTimers)clearTimeout(timer);}
