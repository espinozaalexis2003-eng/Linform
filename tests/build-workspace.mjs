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

test('AWS network dependencies, S3 tags and Azure resources build entirely in the teaching model',()=>{const w=new Workspace(),{TEMPLATES}=ctx.window.LinformBuild;for(const key of ['network','storage','azure']){w.write('main.tf',TEMPLATES[key].code);run(w,'terraform init');run(w,'terraform validate');run(w,'terraform plan');run(w,'terraform apply');run(w,'yes');assert.equal(Object.keys(w.tf.state.resources).length,key==='network'?3:key==='azure'?2:1);assert.ok(Object.keys(w.tf.state.resources).every(p=>/^(aws_|azurerm_)/.test(p)));assert.match(run(w,'terraform output'),/=/);}const restored=Workspace.restore(w.serialize());assert.equal(Object.keys(restored.tf.state.resources).length,2);run(restored,'terraform destroy');run(restored,'yes');assert.equal(Object.keys(restored.tf.state.resources).length,0);});
test('Terraform edits produce resource changes/removals; invalid references and credentials are rejected',()=>{const w=new Workspace(),{TEMPLATES}=ctx.window.LinformBuild;w.write('main.tf',TEMPLATES.network.code);run(w,'terraform init');run(w,'terraform apply');run(w,'yes');w.write('main.tf',w.read('main.tf').replace('t3.micro','t3.small'));assert.match(run(w,'terraform plan'),/1 to change/);w.write('main.tf',TEMPLATES.storage.code);assert.match(run(w,'terraform plan'),/3 to destroy/);w.write('main.tf','resource "aws_subnet" "broken" {\n vpc_id = aws_vpc.missing.id\n cidr_block = "10.0.0.0/24"\n}');assert.equal(w.run('terraform validate').ok,false);w.write('main.tf','provider "aws" {\n access_key = "never-paste-keys"\n}');assert.equal(w.run('terraform validate').ok,false);w.write('main.tf','resource "aws_unsupported" "bad" {\n name = "bad"\n}');assert.equal(w.run('terraform validate').ok,false);});

test('code opens a file or the workspace; added Azure examples plan and apply',()=>{const {TEMPLATES}=ctx.window.LinformBuild;const w=new Workspace();assert.equal(w.run('code').edit,'main.tf');assert.equal(w.run('code .').workspace,true);assert.equal(w.run('code main.tf').edit,'main.tf');assert.equal(w.run('code /etc/passwd').ok,false);for(const name of ['azure_network','azure_security','azure_compute']){w.write('main.tf',TEMPLATES[name].code);run(w,'terraform init');run(w,'terraform validate');run(w,'terraform apply');run(w,'yes');assert.ok(Object.keys(w.tf.state.resources).every(k=>k.startsWith('azurerm_')));}});

test('expanded Linux workflows search, transform, inspect and protect files',()=>{const w=new Workspace();run(w,'mkdir -p docs/config');run(w,'printf "team:cloud\nrole:engineer\n" > docs/config/team.txt');assert.match(run(w,'find . -name "*.txt" -type f'),/docs\/config\/team.txt/);assert.equal(run(w,'cat docs/config/team.txt | cut -d ":" -f 2'),'cloud\nengineer');assert.match(run(w,'cat docs/config/team.txt | tr ce CE'),/Cloud/);run(w,'echo backup | tee backup.txt');assert.match(run(w,'cat backup.txt'),/backup/);run(w,'sed -i "s/backup/saved/g" backup.txt');assert.match(run(w,'cat backup.txt'),/saved/);assert.match(run(w,'stat backup.txt'),/student/);assert.match(run(w,'file main.tf'),/Terraform/);assert.match(run(w,'du -sh docs'),/characters/);run(w,'chmod 400 backup.txt');assert.equal(w.run('echo nope > backup.txt').ok,false);run(w,'chmod 600 backup.txt');run(w,'echo now > backup.txt');run(w,'export PROJECT=linform');assert.equal(run(w,'echo $PROJECT'),'linform');assert.equal(run(w,'printenv PROJECT'),'linform');run(w,'unset PROJECT');assert.equal(run(w,'printenv PROJECT'),'');assert.match(run(w,'which terraform'),/\/bin\/terraform/);assert.equal(run(w,'seq 2 4'),'2\n3\n4');assert.match(run(w,'ls -l'),/-rw-------.*backup.txt/);const restored=Workspace.restore(w.serialize());assert.equal(restored.modes['backup.txt'],'600');assert.match(run(restored,'realpath docs'),/linform\/docs/);});
test('cloud state move, export/restore and dependency graph use actual practice state',()=>{const w=new Workspace();run(w,'terraform init');run(w,'terraform apply');run(w,'yes');run(w,'terraform state pull > saved-state.json');run(w,'terraform state mv aws_instance.web aws_instance.server');assert.match(run(w,'terraform state list'),/aws_instance.server/);run(w,'terraform state push saved-state.json');assert.match(run(w,'terraform state list'),/aws_instance.web/);w.write('main.tf',ctx.window.LinformBuild.TEMPLATES.network.code);assert.match(run(w,'terraform graph'),/aws_subnet.public.*->.*aws_vpc.main/);});

