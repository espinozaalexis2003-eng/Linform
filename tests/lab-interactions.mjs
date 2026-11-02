import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {Worker as NodeWorker} from 'node:worker_threads';
const html=fs.readFileSync(process.argv[2]||'index.html','utf8'),scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const workerSource=html.match(/<script type="text\/plain" id="linform-lab-worker">([\s\S]*?)<\/script>/)[1];
const bytes=process.env.LINFORM_WASM_PATH?new Uint8Array(fs.readFileSync(process.env.LINFORM_WASM_PATH)):new Uint8Array(await(await fetch('https://cdn.jsdelivr.net/npm/wasi-sh@0.11.0/dist/busybox.wasm')).arrayBuffer());
const wait=async(predicate)=>{const until=Date.now()+10000;while(!predicate()){if(Date.now()>until)throw Error('UI state timed out');await new Promise(r=>setTimeout(r,5));}};
function dom(){const elements=new Map(),events={};
 class E{
  constructor(tag='div'){this.tag=tag;this.children=[];this.handlers={};this.style={setProperty(){}};this.dataset={};this.attributes={};this.value='';this.disabled=false;this.hidden=false;this.open=false;this._text='';this.className='';this.classList={add(){},remove(){},toggle(){}};}
  set id(v){this._id=v;elements.set(v,this)}get id(){return this._id}
  set innerHTML(s){for(const m of s.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const e=new E(m[1]);e.id=m[3];e.disabled=/\bdisabled\b/.test(m[2]);e.hidden=/\bhidden\b/.test(m[2]);if(e.id==='lab-task')e.value='folder';if(e.id==='tf-command-list')e.value='init';}}
  set textContent(v){this._text=String(v??'');this.children=[]}get textContent(){return this._text+this.children.map(e=>e.textContent).join(' ')}
  append(...items){for(const e of items){e.parent=this;this.children.push(e)}}prepend(...items){this.children.unshift(...items)}replaceChildren(...items){this._text='';this.children=[];this.append(...items)}before(){}insertBefore(e){this.append(e)}
  get childNodes(){return this.children}get firstChild(){return this.children[0]}get scrollHeight(){return 100}get selectionStart(){return 0}get selectionEnd(){return 0}
  addEventListener(n,f){this.handlers[n]=f}setAttribute(k,v){this.attributes[k]=v}focus(){this.focused=true}getClientRects(){return [{}]}
  querySelectorAll(){return []}querySelector(q){return this.children.find(e=>q==='h2'?e.tag==='h2':q==='.shell-command'?e.className==='shell-command':false)||null}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this)}showModal(){this.open=true}close(){this.open=false}
  click(){if(!this.disabled)return this.handlers.click?.({preventDefault(){}})}
 }
 const doc={createElement:t=>new E(t),getElementById:id=>elements.get(id),querySelector:()=>new E(),addEventListener(){}};
 for(const id of ['commands','view-practice','linux-lab']){const e=new E();e.id=id;}
 return {E,doc,e:id=>elements.get(id),window:{addEventListener:(n,f)=>events[n]=f,getSelection:()=>''},events};
}
const d=dom(),workers=new Set();const embeddedWorker=new d.E();embeddedWorker.id='linform-lab-worker';embeddedWorker.textContent=workerSource;
class BrowserWorker{
 constructor(){this.worker=new NodeWorker("const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:data=>parentPort.postMessage(data)};"+workerSource+";parentPort.on('message',data=>self.onmessage({data}));",{eval:true});workers.add(this);this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>{console.error(error);this.onerror?.(error);});}
 postMessage(data){this.worker.postMessage(data)}terminate(){workers.delete(this);return this.worker.terminate()}
}
const ctx=vm.createContext({document:d.doc,window:d.window,TextDecoder,TextEncoder,Uint8Array,Blob,Worker:BrowserWorker,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},setTimeout,clearTimeout,fetch:async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}),AbortSignal});
vm.runInContext(scripts.find(s=>s.includes("section.id='linux-lab'")),ctx);
const run=async text=>{d.e('terminal-input').value=text;d.e('terminal-form').handlers.submit({preventDefault(){}});await wait(()=>!d.e('terminal-input').disabled);};
try{
 d.e('lab-start').click();try{await wait(()=>!d.e('terminal-input').disabled);}catch(error){throw new Error(error.message+': '+d.e('lab-status').textContent);}
 await run('mkdir -p cloud-lab');await run('cat > cloud-lab/notes.txt');assert.equal(d.e('lab-finish').hidden,false);
 await run('Azure');await run("$(echo should-not-run); literal 'quotes'");d.e('lab-finish').click();assert.equal(d.e('lab-finish').hidden,true);
 await run('cat cloud-lab/notes.txt');assert.ok(d.e('terminal-transcript').textContent.includes("Azure\n$(echo should-not-run); literal 'quotes'\n"));
 await run('cat >> cloud-lab/notes.txt');await run('Terraform');d.e('terminal-input').handlers.keydown({key:'d',ctrlKey:true,preventDefault(){}});assert.equal(d.e('lab-finish').hidden,true);
 await run('nano cloud-lab/notes.txt');assert.equal(d.e('lab-editor').open,true);assert.ok(d.e('lab-editor-text').value.includes('Terraform'));
 d.e('lab-editor-text').value='Cloud engineer\nLinux + Azure\n';d.e('lab-editor-save').click();await wait(()=>!d.e('lab-editor-save').disabled);d.e('lab-editor-close').click();assert.equal(d.e('lab-editor').open,false);
 await run('cat cloud-lab/notes.txt');assert.ok(d.e('terminal-transcript').textContent.includes('Cloud engineer\nLinux + Azure\n'));
 await run('nano cloud-lab/profile.txt');d.e('lab-editor-text').value='Cloud engineer';d.e('lab-editor-save').click();await wait(()=>!d.e('lab-editor-save').disabled);d.e('lab-editor-close').click();
 d.e('lab-task').value='editor';d.e('lab-check').click();await wait(()=>!d.e('lab-check').disabled);assert.match(d.e('lab-check-status').textContent,/Challenge complete/);
 await run('nano cloud-lab/profile.txt');d.e('lab-editor-text').value='unsaved';d.e('lab-editor-close').click();assert.equal(d.e('lab-editor').open,true);assert.equal(d.e('lab-editor-discard').hidden,false);d.e('lab-editor-discard').click();assert.equal(d.e('lab-editor').open,false);
 await run('cat > cloud-lab/notes.txt');await run('Azure');d.e('lab-finish').click();await run('echo Terraform >> cloud-lab/notes.txt');await run('cp cloud-lab/notes.txt cloud-lab/backup.txt');
 for(const challenge of ['folder','text','append','copy']){d.e('lab-task').value=challenge;d.e('lab-check').click();await wait(()=>!d.e('lab-check').disabled);assert.match(d.e('lab-check-status').textContent,/Challenge complete/,challenge);}
 await run('mv cloud-lab/backup.txt cloud-lab/archive.txt');await run("printf 'INFO ok\\nERROR fail\\n' | grep ERROR > cloud-lab/matches.txt");await run("printf 'Linux\\nAWS\\nAzure\\n' | sort > cloud-lab/sorted.txt");
 for(const challenge of ['rename','pipeline','sort']){d.e('lab-task').value=challenge;d.e('lab-check').click();await wait(()=>!d.e('lab-check').disabled);assert.match(d.e('lab-check-status').textContent,/Challenge complete/,challenge);}
 console.log('PASS: real WASM files support nano open/save/discard, cat truncate/append/Ctrl+D, literal text safety and all eight challenge checks.');
}finally{await Promise.all([...workers].map(w=>w.terminate()));}
const t=dom();const tfctx=vm.createContext({document:t.doc,window:t.window,location:{hash:'#terraform'}});vm.runInContext(scripts.find(s=>s.includes('class Simulator')),tfctx);vm.runInContext(scripts.find(s=>s.includes('const {Simulator,COMMANDS}=window.LinformTerraform')),tfctx);
const tfRun=command=>{t.e('tf-input').value=command;t.e('tf-form').handlers.submit({preventDefault(){}});};
assert.equal(t.e('tf-guide-progress').textContent,'STEP 1 OF 8');
for(const command of ['terraform init','terraform plan','terraform apply','yes','terraform output'])tfRun(command);
assert.equal(t.e('tf-guide-progress').textContent,'STEP 5 OF 8');t.e('tf-guide-use').click();assert.ok(t.e('tf-config').value.includes('my-first-project'));t.e('tf-save').click();assert.equal(t.e('tf-guide-progress').textContent,'STEP 6 OF 8');
for(const command of ['terraform plan','terraform apply','yes','terraform output'])tfRun(command);
assert.equal(t.e('tf-guide-progress').textContent,'WORKFLOW COMPLETE');assert.match(t.e('tf-result-summary').textContent,/applied state/);t.e('tf-reset').click();assert.equal(t.e('tf-guide-progress').textContent,'STEP 1 OF 8');
console.log('PASS: Terraform guides each step through initialization, planning, confirmation, output, a saved edit, updated state and reset.');
