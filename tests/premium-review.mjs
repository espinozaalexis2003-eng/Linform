import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
class Element{
 constructor(tag,text=''){this.tag=tag;this.textContent=text||'';this.children=[];this.handlers={};this.hidden=false;this.checked=false;this.disabled=false;this.open=false;}
 append(...items){this.children.push(...items)}setAttribute(){}addEventListener(name,fn){this.handlers[name]=fn}
 replaceChildren(...items){this.children=[...items];this.textContent=''}focus(){this.focused=true}remove(){this.removed=true}
 showModal(){this.open=true}close(){this.open=false;this.handlers.close?.()}click(){return this.handlers.click?.()}
}
const html=fs.readFileSync(process.argv[2]||'index.html','utf8'),helper=html.slice(html.indexOf(' function appendPracticeCases('),html.indexOf(' function clearPrivate(){'));
const node=(tag,text)=>new Element(tag,text),saved=new Map();
const context=vm.createContext({node,account:{identity:()=> 'fixture-member'},localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},makeCodeBlock:code=>node('pre',code),generation:3,purchased:true});vm.runInContext(helper,context);
const exam={title:'Fixture quiz',questions:Array.from({length:12},(_,i)=>({domain:'Fixture',question:'Question '+i,options:['A','B','C','D'],answer:i%4,explanation:'Reason '+i}))};
const parent=node('article');context.appendPremiumReview(parent,exam,3,'fixture-guide');const launch=parent.children[0].children.at(-1);
launch.click();let dialog=parent.children.at(-1),body=dialog.children[1],status=dialog.children[2],controls=dialog.children[3];
assert.equal(dialog.open,true);controls.children[1].click();assert.match(status.textContent,/Choose an answer/);
const seen=[];
for(let step=0;step<5;step++){
 const field=body.children.find(e=>e.tag==='fieldset'),id=Number(field.children[0].textContent.split(' ').at(-1));seen.push(id);
 const inputs=field.children.filter(e=>e.tag==='label').map(e=>e.children[0]);const answer=inputs.find(e=>Number(e.value)===id%4);answer.checked=true;answer.handlers.change();
 if(step===0){controls.children[1].click();controls.children[0].click();assert.ok(body.children[1].children.filter(e=>e.tag==='label').some(e=>e.children[0].checked));}
 controls.children[1].click();
}
assert.equal(new Set(seen).size,5);assert.equal(body.children[0].textContent,'5 / 5 correct');assert.equal(body.children.filter(e=>e.tag==='details').length,5);
assert.ok(body.children.filter(e=>e.tag==='details').every(e=>e.children.some(c=>c.textContent.startsWith('Reason '))));
controls.children[0].click();dialog=parent.children.at(-1);assert.equal(dialog.open,true);
const stored=JSON.parse([...saved.values()][0]);assert.equal(stored.last.length,5);assert.ok(stored.last.every(i=>!seen.includes(i)));
assert.ok([...saved.values()].every(text=>!text.includes('Question')&&!text.includes('Reason')),'only question indexes are persisted');
context.closePremiumQuiz();assert.equal(dialog.open,false);const count=parent.children.length;context.purchased=false;launch.click();assert.equal(parent.children.length,count);
context.purchased=true;context.generation=4;launch.click();assert.equal(parent.children.length,count);
context.generation=3;launch.click();dialog=parent.children.at(-1);context.generation=4;const oldBody=dialog.children[1].children[0];dialog.children[3].children[1].click();assert.equal(dialog.children[1].children[0],oldBody);
context.closePremiumQuiz();
assert.doesNotMatch(html,/Architecture reasoning lab|See how you’ll learn|id="linform-public-preview"/);
assert.match(html,/Mentoring with an engineer/);
console.log('PASS: protected five-question dialog, required answers, back navigation, scoring, explanations, fresh non-repeating sets, close/reset, stale/unpaid guards and index-only persistence.');
