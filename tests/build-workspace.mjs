import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync('index.html','utf8'),ctx=vm.createContext({window:{},URL});
for(const id of ['linform-terraform-engine','linform-git-model','linform-build-engine'])vm.runInContext(html.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)<\\/script>'))[1],ctx);
const {Workspace}=ctx.window.LinformBuild;
const run=(w,s)=>{const r=w.run(s);assert.equal(r.ok,true,s+': '+r.text);return r.text;};
test('one filesystem connects Linux file edits, Git snapshots and Terraform config/state',()=>{
 const w=new Workspace();run(w,'mkdir -p docs/cloud');run(w,'echo "first lab" > docs/cloud/notes.txt');assert.match(run(w,'cat docs/cloud/notes.txt'),/first lab/);run(w,'cd docs/cloud');assert.match(run(w,'pwd'),/docs\/cloud/);run(w,'echo "second line" >> notes.txt');assert.match(run(w,'cat notes.txt | grep second | wc -l'),/^1$/);run(w,'cd ../..');
 run(w,'git init');run(w,'git add .');run(w,'git commit -m "first project"');run(w,'echo "changed" > notes.txt');assert.match(run(w,'git diff'),/changed/);run(w,'git restore notes.txt');assert.match(w.git.files['notes.txt'],/Linux creates/);
 run(w,'terraform init');run(w,'terraform validate');assert.match(run(w,'terraform plan'),/to add/);run(w,'terraform apply');assert.equal(Object.keys(w.tf.state.resources).length,0);run(w,'yes');assert.equal(Object.keys(w.tf.state.resources).length,1);assert.match(w.git.files['terraform.tfstate'],/resources/);assert.match(run(w,'terraform output'),/=/);run(w,'terraform destroy');run(w,'yes');assert.equal(Object.keys(w.tf.state.resources).length,0);
});
test('editor requests, quoting, redirects and shell operators stay inside the file model',()=>{
 const w=new Workspace();const editor=w.run('nano main.tf');assert.equal(editor.edit,'main.tf');assert.match(editor.content,/resource/);run(w,'echo "a > b | c && d" > literal.txt');assert.equal(w.git.files['literal.txt'],'a > b | c && d\n');run(w,'mkdir docs && touch docs/a.txt');assert.ok(Object.hasOwn(w.git.files,'docs/a.txt'));assert.equal(w.run('cat > write.txt').edit,'write.txt');assert.equal(w.run('cat >> literal.txt').content,w.git.files['literal.txt']);
 assert.equal(w.run('cd /etc').ok,false);assert.equal(w.run('echo nope > __proto__').ok,false);assert.equal(w.run('echo nope > .git/config').ok,false);assert.equal(w.run('curl https://example.com').ok,false);assert.equal(w.run('node process.exit()').ok,false);assert.equal(w.run('echo "unfinished').ok,false);
});
test('file editing changes Terraform plan; cancellation and saved workspace restore preserve state',()=>{
 const w=new Workspace();run(w,'terraform init');run(w,'terraform apply');run(w,'no');assert.equal(Object.keys(w.tf.state.resources).length,0);
 w.write('main.tf','resource "terraform_data" "app" {\n input = "release-one"\n}\noutput "release" {\n value = terraform_data.app.output\n}\n');run(w,'terraform apply');run(w,'yes');w.write('main.tf',w.read('main.tf').replace('release-one','release-two'));assert.match(run(w,'terraform plan'),/to change/);
 run(w,'git init');run(w,'git add main.tf');run(w,'git commit -m "release"');const restored=Workspace.restore(w.serialize());assert.equal(restored.git.commits.length,1);assert.equal(restored.read('main.tf'),w.read('main.tf'));assert.equal(Object.keys(restored.tf.state.resources).length,1);run(restored,'terraform apply');run(restored,'yes');assert.match(run(restored,'terraform output'),/release-two/);
});
test('nested files, copying, deletion, pipes and file limits behave predictably',()=>{
 const w=new Workspace();run(w,'mkdir docs');run(w,'printf "z\\na\\na\\n" > docs/list.txt');assert.equal(run(w,'cat docs/list.txt | sort | uniq'),'a\nz');run(w,'cp docs/list.txt docs/copy.txt');run(w,'mv docs/copy.txt copy.txt');assert.equal(w.run('rmdir docs').ok,false);run(w,'rm -r docs');assert.equal(w.run('cat docs/list.txt').ok,false);assert.throws(()=>w.write('big.txt','x'.repeat(12001)));assert.match(run(w,'head -n 2 copy.txt'),/^z\na$/);
});

test('editing config cancels an outstanding confirmation and malformed backups are rejected',()=>{const w=new Workspace();run(w,'terraform init');run(w,'terraform apply');assert.ok(w.tf.pending);w.write('main.tf',w.read('main.tf')+'\n');assert.equal(w.tf.pending,null);assert.equal(w.run('yes').ok,false);const d=JSON.parse(w.serialize());d.git.commits='invalid';assert.throws(()=>Workspace.restore(JSON.stringify(d)));});
