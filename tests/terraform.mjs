import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync('index.html','utf8');
const source=html.match(/<script id="linform-terraform-engine">([\s\S]*?)<\/script>/)[1];
const context={window:{}};vm.runInNewContext(source,context);const {Simulator,COMMANDS}=context.window.LinformTerraform;
const ok=(s,cmd)=>{const result=s.run(cmd);assert.equal(result.exitCode,0,result.text);return result.text;};
test('init, plan, confirmation, outputs and destroy update simulated state',()=>{
 const s=new Simulator();assert.equal(s.run('terraform plan').exitCode,1);
 ok(s,'terraform init');ok(s,'terraform validate');assert.match(ok(s,'terraform plan'),/1 to add/);
 ok(s,'terraform apply');assert.equal(Object.keys(s.state.resources).length,0);ok(s,'no');
 ok(s,'terraform apply');ok(s,'yes');assert.equal(ok(s,'terraform output -raw project_name'),'linform-lab');
 assert.match(ok(s,'terraform state list'),/terraform_data.lesson/);assert.match(ok(s,'terraform plan'),/0 to add, 0 to change/);
 s.config=s.config.replace('"linform-lab"','"new-project"');assert.match(ok(s,'terraform plan'),/1 to change/);
 ok(s,'terraform apply -auto-approve');assert.equal(ok(s,'terraform output -raw project_name'),'new-project');
 ok(s,'terraform destroy');ok(s,'yes');assert.equal(Object.keys(s.state.resources).length,0);
});
test('saved plans reject stale state and workspaces are isolated',()=>{
 const s=new Simulator();ok(s,'terraform init');ok(s,'terraform plan -out=first');ok(s,'terraform apply first');
 assert.equal(s.run('terraform apply first').exitCode,1);
 ok(s,'terraform workspace new dev');assert.equal(Object.keys(s.state.resources).length,0);
 ok(s,'terraform apply -auto-approve');ok(s,'terraform workspace select default');assert.match(ok(s,'terraform state list'),/lesson/);
 assert.equal(s.run('terraform workspace delete dev').exitCode,1);
});
test('state export/import, console and command errors stay inside the model',()=>{
 const s=new Simulator();ok(s,'terraform init');ok(s,'terraform apply -auto-approve');
 ok(s,'terraform state pull > backup.tfstate');ok(s,'terraform state rm terraform_data.lesson');assert.equal(Object.keys(s.state.resources).length,0);
 ok(s,'terraform state push backup.tfstate');assert.equal(Object.keys(s.state.resources).length,1);
 ok(s,'terraform console');assert.equal(ok(s,'upper("cloud")'),'"CLOUD"');assert.equal(s.run('globalThis.process.exit()').exitCode,1);ok(s,'exit');
 assert.equal(s.run('terraform banana').exitCode,1);assert.equal(s.run('terraform init nonsense').exitCode,1);
 assert.equal(s.run('terraform init\nterraform plan').exitCode,1);
 assert.equal(s.run('terraform plan -unknown').exitCode,1);
});
test('unsupported HCL is rejected and advanced command scope is explicit',()=>{
 const s=new Simulator();ok(s,'terraform init');s.config='resource "aws_instance" "bad" {\n ami = "demo"\n}';assert.equal(s.run('terraform validate').exitCode,1);
 s.config='variable "__proto__" {\n default = "x"\n}';assert.equal(s.run('terraform validate').exitCode,1);
 assert.match(ok(s,'terraform version'),/not a Terraform binary/);
 assert.match(ok(s,'terraform login'),/No tokens/);
 for(const command of Object.keys(COMMANDS))assert.equal(s.run('terraform '+command+' -help').exitCode,0);
 assert.match(html,/terraform:'practice'/);assert.match(html,/Teaching simulator · Not a Terraform CLI installation/);
});
