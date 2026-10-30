import { run } from 'wasi-sh/run';
import { memoryFs, isDir } from 'wasi-sh/fs';
import {createLinuxBuiltins} from './linux-builtins.mjs';

let module, store, cwd, environment, system, lastExit = 0;
const linuxBuiltins=createLinuxBuiltins(()=>store,()=>system);
const HOME = '/home/learner';
const defaults = () => ({HOME,USER:'learner',LOGNAME:'learner',PATH:'/',TERM:'dumb',LANG:'C.UTF-8'});
const quote = value => "'" + value.replace(/'/g,"'\\''") + "'";
function readFile(path) {
  const size=store.statSync(path).size;
  const bytes=new Uint8Array(size); store.readSync(path,bytes,0,size); return bytes;
}
function snapshot() {
  const entries=[];let total=0;
  function visit(path) {
    const stat=store.statSync(path), directory=isDir(stat.mode);
    if(entries.length>=512)throw new Error('Practice workspace limit: 512 files and folders.');
    const data=directory?null:readFile(path);
    total+=data?.byteLength||0;
    if(total>8*1024*1024)throw new Error('Practice workspace limit: 8 MB.');
    entries.push({path,directory,mode:stat.mode,uid:stat.uid,gid:stat.gid,data});
    if(directory)for(const name of store.readdirSync(path))visit(path==='/'?'/'+name:path+'/'+name);
  }
  visit('/');
  return {entries,cwd,environment,system,lastExit};
}
function reset(saved) {
  cwd=HOME;environment=defaults();lastExit=0;
  system=saved?.system||{users:{root:0,learner:1000},processes:{101:'nginx',102:'worker'},services:{nginx:'stopped'},packages:{busybox:true},firewall:false,rules:[],mounts:['linform on / type memory (browser-only)']};
  const files=saved?Object.fromEntries(saved.entries.filter(e=>!e.directory).map(e=>[e.path,e.data])):{[HOME+'/welcome.txt']:'Welcome to Linform.\nLinux\nAWS\nAzure\nTerraform\n'};
  store=memoryFs(files);
  if(saved) {
    for(const e of saved.entries.filter(e=>e.directory).sort((a,b)=>a.path.length-b.path.length)){
      try{store.mkdirSync(e.path,{mode:e.mode,uid:0,gid:0});}catch{}
    }
    for(const e of saved.entries)store.touchSync(e.path,{mode:e.mode,uid:e.uid??1000,gid:e.gid??1000});
    cwd=saved.cwd;environment={...defaults(),...saved.environment};lastExit=saved.lastExit||0;
  }
  if(!saved){store.touchSync(HOME,{uid:1000,gid:1000});store.touchSync(HOME+'/welcome.txt',{uid:1000,gid:1000});}
  for(const name of ['createFileSync','mkdirSync']){const method=store[name].bind(store);store[name]=(path,options={})=>method(path,{...options,uid:1000,gid:1000});}
  const write=store.writeSync.bind(store);
  store.writeSync=(path,buffer,offset)=>{
    if(offset+buffer.length>1024*1024)throw new Error('Practice file limit: 1 MB.');
    write(path,buffer,offset);
  };
}
const checks={
  folder:'test -d /home/learner/cloud-lab && test -f /home/learner/cloud-lab/notes.txt',
  text:"grep -q 'Azure' /home/learner/cloud-lab/notes.txt",
  pipeline:"test -f /home/learner/cloud-lab/matches.txt && grep -q 'ERROR' /home/learner/cloud-lab/matches.txt && ! grep -q 'INFO' /home/learner/cloud-lab/matches.txt"
};
self.onmessage=async({data})=>{
  const id=data.id;
  try {
    if(data.type==='init'){
      module=await WebAssembly.compile(data.bytes);reset(data.snapshot);
      self.postMessage({type:'ready',cwd,snapshot:snapshot()});return;
    }
    if(!module)throw new Error('Start the terminal first.');
    if(data.type==='reset'){
      reset();self.postMessage({type:'reset',cwd,snapshot:snapshot()});return;
    }
    if(!['run','check'].includes(data.type))throw new Error('Unknown terminal request.');
    const command=data.type==='check'?checks[data.check]:data.command;
    if(typeof command!=='string'||command.length>12000)throw new Error('Use a command or script shorter than 12,000 characters.');
    let count=0;
    const capture=data.type==='run';
    let nextCwd=cwd,nextEnv=environment;
    const result=await run({
      wasm:module,inline:true,fs:store,
      env:environment,
      builtins:{
        ...linuxBuiltins,
        help:linuxBuiltins.__linform_manuals,
        __linform_capture(ctx){nextCwd=ctx.cwd;nextEnv={...ctx.env};return 0;},
        __linform_previous(){return lastExit;}
      },
      command:'cd '+quote(cwd)+' || exit 1\n'+
        'sudo() { printf "[practice sudo: no real privileges are elevated]\\n" >&2; "$@"; }\n'+
        'ls() { __linform_ls "$@"; }\n'+
        'kill() { __linform_kill "$@"; }\n'+
        (capture?"if [ -f /.linform-aliases ]; then . /.linform-aliases; fi\ntrap 'alias | sed \"s/^/alias /\" > /.linform-aliases; __linform_capture' EXIT\n__linform_previous\n":'')+command,
      onOutput(bytes,channel){
        count+=bytes.length;
        if(count>65536)throw new Error('Output limit reached. Use head to show fewer lines.');
        if(capture)self.postMessage({type:'output',id,channel,bytes:bytes.slice()});
      }
    });
    if(capture){
      cwd=nextCwd;environment=nextEnv;lastExit=result.exitCode;
      try{if(!isDir(store.statSync(cwd).mode))cwd='/';}catch{cwd='/';}
    }
    self.postMessage({type:capture?'result':'checked',id,cwd,exitCode:result.exitCode,snapshot:snapshot()});
  }catch(error){self.postMessage({type:'error',id,message:error.message||'This command could not finish.'});}
};
