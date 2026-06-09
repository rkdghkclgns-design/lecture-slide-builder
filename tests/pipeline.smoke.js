/* ============================================================
   pipeline.smoke.js — headless regression test for the core
   transform pipeline: parser.js → infer.js → patterns.js render.
   Runs the *real* modules (they attach to `window`) against the
   real Teacher sample markdown. No DOM needed: the render fns
   return HTML strings.

   Run:  node tests/pipeline.smoke.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const load = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Minimal global sandbox: the modules do `(function(global){…})(window)`.
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
vm.createContext(sandbox);

// Load the pure-logic modules in dependency order (DOM-free paths only).
['parser.js', 'patterns.js', 'infer.js'].forEach((f) => {
  vm.runInContext(load(f), sandbox, { filename: f });
});

const { LectureParser, DeckPatterns, DeckInfer } = sandbox;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) { console.log('  PASS ' + name); }
  else { console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); failures++; }
};

console.log('— modules loaded —');
check('LectureParser exported', !!(LectureParser && LectureParser.parse));
check('DeckPatterns exported', !!(DeckPatterns && DeckPatterns.render));
check('DeckInfer exported', !!(DeckInfer && DeckInfer.infer));

// Parse the real Teacher sample (the one the design was debugged against).
const md = load('samples/sample-lecture.md');
const doc = LectureParser.parse(md);

console.log('— parse —');
check('title parsed', !!doc.title, JSON.stringify(doc.title));
check('objectives parsed', doc.objectives.length > 0, 'n=' + doc.objectives.length);
check('sections parsed', doc.sections.length > 0, 'n=' + doc.sections.length);
check('duration captured but not leaking into title',
  doc.sections.every((s) => !/⏱|\d+\s*분/.test(s.title)),
  doc.sections.map((s) => s.title).find((t) => /⏱|\d+\s*분/.test(t)) || '');

// Infer → specs.
const specs = DeckInfer.infer(doc);
console.log('— infer —');
check('slides generated', specs.length > 5, 'n=' + specs.length);
check('first slide is intro', specs[0] && specs[0].pattern === 'intro-slide', specs[0] && specs[0].pattern);
check('last slide is closing', specs[specs.length - 1].pattern === 'closing-slide');

// Objectives must be exactly ONE slide (a debugged requirement).
const objSlides = specs.filter((s) => s.eyebrow === 'LEARNING OBJECTIVES');
check('objectives on exactly 1 slide', objSlides.length === 1, 'n=' + objSlides.length);
check('objectives slide holds all items',
  objSlides[0] && objSlides[0].items.length === doc.objectives.length,
  objSlides[0] ? objSlides[0].items.length + '/' + doc.objectives.length : 'none');

// Agenda must appear right after objectives (a debugged requirement).
const agendaIdx = specs.findIndex((s) => s.pattern === 'agenda');
const objIdx = specs.findIndex((s) => s.eyebrow === 'LEARNING OBJECTIVES');
check('agenda slide present', agendaIdx > -1);
check('agenda immediately follows objectives', agendaIdx === objIdx + 1, 'obj=' + objIdx + ' agenda=' + agendaIdx);

// Pattern variety — content should map to several patterns, not collapse to one.
const patternKinds = new Set(specs.map((s) => s.pattern));
check('pattern variety (>= 4 kinds)', patternKinds.size >= 4, [...patternKinds].join(','));

// Render every spec; assert no renderer throws and no stray closing tag leaks
// (the nested image-wrapper </div> bug the design hunted down).
console.log('— render —');
let renderErr = null, strayDiv = false, totalHtml = 0;
for (const spec of specs) {
  try {
    const out = DeckPatterns.render(spec);
    if (typeof out.html !== 'string') throw new Error('non-string html for ' + spec.pattern);
    totalHtml += out.html.length;
    // a literal "</div>" rendered as visible text would appear escaped as
    // &lt;/div&gt; in the output; raw markup is fine. The bug showed up as
    // ESCAPED tags in text nodes, so scan for that.
    if (/&lt;\/div&gt;/.test(out.html)) strayDiv = true;
  } catch (e) { renderErr = spec.pattern + ': ' + e.message; break; }
}
check('all specs render without throwing', !renderErr, renderErr || '');
check('no stray escaped </div> in output', !strayDiv);
check('rendered html is non-trivial', totalHtml > 1000, 'chars=' + totalHtml);

console.log('\n' + (failures ? '✗ ' + failures + ' check(s) failed' : '✓ all checks passed (' + specs.length + ' slides)'));
process.exit(failures ? 1 : 0);
