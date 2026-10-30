import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

const html=readFileSync('index.html','utf8');
const source=html.match(/<script type="text\/plain" id="linform-lab-worker">([\s\S]*?)<\/script>/)[1];
const bytes=process.env.LINFORM_WASM_PATH ? new Uint8Array(readFileSync(process.env.LINFORM_WASM_PATH))
  : new Uint8Array(await (await fetch('https://cdn.jsdelivr.net/npm/wasi-sh@0.11.0/dist/busybox.wasm',{signal:AbortSignal.timeout(20000)})).arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'),'195b770af8fad458de09144abd3cc3e688a9a83907ca90f7938a253253dfb9b3','pinned WASM integrity');
async function terminal(saved){
  const wrapper="const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:data=>parentPort.postMessage(data)};"+source+";parentPort.on('message',data=>self.onmessage({data}));";
  const worker=new Worker(wrapper,{eval:true});let id=0;const output=[];
  const request=data=>new Promise((resolve,reject)=>{
    const current=++id;let text='';
    const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Terminal test timed out'));},10000);
    const onMessage=message=>{
      if(message.type==='output'){text+=new TextDecoder().decode(message.bytes);output.push(message);return;}
      if(message.id!==undefined&&message.id!==current)return;
      worker.off('message',onMessage);clearTimeout(timeout);
      if(message.type==='error')reject(new Error(message.message));else resolve({...message,output:text});
    };
    worker.on('message',onMessage);worker.postMessage({...data,id:current});
  });
  await request({type:'init',bytes,...(saved?{snapshot:saved}:{})});
  return {run:command=>request({type:'run',command}),check:check=>request({type:'check',check}),reset:()=>request({type:'reset'}),close:()=>worker.terminate(),output};
}
test('cd, files and prompt directory persist between commands',async()=>{
  const t=await terminal();try{
    await t.run('mkdir -p cloud-lab');
    assert.equal((await t.run('cd cloud-lab')).cwd,'/home/learner/cloud-lab');
    assert.equal((await t.run('pwd')).output.trim(),'/home/learner/cloud-lab');
    await t.run("printf 'Azure\\n' > notes.txt");
    assert.equal((await t.run('cat notes.txt')).output,'Azure\n');
    await t.run('cd ..');assert.equal((await t.run('pwd')).cwd,'/home/learner');
  }finally{await t.close();}
});
test('exported variables and previous exit status carry over',async()=>{
  const t=await terminal();try{
    await t.run('export TOPIC=Azure');assert.equal((await t.run('echo "$TOPIC"')).output,'Azure\n');
    assert.equal((await t.run('false')).exitCode,1);
    assert.equal((await t.run('echo $?')).output,'1\n');
  }finally{await t.close();}
});
test('stdout and stderr stream and a missing command fails',async()=>{
  const t=await terminal();try{
    assert.equal((await t.run('echo hello; echo problem >&2')).output,'hello\nproblem\n');
    assert.ok(t.output.some(message=>message.channel==='stderr'));
    const result=await t.run('linform_command_that_does_not_exist');
    assert.equal(result.exitCode,127);assert.match(result.output,/not found/);
  }finally{await t.close();}
});
test('pipes and challenge checks inspect files without changing directory',async()=>{
  const t=await terminal();try{
    await t.run('mkdir -p cloud-lab; cd cloud-lab');
    await t.run("printf 'Azure\\n' > notes.txt; printf 'INFO start\\nERROR fail\\n' | grep ERROR > matches.txt");
    for(const key of ['folder','text','pipeline'])assert.equal((await t.check(key)).exitCode,0);
    assert.equal((await t.run('pwd')).output,'/home/learner/cloud-lab\n');
  }finally{await t.close();}
});
test('last completed snapshot restores files, directories and environment after stop',async()=>{
  const t=await terminal();let saved;
  try{saved=(await t.run("mkdir -p empty; mkdir -p project; cd project; export TOPIC=Linux; printf 'saved\\n' > note.txt")).snapshot;}
  finally{await t.close();}
  const next=await terminal(saved);try{
    assert.equal((await next.run('pwd; cat note.txt; echo "$TOPIC"')).output,'/home/learner/project\nsaved\nLinux\n');
    assert.equal((await next.run('test -d ../empty')).exitCode,0);
  }finally{await next.close();}
});
test('reset removes practice files and restores the initial home folder',async()=>{
  const t=await terminal();try{
    await t.run('mkdir project; cd project; touch temporary.txt');
    const fresh=await t.reset();assert.equal(fresh.cwd,'/home/learner');
    assert.equal((await t.run('test -e project/temporary.txt')).exitCode,1);
    assert.match((await t.run('cat welcome.txt')).output,/Welcome to Linform/);
  }finally{await t.close();}
});
test('extended file tools work on real virtual files and metadata',async()=>{
 const t=await terminal();try{
  assert.match((await t.run('whoami; id')).output,/learner/);
  await t.run("printf 'alpha\\nbeta\\n' > a.txt; cp a.txt b.txt; chmod 600 a.txt");
  assert.match((await t.run('ls -l a.txt')).output,/-rw-------/);
  assert.equal((await t.run('cmp a.txt b.txt')).exitCode,0);
  await t.run("echo gamma >> b.txt");assert.equal((await t.run('diff a.txt b.txt')).exitCode,1);
  assert.match((await t.run('less a.txt')).output,/alpha/);
  assert.equal((await t.run('ln a.txt linked.txt; cat linked.txt')).output,'alpha\nbeta\n');
  await t.run('tar -cf notes.tar a.txt b.txt; mkdir unpack; cd unpack; tar -xf ../notes.tar');
  assert.equal((await t.run('cat a.txt')).output,'alpha\nbeta\n');
  assert.equal((await t.run('dd if=a.txt of=copy.txt bs=1 count=5; cat copy.txt')).output.includes('alpha'),true);
 }finally{await t.close();}
});
test('aliases persist and system simulations change only practice state',async()=>{
 const t=await terminal();let saved;try{
  await t.run("alias hi='echo hello'");assert.equal((await t.run('hi')).output,'hello\n');
  assert.match((await t.run('service nginx start')).output,/simulation/);
  assert.match((await t.run('service nginx status')).output,/running/);
  await t.run('useradd student; touch owned.txt; chown student owned.txt');
  saved=(await t.run('ufw enable')).snapshot;
  assert.match((await t.run('ufw status')).output,/active/);
  assert.match((await t.run('wget https://example.com')).output,/disabled|unavailable|network/i);
 }finally{await t.close();}
 const restored=await terminal(saved);try{
  assert.match((await restored.run('service nginx status')).output,/running/);
  assert.match((await restored.run('ufw status')).output,/active/);
  assert.equal((await restored.run('hi')).output,'hello\n');
 }finally{await restored.close();}
});
