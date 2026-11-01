import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(process.argv[2]||'index.html','utf8');
const source=html.slice(html.indexOf(' function premiumResumePayload('),html.indexOf(' function clearPrivate(){'));
assert.ok(source.includes('function projectStarterZip'));
const context=vm.createContext({TextEncoder});vm.runInContext(source,context);
const review=context.premiumResumePayload('resume-review','  My redacted resume  ');
assert.equal(review.topic,'learning-plan');assert.equal(review.message,'[Resume review]\nMy redacted resume');
assert.ok(context.premiumResumePayload('resume-review','x'.repeat(2900)).message.length<=3000);
assert.equal(context.premiumResumePayload('project-feedback','  My project question  ').topic,'project-feedback');
assert.equal(context.premiumResumePayload('project-feedback','  My project question  ').message,'My project question');
for(const path of ['/absolute.txt','../escape.txt','a/../escape.txt','a//b.txt','./file.txt'])assert.throws(()=>context.projectStarterZip([{path,content:'x'}]));
assert.throws(()=>context.projectStarterZip([{path:'same.txt',content:'a'},{path:'same.txt',content:'b'}]));
assert.throws(()=>context.projectStarterZip([]));
assert.throws(()=>context.projectStarterZip([{path:'large.txt',content:'x'.repeat(4000001)}]));
const bytes=context.projectStarterZip([{path:'README.md',content:'Synthetic starter\n'},{path:'modules/example/main.tf',content:'output "sample" { value = "café" }\n'}]);
assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
if(process.argv[3])fs.writeFileSync(process.argv[3],bytes);
assert.ok(html.includes('if(before!==generation||!purchased)return;'));
assert.ok(html.includes('maxlength="2900"'));
class Element {
 constructor(tag,text=''){this.tag=tag;this.textContent=text||'';this.children=[];this.handlers={};}
 append(...items){this.children.push(...items);}
 addEventListener(name,fn){this.handlers[name]=fn;}
}
let saves=0;const progress={};
const ui=vm.createContext({TextEncoder,node:(tag,text)=>new Element(tag,text),makeCodeBlock:code=>new Element('pre',code),generation:1,purchased:true,progress,isComplete:id=>!!progress[id],saveProgress:()=>saves++});
vm.runInContext(html.slice(html.indexOf(' function appendPracticeCases('),html.indexOf(' function clearPrivate(){')),ui);
const parent=new Element('article');
ui.appendPracticeCases(parent,'Milestones',[{title:'Synthetic milestone',steps:['A step'],solution:'Expected result',completionId:'premium-test-step-01'}]);
const body=parent.children[1].children[1],mark=body.children.find(e=>e.tag==='button');
mark.handlers.click();assert.equal(progress['premium-test-step-01'],true);assert.equal(saves,1);
ui.generation=2;mark.handlers.click();assert.equal(saves,1,'old-account milestone is ignored');
ui.generation=1;ui.purchased=false;mark.handlers.click();assert.equal(saves,1,'unpaid action is ignored');
console.log('PASS: resume review routes to existing private queue, payload fits backend limit, starter ZIP path/size/duplicate guards and UTF-8 encoding.');
console.log('PASS: project milestone completion uses account progress sync and rejects stale/unpaid actions.');