test('Premium projects model provider errors, file locations, monthly changes and saved plans',()=>{
 const {newProject}=ctx.window.LinformBuild;
 const aws=newProject('aws-network');
 run(aws,'terraform init');
 aws.write('invalid.tf','unrecognized\n');
 assert.match(aws.run('terraform validate').text,/invalid\.tf:1:[\s\S]+Hint:/);
 delete aws.git.files['invalid.tf'];
 const plan=aws.run('terraform plan -out=monthly');
 assert.equal(plan.ok,true,plan.text);
 assert.match(plan.estimate,/\$7\.82/);
 assert.match(plan.estimate,/10 GB S3 Standard/);
 assert.equal(aws.run('terraform apply monthly').ok,false);
 assert.match(aws.run('terraform apply monthly').text,/AccessDenied[\s\S]+main\.tf:\d+[\s\S]+s3:CreateBucket/);
 assert.equal(Object.keys(aws.tf.state.resources).length,0);
 aws.write('policies/lab.json',aws.read('policies/lab.json').replace('"ec2:RunInstances"','"ec2:RunInstances", "s3:CreateBucket"'));
 assert.match(aws.run('terraform apply monthly').estimate,/\$7\.82/);
 assert.match(aws.run('terraform plan -destroy').estimate,/subtotal \(USD\): \$0\.00/);
 const azure=newProject('azure-network');
 run(azure,'terraform init');
 const preview=azure.run('terraform apply');
 assert.equal(preview.ok,true,preview.text);
 assert.match(preview.estimate,/Hot LRS/);
 assert.match(azure.run('yes').estimate,/\$0\.18/);
 assert.equal(Object.keys(azure.tf.state.resources).length,4);
 azure.write('main.tf',azure.read('main.tf').replace(/resource_group_name = azurerm_resource_group.lab.name/g,'resource_group_name = "missing-group"'));
 const failedAzure=azure.run('terraform apply -auto-approve');
 assert.equal(failedAzure.ok,false);
 assert.match(failedAzure.text,/ResourceGroupNotFound[\s\S]+main\.tf:\d+/);
 const security=newProject('aws-security');
 run(security,'terraform init');
 run(security,'terraform apply');
 assert.match(security.run('yes').text,/InvalidGroup\.NotFound[\s\S]+main\.tf:\d+/);
 security.write('main.tf',security.read('main.tf').replace('"sg-0123456789abcdef0"','aws_security_group.web.id'));
 run(security,'terraform apply -auto-approve');
 assert.ok(security.tf.state.resources['aws_security_group.web']);
});

test('Premium break-fix tasks preserve their repair state across sessions',()=>{
 const {newProject}=ctx.window.LinformBuild;
 const linux=newProject('linux-service');
 assert.match(linux.run('systemctl status linform-web').text,/203\/EXEC/);
 assert.match(run(linux,'journalctl -u linform-web'),/No such file/);
 linux.write('systemd/linform-web.service',linux.read('systemd/linform-web.service').replace('start.sh','start-web.sh'));
 assert.equal(linux.run('systemctl restart linform-web').ok,false);
 run(linux,'systemctl daemon-reload');
 run(linux,'systemctl restart linform-web');
 assert.match(run(Workspace.restore(linux.serialize()),'systemctl status linform-web'),/active \(running\)/);
 const git=newProject('git-conflict');
 assert.match(run(git,'git status'),/unmerged paths/);
 assert.equal(git.run('git add README.md').ok,false);
 git.write('README.md','# Cloud operations\nMonitor service health.\nEnable nightly backups.\n');
 run(git,'git add README.md');
 run(git,'git commit -m "Resolve merge conflict"');
 const repo=Workspace.restore(git.serialize());
 assert.match(run(repo,'git status'),/working tree clean/);
 assert.match(run(repo,'git log --oneline'),/Resolve merge conflict/);
 const lock=newProject('terraform-lock');
 run(lock,'terraform init');
 const block=lock.run('terraform plan');
 assert.equal(block.ok,false);
 const id=block.text.match(/ID:\s+(\S+)/)[1];
 assert.equal(lock.run('terraform force-unlock wrong-id').ok,false);
 run(lock,'terraform force-unlock '+id);
 run(Workspace.restore(lock.serialize()),'terraform apply -auto-approve');
});

test('Google Cloud links VM to its subnet, reports region errors and estimates compute and storage',()=>{
 const {newProject}=ctx.window.LinformBuild;
 const w=newProject('gcp-network');
 run(w,'terraform init');
 run(w,'terraform validate');
 const preview=w.run('terraform plan');
 assert.equal(preview.ok,true,preview.text);
 assert.match(preview.estimate,/subtotal \(USD\): \$6\.31/);
 assert.match(preview.estimate,/Iowa benchmark/);
 assert.match(preview.estimate,/10 GiB Standard Cloud Storage \(US-CENTRAL1\)/);
 run(w,'terraform apply');
 const invalid=w.run('yes');
 assert.equal(invalid.ok,false);
 assert.match(invalid.text,/Error 400:[\s\S]+main\.tf:1[\s\S]+network\.tf/);
 assert.equal(Object.keys(w.tf.state.resources).length,0);
 w.write('main.tf',w.read('main.tf').replace('us-east1-b','us-central1-a'));
 const restored=Workspace.restore(w.serialize());
 const applied=restored.run('terraform apply -auto-approve');
 assert.equal(applied.ok,true,applied.text);
 assert.match(applied.estimate,/\$6\.31/);
 assert.deepEqual(Array.from(restored.tf.state.resources['google_compute_instance.app'].dependencies),['google_compute_subnetwork.apps']);
 assert.equal(restored.tf.state.resources['google_storage_bucket.reports'].public_access_prevention,'enforced');
 run(restored,'terraform destroy -auto-approve');
 assert.equal(Object.keys(restored.tf.state.resources).length,0);
});
