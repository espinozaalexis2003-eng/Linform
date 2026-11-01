import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Element {
 constructor(tag,text=''){this.tag=tag;this.textContent=text||'';this.children=[];this.handlers={};this.hidden=false;this.checked=false;this.disabled=false;}
 append(...items){this.children.push(...items);}
 setAttribute(){}
 addEventListener(name,fn){this.handlers[name]=fn;}
 replaceChildren(...items){this.children=[...items];this.textContent='';}
 focus(){this.focused=true;}
 reset(){const visit=e=>{if(e.tag==='input')e.checked=false;e.children.forEach(visit);};visit(this);}
}
const node=(tag,text)=>new Element(tag,text);
const context=vm.createContext({node,makeCodeBlock:code=>node('pre',code),generation:3,purchased:true});
const html=fs.readFileSync(process.argv[2]||'index.html','utf8');
const helper=html.slice(html.indexOf(' function appendPracticeCases('),html.indexOf(' function clearPrivate(){'));
assert.ok(helper.includes('function appendPremiumReview'));
vm.runInContext(helper,context);
const parent=node('article');
const exam={title:'Synthetic review',notice:'Test fixture',questions:[
 {domain:'Identity',question:'Synthetic Q1',options:['A','B'],answer:1,explanation:'Explanation one'},
 {domain:'State',question:'Synthetic Q2',options:['C','D'],answer:0,explanation:'Explanation two'}]};
context.appendPremiumReview(parent,exam,3);
const block=parent.children[0],form=block.children.find(e=>e.tag==='form');
const fields=form.children.filter(e=>e.tag==='fieldset');
const radios=fields.map(f=>f.children.filter(e=>e.tag==='label').map(l=>l.children[0]));
const buttons=form.children.filter(e=>e.tag==='button');
const feedback=form.children.at(-1);
let prevented=0;const event={preventDefault(){prevented++;}};
form.handlers.submit(event);
assert.match(feedback.textContent,/Answer every/);
assert.equal(radios[0][0].focused,true);
radios[0][1].checked=true;radios[1][1].checked=true;
form.handlers.submit(event);
assert.match(feedback.children[0].textContent,/1\/2 correct · 50%/);
assert.match(feedback.children[1].textContent,/State \(0\/1\)/);
assert.equal(radios.every(row=>row.every(r=>r.disabled)),true);
assert.equal(fields.every(f=>!f.children.at(-1).hidden),true);
assert.equal(buttons[0].disabled,true);assert.equal(buttons[1].hidden,false);
buttons[1].handlers.click();
assert.equal(radios.flat().some(r=>r.checked||r.disabled),false);
assert.equal(fields.every(f=>f.children.at(-1).hidden),true);
assert.equal(buttons[0].disabled,false);
for(let i=0;i<radios.length;i++)radios[i][exam.questions[i].answer].checked=true;
form.handlers.submit(event);
assert.match(feedback.children[0].textContent,/2\/2 correct · 100%/);
assert.match(feedback.children[1].textContent,/All answers correct/);
context.generation=4;
const old=feedback.children[0];buttons[1].handlers.click();
assert.equal(feedback.children[0],old,'stale account callbacks are ignored');
context.generation=3;context.purchased=false;
buttons[1].handlers.click();assert.equal(feedback.children[0],old);
const cases=node('article');context.appendPracticeCases(cases,'Cases',[{title:'Example',scenario:'Scenario',steps:['First'],code:'<script>not executed</script>',solution:'Reasoning'}]);
assert.equal(cases.children[1].tag,'details');
assert.equal(cases.children[1].children[1].children.find(e=>e.tag==='pre').textContent,'<script>not executed</script>');
console.log('PASS: review scoring, weak topics, answer explanations, retry, account guards, and safe scenario rendering');
