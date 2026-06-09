/* ============================================================
   multi-md.smoke.js — verifies that loading multiple .md files
   concatenates them in LIST ORDER and that the order drives the
   resulting deck order (parse → infer).

   Mirrors builder.js `joinMdDocs()` exactly (trailing-trim each
   doc, drop empties, join with a blank line). Pure logic — no DOM.

   Run:  node tests/multi-md.smoke.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const load = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
vm.createContext(sandbox);
['parser.js', 'patterns.js', 'infer.js'].forEach((f) => {
  vm.runInContext(load(f), sandbox, { filename: f });
});
const { LectureParser, DeckInfer } = sandbox;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) { console.log('  PASS ' + name); }
  else { console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); failures++; }
};

// === mirror of builder.js joinMdDocs() ===
function joinMdDocs(docs) {
  return docs
    .map((d) => (d.text || '').replace(/\s+$/, ''))
    .filter((t) => t.length)
    .join('\n\n');
}

const fileA = { name: 'a.md', text: '# 강의 A\n\n도입 A\n\n## 1. 알파 단원 (⏱ 30분)\n\n### 1.1 소주제 A\n#### Key Concept\n*   **개념A** 설명 A' };
const fileB = { name: 'b.md', text: '# 강의 B\n\n도입 B\n\n## 1. 베타 단원 (⏱ 40분)\n\n### 1.1 소주제 B\n#### Key Concept\n*   **개념B** 설명 B' };

console.log('— concat order [A, B] —');
let doc = LectureParser.parse(joinMdDocs([fileA, fileB]));
let titles = doc.sections.map((s) => s.title);
check('both files’ sections present', doc.sections.length === 2, 'n=' + doc.sections.length);
check('order A→B preserved', /알파/.test(titles[0] || '') && /베타/.test(titles[1] || ''), titles.join(' | '));

console.log('— reordered [B, A] —');
doc = LectureParser.parse(joinMdDocs([fileB, fileA]));
titles = doc.sections.map((s) => s.title);
check('order B→A preserved', /베타/.test(titles[0] || '') && /알파/.test(titles[1] || ''), titles.join(' | '));

console.log('— full pipeline over the concatenation —');
const specs = DeckInfer.infer(LectureParser.parse(joinMdDocs([fileA, fileB])));
check('intro first / closing last',
  specs[0].pattern === 'intro-slide' && specs[specs.length - 1].pattern === 'closing-slide');
const dividers = specs
  .filter((s) => s.pattern === 'section-divider' || s.pattern === 'part-divider')
  .map((s) => s.title);
check('one divider per file section, in order',
  dividers.length === 2 && /알파/.test(dividers[0]) && /베타/.test(dividers[1]), dividers.join(' | '));

console.log('— join hygiene —');
const j1 = joinMdDocs([{ name: 'x', text: '# X\nno trailing nl' }, { name: 'y', text: '# Y' }]);
check('blank line inserted between files', /no trailing nl\n\n# Y/.test(j1), JSON.stringify(j1));
check('whitespace-only docs are dropped',
  joinMdDocs([{ name: 'e', text: '   \n' }, fileA]).startsWith('# 강의 A'));
check('single doc passes through unchanged (trailing trim only)',
  joinMdDocs([{ name: 'a', text: 'hello\n\n' }]) === 'hello');

console.log('\n' + (failures ? '✗ ' + failures + ' check(s) failed' : '✓ all multi-MD checks passed'));
process.exit(failures ? 1 : 0);
