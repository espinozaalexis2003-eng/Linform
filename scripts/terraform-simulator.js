/* Linform's constrained, browser-only Terraform teaching simulator. No eval or cloud calls. */
(() => {
  'use strict';
  const STARTER=`variable "project_name" {
  type    = string
  default = "linform-lab"
}

resource "terraform_data" "lesson" {
  input = var.project_name
}

output "project_name" {
  value = terraform_data.lesson.output
}
`;
  const COMMANDS={init:'Initialize this practice project',validate:'Check the supported configuration',fmt:'Format the practice file',plan:'Preview practice changes',apply:'Apply changes to the simulated state',destroy:'Remove simulated resources',output:'Inspect root outputs',show:'Inspect state or a saved practice plan',state:'List, show, move, remove, pull or push practice state',workspace:'Create, select, list or delete isolated practice states',import:'Add a configured resource to practice state',taint:'Mark a simulated resource for replacement',untaint:'Remove a replacement marker',refresh:'Reconcile the local simulated state',graph:'Print a small dependency diagram',providers:'Inspect the built-in teaching provider',get:'Explain module retrieval without downloads',console:'Explore supported expressions',test:'Run Linform learning checks',login:'Explain remote authentication; no tokens accepted',logout:'Explain remote logout; no credentials stored','force-unlock':'Release a simulated state lock',version:'Identify the simulator',metadata:'Inspect the lab command metadata',modules:'List module support in this lab',stacks:'Explore the Stacks command family',query:'Explain query support limits'};
  function words(input){
    const out=[];let value='',quote='',escape=false,started=false;
    for(const ch of input){
      if(escape){value+=ch;escape=false;started=true;continue;}
      if(ch==='\\'&&quote!=="'"){escape=true;continue;}
      if(quote){if(ch===quote)quote='';else value+=ch;started=true;continue;}
      if(ch==='"'||ch==="'"){quote=ch;started=true;}
      else if(/\s/.test(ch)){if(started){out.push(value);value='';started=false;}}
      else{value+=ch;started=true;}
    }
    if(quote||escape)throw new Error('Close the quote or escape before running the command.');
    if(started)out.push(value);return out;
  }
  function blocks(source){
    const result=[];let i=0;
    while(i<source.length){
      while(i<source.length&&/\s/.test(source[i]))i++;
      if(source.startsWith('//',i)||source[i]==='#'){i=source.indexOf('\n',i);if(i<0)break;continue;}
      if(i>=source.length)break;
      const match=source.slice(i).match(/^(variable|resource|output)\s+"([\w-]+)"(?:\s+"([\w-]+)")?\s*\{/);
      if(!match)throw new Error('This lab supports variable, terraform_data resource, and output blocks only. Check the syntax near: '+source.slice(i,i+45));
      if(['__proto__','constructor','prototype'].includes(match[2])||['__proto__','constructor','prototype'].includes(match[3]))throw new Error('Use a different practice block name.');
      i+=match[0].length;const start=i;let depth=1,quoted=false,escaped=false;
      for(;i<source.length;i++){const ch=source[i];if(escaped){escaped=false;continue;}if(ch==='\\'&&quoted){escaped=true;continue;}if(ch==='"'){quoted=!quoted;continue;}if(!quoted){if(ch==='{')depth++;if(ch==='}'&&--depth===0)break;}}
      if(depth||quoted)throw new Error('An opening brace or string is not closed.');
      const body=source.slice(start,i++),attrs={};
      for(const raw of body.split('\n')){const line=raw.trim();if(!line||line.startsWith('#')||line.startsWith('//'))continue;const assignment=line.match(/^([a-zA-Z_]\w*)\s*=\s*(.+)$/);if(!assignment)throw new Error('Use one supported attribute assignment per line: '+line);if(Object.hasOwn(attrs,assignment[1]))throw new Error('Duplicate attribute '+assignment[1]);attrs[assignment[1]]=assignment[2].trim();}
      result.push({kind:match[1],name:match[2],second:match[3],attrs});
    }
    return result;
  }
  function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
  const clone=value=>JSON.parse(JSON.stringify(value));
  class Simulator{
    constructor(){this.reset();}
    reset(){this.config=STARTER;this.initialized=false;this.current='default';this.workspaces={default:{resources:{},outputs:{},serial:0,tainted:[],lock:null}};this.files={};this.pending=null;this.consoleMode=false;this.steps={init:false,plan:false,apply:false};}
    get state(){return this.workspaces[this.current];}
    expression(source,context={variables:{},resources:this.state.resources}){
      const value=source.trim();
      if(value==='terraform.workspace')return this.current;
      if(/^var\.[\w-]+$/.test(value)){const key=value.slice(4);if(!Object.hasOwn(context.variables,key))throw new Error('No value for variable '+key);return context.variables[key];}
      const ref=value.match(/^(terraform_data\.[\w-]+)\.(input|output|id)$/);
      if(ref){if(!context.resources[ref[1]])throw new Error('Unknown resource '+ref[1]);return context.resources[ref[1]][ref[2]];}
      const call=value.match(/^(upper|lower|length|tostring|tonumber)\(([\s\S]*)\)$/);
      if(call){const arg=this.expression(call[2],context);if(call[1]==='upper')return String(arg).toUpperCase();if(call[1]==='lower')return String(arg).toLowerCase();if(call[1]==='length'){if(typeof arg!=='string'&&!Array.isArray(arg))throw new Error('length expects a string or list');return arg.length;}if(call[1]==='tonumber'){const n=Number(arg);if(!Number.isFinite(n))throw new Error('Value is not a number');return n;}return String(arg);}
      try{const literal=JSON.parse(value);if(typeof literal==='string')return literal.replace(/\$\{([^}]+)\}/g,(_,expr)=>String(this.expression(expr,context)));return literal;}catch(error){if(error.message.startsWith('No value')||error.message.startsWith('Unknown resource'))throw error;}
      throw new Error('Unsupported expression in this teaching subset: '+value+'. Try a literal, var.name, terraform.workspace, a terraform_data attribute, or upper/lower/length.');
    }
    model(overrides={}){
      const parsed=blocks(this.config),variables={},resources={},outputs={},seen=new Set();
      for(const block of parsed){const id=block.kind+':'+block.name+':'+(block.second||'');if(seen.has(id))throw new Error('Duplicate block '+block.name);seen.add(id);}
      for(const block of parsed.filter(b=>b.kind==='variable')){
        if(block.second)throw new Error('A variable block takes one label.');
        for(const key of Object.keys(block.attrs))if(!['type','default','description','sensitive'].includes(key))throw new Error('Unsupported variable attribute '+key);
        const value=Object.hasOwn(overrides,block.name)?overrides[block.name]:block.attrs.default===undefined?undefined:this.expression(block.attrs.default);
        if(value===undefined)throw new Error('Set a default or pass -var='+block.name+'=VALUE');
        const type=block.attrs.type;if(type&&!['string','number','bool'].includes(type))throw new Error('Supported variable types: string, number, bool.');
        const expected={string:'string',number:'number',bool:'boolean'}[type];if(expected&&typeof value!==expected)throw new Error('Variable '+block.name+' must be '+type);
        variables[block.name]=value;
      }
      for(const key of Object.keys(overrides))if(!parsed.some(b=>b.kind==='variable'&&b.name===key))throw new Error('Undeclared variable '+key);
      for(const block of parsed.filter(b=>b.kind==='resource')){
        if(block.name!=='terraform_data'||!block.second)throw new Error('Only terraform_data resources run in this simulator. Real cloud providers are not connected.');
        if(Object.keys(block.attrs).some(key=>key!=='input'))throw new Error('This lab supports the terraform_data input attribute only.');
        const address='terraform_data.'+block.second,input=block.attrs.input===undefined?null:this.expression(block.attrs.input,{variables,resources});
        resources[address]={input,output:input,id:this.state.resources[address]?.id||'practice-'+this.current+'-'+block.second};
      }
      for(const block of parsed.filter(b=>b.kind==='output')){
        if(block.attrs.value===undefined)throw new Error('Output '+block.name+' needs a value.');
        if(Object.keys(block.attrs).some(key=>!['value','description','sensitive'].includes(key)))throw new Error('Unsupported output attribute.');
        outputs[block.name]=this.expression(block.attrs.value,{variables,resources});
      }
      return {variables,resources,outputs};
    }
    requireInit(){if(!this.initialized)throw new Error('Project is not initialized. Run terraform init first.');}
    plan(destroy=false,overrides={},replace=[]){
      this.requireInit();const desired=destroy?{resources:{},outputs:{},variables:{}}:this.model(overrides),operations=[];
      for(const [address,value]of Object.entries(desired.resources)){const old=this.state.resources[address];if(!old)operations.push({address,action:'create'});else if(this.state.tainted.includes(address)||replace.includes(address))operations.push({address,action:'replace'});else if(!equal(value.input,old.input))operations.push({address,action:'update'});}
      for(const address of Object.keys(this.state.resources))if(!desired.resources[address])operations.push({address,action:'destroy'});
      const count={add:operations.filter(o=>['create','replace'].includes(o.action)).length,change:operations.filter(o=>o.action==='update').length,destroy:operations.filter(o=>['destroy','replace'].includes(o.action)).length};
      const outputChanged=!equal(desired.outputs,this.state.outputs);
      const summary=`Plan: ${count.add} to add, ${count.change} to change, ${count.destroy} to destroy.`;
      const text=operations.map(o=>`${{create:'+',update:'~',destroy:'-',replace:'-/+'}[o.action]} ${o.address} (${o.action})`).join('\n');
      return {workspace:this.current,stateSerial:this.state.serial,desired,operations,count,outputChanged,summary,text:text+(text?'\n\n':'')+summary+(outputChanged?'\nRoot outputs will change.':'')};
    }
    commit(plan){if(plan.workspace!==this.current)throw new Error('This plan belongs to a different workspace.');if(plan.stateSerial!==this.state.serial)throw new Error('Saved plan is stale. Create a new plan for the current state.');this.state.resources=clone(plan.desired.resources);this.state.outputs=clone(plan.desired.outputs);this.state.serial++;this.state.tainted=[];this.pending=null;this.steps.apply=true;return `[simulation] Apply complete! ${plan.count.add} added, ${plan.count.change} changed, ${plan.count.destroy} destroyed.\n\n`+this.outputText();}
    outputText(){const rows=Object.entries(this.state.outputs);return rows.length?rows.map(([key,value])=>key+' = '+JSON.stringify(value)).join('\n'):'No outputs in the current practice state.';}
    run(input){try{return this.execute(input);}catch(error){return {text:'Error: '+error.message,exitCode:1};}}
    execute(input){
      const raw=input.trim();if(!raw)return {text:'',exitCode:0};
      if(this.pending){if(raw==='yes')return {text:this.commit(this.pending),exitCode:0};if(raw==='no'){this.pending=null;return {text:'Practice apply cancelled. State is unchanged.',exitCode:0};}return {text:'Type yes to apply the simulated changes, or no to cancel.',exitCode:1};}
      if(this.consoleMode){if(raw==='exit'){this.consoleMode=false;return {text:'Left the expression console.',exitCode:0};}return {text:JSON.stringify(this.expression(raw,this.model())),exitCode:0};}
      if(raw.includes('\n'))throw new Error('Run one Terraform command at a time.');
      const args=words(raw);let redirect=null;const redirectIndex=args.findIndex(a=>a==='>'||a==='>>');
      if(redirectIndex>=0){if(redirectIndex!==args.length-2)throw new Error('Use one output file after > or >>.');redirect={append:args[redirectIndex]==='>>',file:args[redirectIndex+1]};if(!/^[\w.-]+$/.test(redirect.file))throw new Error('Use a simple practice filename.');args.splice(redirectIndex);}
      if(args[0]==='clear')return {text:'',clear:true,exitCode:0};
      if(args[0]==='pwd')return {text:'/practice/terraform',exitCode:0};
      if(args[0]==='ls')return {text:['main.tf',...(this.initialized?['.terraform/']:[]),...Object.keys(this.files)].join('\n'),exitCode:0};
      if(args[0]==='cat')return {text:args[1]==='main.tf'?this.config:this.readFile(args[1]),exitCode:0};
      if(args[0]==='help'||(args[0]==='terraform'&&(!args[1]||args[1]==='-help'||args[1]==='--help')))return {text:'Linform Terraform simulator — commands practice the workflow, not a real CLI installation.\n\n'+Object.entries(COMMANDS).map(([key,value])=>key.padEnd(14)+value).join('\n')+'\n\nEdit main.tf, Save file, then init → validate → plan → apply.\nSupported configuration: literal string/number/bool defaults, terraform_data input, root outputs. Other providers, modules, remote services and complete HCL are unavailable.',exitCode:0};
      if(args.shift()!=='terraform')throw new Error('Use terraform COMMAND, help, clear, ls, pwd, or cat main.tf.');
      let command=args.shift();if(command==='-version'||command==='--version')command='version';
      if(!Object.hasOwn(COMMANDS,command))throw new Error('Unknown command. Type terraform -help to see the command explorer.');
      if(args.includes('-help')||args.includes('--help'))return {text:'terraform '+command+' — '+COMMANDS[command]+'\n[Linform simulation; supported options are listed in the lab guide.]',exitCode:0};
      const overrides={},flags=[],positionals=[];
      for(let i=0;i<args.length;i++){
        const arg=args[i];if(arg==='-var'||arg.startsWith('-var=')){const pair=arg==='-var'?args[++i]:arg.slice(5),split=pair?.indexOf('=');if(split===undefined||split<1)throw new Error('Use -var="name=value"');const name=pair.slice(0,split),value=pair.slice(split+1);try{overrides[name]=JSON.parse(value);}catch{overrides[name]=value;}}
        else if(arg==='-out')flags.push('-out='+args[++i]);else if(arg.startsWith('-'))flags.push(arg);else positionals.push(arg);
      }
      const allowed=['-json','-raw','-destroy','-refresh-only','-detailed-exitcode','-no-color','-auto-approve','-check','-diff','-recursive','-upgrade','-reconfigure','-backend=false'];
      for(const flag of flags)if(!allowed.includes(flag)&&!/^-(out|platform|replace)=.+/.test(flag))throw new Error('Unsupported practice option '+flag+'. Try terraform '+command+' -help.');
      const noArgs=['init','validate','fmt','plan','destroy','refresh','graph','get','console','test','login','logout','version'];
      if(noArgs.includes(command)&&positionals.length)throw new Error('Unexpected argument: '+positionals[0]);
      let result={text:'',exitCode:0};
      switch(command){
        case 'version':result.text='Linform Terraform practice simulator\nThis is not a Terraform binary. No cloud credentials or resources are used.';break;
        case 'init':this.initialized=true;this.steps.init=true;result.text='[simulation] Initialized the local practice project.\nBuilt-in terraform_data teaching provider is ready. No backend connection, plugin download, or network access occurred.';break;
        case 'validate':this.requireInit();this.model(overrides);result.text=flags.includes('-json')?JSON.stringify({valid:true,diagnostics:[],simulation:true},null,2):'[simulation] Supported configuration is valid. This is not full Terraform/HCL validation.';break;
        case 'fmt':{
          this.model(overrides);let depth=0;const formatted=this.config.split('\n').map(line=>{const t=line.trim();if(!t)return '';const indent=Math.max(0,depth-(t.startsWith('}')?1:0));const text='  '.repeat(indent)+t.replace(/\s*=\s*/,' = ');let quoted=false;for(let i=0;i<t.length;i++){if(t[i]==='"'&&t[i-1]!=='\\')quoted=!quoted;if(!quoted&&t[i]==='{')depth++;if(!quoted&&t[i]==='}')depth--;}return text;}).join('\n').trim()+'\n';
          const changed=formatted!==this.config;if(flags.includes('-check'))result={text:changed?'main.tf needs practice formatting.':'Practice formatting check passed.',exitCode:changed?3:0};else{this.config=formatted;result.text=changed?'main.tf formatted (teaching formatter).':'main.tf already matches the teaching formatter.';}break;
        }
        case 'plan':{
          const plan=this.plan(flags.includes('-destroy'),overrides,flags.filter(f=>f.startsWith('-replace=')).map(f=>f.slice(9)));this.steps.plan=true;
          if(flags.includes('-refresh-only')){result.text='[simulation] No remote infrastructure exists to refresh. Practice state is unchanged.';break;}
          const out=flags.find(f=>f.startsWith('-out='));if(out){const name=out.slice(5);if(!/^[\w.-]+$/.test(name))throw new Error('Use a simple plan filename.');this.files[name]={kind:'plan',plan:clone(plan)};}
          result.text=flags.includes('-json')?JSON.stringify({simulation:true,...plan},null,2):'[simulation]\n'+plan.text+(out?'\nSaved practice plan to '+out.slice(5):'');
          if(flags.includes('-detailed-exitcode')&&(plan.operations.length||plan.outputChanged))result.exitCode=2;break;
        }
        case 'apply':case 'destroy':{
          if(this.state.lock)throw new Error('Practice state is locked: '+this.state.lock);
          const saved=positionals[0];const plan=saved?(this.files[saved]?.kind==='plan'?clone(this.files[saved].plan):null):this.plan(command==='destroy'||flags.includes('-destroy'),overrides,flags.filter(f=>f.startsWith('-replace=')).map(f=>f.slice(9)));
          if(!plan)throw new Error('No saved practice plan named '+saved);if(plan.workspace!==this.current)throw new Error('Saved plan belongs to '+plan.workspace);
          if(flags.includes('-refresh-only')){result.text='[simulation] No remote system to refresh. Nothing changed.';break;}
          if(flags.includes('-auto-approve')||saved)result.text=this.commit(plan);else{this.pending=plan;result.text='[simulation]\n'+plan.text+'\n\nApply these changes to the practice state only? Type yes or no.';}break;
        }
        case 'output':{
          const name=positionals[0];if(name&&!Object.hasOwn(this.state.outputs,name))throw new Error('No output named '+name+' in practice state.');
          result.text=flags.includes('-json')?JSON.stringify(name?this.state.outputs[name]:this.state.outputs,null,2):flags.includes('-raw')&&name?String(this.state.outputs[name]):name?JSON.stringify(this.state.outputs[name]):this.outputText();break;
        }
        case 'show':result.text=positionals[0]?JSON.stringify(this.files[positionals[0]]||JSON.parse(this.readFile(positionals[0])),null,2):JSON.stringify({simulation:true,workspace:this.current,...this.state},null,2);break;
        case 'state':result=this.stateCommand(positionals);break;
        case 'workspace':result=this.workspaceCommand(positionals);break;
        case 'import':{
          this.requireInit();const [address,id]=positionals;if(!address||!id)throw new Error('Usage: terraform import terraform_data.NAME ID');const model=this.model();if(!model.resources[address])throw new Error('Add the terraform_data resource to main.tf first.');if(this.state.resources[address])throw new Error('Address is already in practice state.');this.state.resources[address]={...model.resources[address],id};this.state.serial++;result.text='[simulation] Imported '+address+' into the practice state. No remote object was read.';break;
        }
        case 'taint':case 'untaint':{
          const address=positionals[0];if(!this.state.resources[address])throw new Error('Resource is not in practice state.');this.state.tainted=this.state.tainted.filter(a=>a!==address);if(command==='taint')this.state.tainted.push(address);result.text='[simulation] '+address+' '+(command==='taint'?'marked for replacement. Prefer terraform apply -replace in real modern workflows.':'replacement marker removed.');break;
        }
        case 'refresh':this.requireInit();result.text='[simulation] There is no remote provider. Practice state remains unchanged. In real projects, review a refresh-only plan before changing state.';break;
        case 'graph':{const model=this.model();result.text='digraph practice {\n'+Object.keys(model.resources).map(a=>'  "'+a+'";').join('\n')+'\n}';break;}
        case 'providers':result.text=positionals[0]==='schema'?JSON.stringify({simulation:true,provider_schemas:{'terraform.io/builtin/terraform':{resource_schemas:{terraform_data:{attributes:['input','output','id']}}}}},null,2):'[simulation] Teaching provider: terraform.io/builtin/terraform\nSupported resource: terraform_data (input only). No plugins installed.';break;
        case 'get':result.text='[simulation] No modules downloaded. This project has no supported module blocks. Use the command explorer for real module documentation.';break;
        case 'modules':result.text='[simulation] No modules declared. Module blocks are outside this teaching subset.';break;
        case 'console':this.requireInit();this.consoleMode=true;result.text='Practice expression console. Try upper("linform"), length("cloud"), var.project_name, or terraform.workspace. Type exit to return.';break;
        case 'test':this.requireInit();this.model();result.text='[simulation] Linform learning checks: supported configuration parsed successfully.\nThis is not Terraform’s .tftest.hcl runner; no real test resources were created.';break;
        case 'login':case 'logout':result.text='[simulation] Remote authentication is unavailable. No tokens are requested, saved, or revoked. Do not paste credentials into this terminal.';break;
        case 'force-unlock':{const id=positionals[0];if(!id)throw new Error('Usage: terraform force-unlock LOCK_ID');if(this.state.lock!==id)throw new Error('No matching simulated lock. No real backend was contacted.');this.state.lock=null;result.text='[simulation] Practice lock released.';break;}
        case 'metadata':result.text=JSON.stringify({simulation:true,commands:Object.keys(COMMANDS),supportedResource:'terraform_data',workspace:this.current},null,2);break;
        case 'stacks':case 'query':result={text:'[simulation] '+command+' is an advanced command family outside this local teaching model. Use terraform '+command+' -help and the official CLI documentation. No external operation occurred.',exitCode:1};break;
      }
      if(redirect&&result.exitCode===0){this.files[redirect.file]=(redirect.append&&typeof this.files[redirect.file]==='string'?this.files[redirect.file]:'')+result.text+'\n';result.text='';}
      return result;
    }
    readFile(name){if(name==='terraform.tfstate')return JSON.stringify({version:4,simulation:true,...this.state});if(typeof this.files[name]==='string')return this.files[name];throw new Error('No readable practice file named '+name);}
    stateCommand(args){
      this.requireInit();const [sub,a,b]=args;
      if(sub==='list')return {text:Object.keys(this.state.resources).join('\n')||'(empty practice state)',exitCode:0};
      if(sub==='pull')return {text:JSON.stringify({version:4,simulation:true,...this.state},null,2),exitCode:0};
      if(sub==='push'){const parsed=JSON.parse(this.readFile(a));if(parsed.simulation!==true||!parsed.resources||!parsed.outputs)throw new Error('Only a state file exported by this simulator can be pushed.');for(const [key,value]of Object.entries(parsed.resources))if(!/^terraform_data\.[\w-]+$/.test(key)||!value||typeof value!=='object')throw new Error('Invalid practice resource.');this.state.resources=clone(parsed.resources);this.state.outputs=clone(parsed.outputs);this.state.serial++;return {text:'[simulation] Restored the exported practice state.',exitCode:0};}
      if(sub==='show'){if(!this.state.resources[a])throw new Error('Resource not in state.');return {text:JSON.stringify(this.state.resources[a],null,2),exitCode:0};}
      if(sub==='rm'){if(!this.state.resources[a])throw new Error('Resource not in state.');delete this.state.resources[a];this.state.serial++;return {text:'[simulation] Removed '+a+' from state only. The configuration remains.',exitCode:0};}
      if(sub==='mv'){if(!this.state.resources[a]||!/^terraform_data\.[\w-]+$/.test(b||'')||this.state.resources[b])throw new Error('Use an existing source and a new terraform_data address.');this.state.resources[b]=this.state.resources[a];delete this.state.resources[a];this.state.serial++;return {text:'[simulation] Moved '+a+' to '+b+' in practice state.',exitCode:0};}
      if(sub==='replace-provider')return {text:'[simulation] Only the built-in teaching provider is supported. No provider addresses changed.',exitCode:1};
      throw new Error('Practice state commands: list, show ADDRESS, rm ADDRESS, mv SOURCE DEST, pull, push FILE.');
    }
    workspaceCommand(args){
      this.requireInit();
      const [sub,name]=args;
      if(sub==='list')return {text:Object.keys(this.workspaces).map(n=>(n===this.current?'* ':'  ')+n).join('\n'),exitCode:0};
      if(sub==='show')return {text:this.current,exitCode:0};
      if(!name||! /^[a-zA-Z0-9_-]{1,50}$/.test(name))throw new Error('Provide a simple workspace name.');
      if(sub==='new'){if(Object.hasOwn(this.workspaces,name))throw new Error('Workspace already exists.');this.workspaces[name]={resources:{},outputs:{},serial:0,tainted:[],lock:null};this.current=name;return {text:'[simulation] Created and selected '+name+'. Its state is empty.',exitCode:0};}
      if(sub==='select'){if(!Object.hasOwn(this.workspaces,name))throw new Error('Unknown workspace.');this.current=name;return {text:'Selected practice workspace '+name,exitCode:0};}
      if(sub==='delete'){if(name==='default'||name===this.current)throw new Error('Cannot delete default or the selected workspace.');if(!Object.hasOwn(this.workspaces,name))throw new Error('Unknown workspace.');if(Object.keys(this.workspaces[name].resources).length)throw new Error('Workspace has resources. Destroy its simulated resources first.');delete this.workspaces[name];return {text:'Deleted empty practice workspace '+name,exitCode:0};}
      throw new Error('Practice workspace commands: list, show, new NAME, select NAME, delete NAME.');
    }
  }
  window.LinformTerraform=Object.freeze({Simulator,STARTER,COMMANDS,blocks,words});
})();
