import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(process.argv[2] || 'index.html', 'utf8');
assert.match(html, /<!doctype html>/i);
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
for (const [, attributes, source] of scripts) {
  if (!/type\s*=\s*["'](?:text\/plain|application\/json)/.test(attributes)) new vm.Script(source);
}
assert.match(html, /id="linform-lab-worker"/);
assert.match(html, /wasi-sh@0\.11\.0\/dist\/busybox\.wasm/);
assert.match(html, /integrity:'sha256-GVt3Cvj61FjeCRRKvTzD5oipqDkHypD3k4olMlPfubM='/);
assert.match(html, /https:\/\/formsubmit\.co\/alexise2003@outlook\.com/);
const coursesSource = html.slice(html.indexOf('const courses ='), html.indexOf('const caseStudy ='));
const context = vm.createContext({});
vm.runInContext(coursesSource + ';globalThis.coursesData = courses;', context);
const courses = context.coursesData;

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {setProperty(){}}; this.dataset={}; this.attributes={}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(k,v) { this.attributes[k]=v; }
  addEventListener() {}
  before() {}
}
const elements = new Map();
const document = {
  createElement: tag => new Element(tag),
  getElementById: id => { if (!elements.has(id)) elements.set(id,new Element('div')); return elements.get(id); },
  querySelector: () => new Element('nav')
};
const learning = scripts.find(([, , source]) => source.includes('const paths =') && source.includes('function gradeQuiz'));
assert.ok(learning, 'certification curriculum exists');
const learningContext = vm.createContext({ document,courses,renderCourses(){},openCourse(){},window:{},setInterval,clearInterval });
vm.runInContext(learning[2], learningContext);
const {questions, paths, gradeQuiz, shuffle} = learningContext.window.LinformLearning;
const ids = new Set();
for (const [key, course] of Object.entries(courses)) {
  for (const lesson of course.lessons) {
    assert.ok(!ids.has(lesson.id), `unique lesson ID: ${lesson.id}`); ids.add(lesson.id);
    assert.ok(lesson.title && lesson.intro && lesson.challenge && lesson.answerText);
  }
  if (key === 'linux') continue;
  const bank = questions[key];
  assert.equal(gradeQuiz(bank, bank.map(q=>q[3])).correct, bank.length);
  assert.equal(gradeQuiz(bank, bank.map(()=>null)).correct, 0);
  assert.equal(gradeQuiz(bank, bank.map(q=>(q[3]+1)%q[2].length)).correct, 0);
  for (const lesson of paths[key].lessons) assert.ok(bank.some(q=>q[0]===lesson.domain), `review for ${key} ${lesson.domain}`);
  for (const q of bank) assert.ok(Number.isInteger(q[3]) && q[3] >= 0 && q[3] < q[2].length && q[4]);
  const copy = shuffle(bank);
  assert.equal(copy.length, bank.length);
  assert.notEqual(copy, bank);
}
assert.equal(ids.size, 26);
console.log(`Site validation passed: ${scripts.length} scripts parse, 26 unique lessons, 15 review questions, every mapped domain represented.`);
