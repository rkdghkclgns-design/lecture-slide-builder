/* ============================================================
   compose.smoke.js — verifies the 교수안 + 슬라이드 편성안 → slides
   pipeline (detect + parsePlan + parseLesson + compose + render)
   against the real sample files. Pure logic — no DOM.

   Run:  node tests/compose.smoke.js
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
['parser.js', 'patterns.js', 'infer.js', 'compose.js'].forEach((f) => {
  vm.runInContext(load(f), sandbox, { filename: f });
});
const { DeckCompose, DeckPatterns } = sandbox;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) { console.log('  PASS ' + name); }
  else { console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); failures++; }
};

const lessonMd = load('samples/교수안-예제.md');
const planMd = load('samples/슬라이드편성안-예제.md');
const teacherMd = load('samples/sample-lecture.md');

console.log('— detect —');
check('detects plan+lesson from two separate files',
  !!DeckCompose.detect([{ name: 'a.md', text: lessonMd }, { name: 'b.md', text: planMd }]));
check('detects from combined single text',
  !!DeckCompose.detect([{ name: 'c.md', text: lessonMd + '\n\n' + planMd }]));
check('does NOT trigger on a single Teacher-format doc',
  DeckCompose.detect([{ name: 't.md', text: teacherMd }]) === null);
check('does NOT trigger on lesson alone (needs both)',
  DeckCompose.detect([{ name: 'l.md', text: lessonMd }]) === null);

console.log('— parse —');
const P = DeckCompose.parsePlan(planMd);
const L = DeckCompose.parseLesson(lessonMd);
check('plan has 18 slides', P.slides.length === 18, 'n=' + P.slides.length);
check('lesson has 도입 + 전개1..12 + 정리 sections', !!(L.sections['도입'] && L.sections['전개1'] && L.sections['전개4'] && L.sections['정리']),
  Object.keys(L.sections).join(','));
check('전개4 has TWO tables (GROW + SMART)', (L.sections['전개4'].tables || []).length === 2,
  'n=' + (L.sections['전개4'].tables || []).length);
check('전개3 has the 훈련/코칭 table', (L.sections['전개3'].tables || []).length >= 1);

console.log('— compose —');
const specs = DeckCompose.compose(lessonMd, planMd);
check('18 slide specs (structure = 편성안)', specs.length === 18, 'n=' + specs.length);
check('slide 1 is intro-slide', specs[0].pattern === 'intro-slide', specs[0].pattern);
check('slide 1 title from (제목)', /목표설정과 자기소개/.test(specs[0].title || ''), specs[0].title);
check('last slide is closing-slide', specs[specs.length - 1].pattern === 'closing-slide');

// 목차 (slide 2, idx 1) → agenda
check('slide 2 (목차) → agenda', specs[1].pattern === 'agenda', specs[1].pattern);
check('agenda has the 5 journey items', (specs[1].items || []).length === 5, 'n=' + (specs[1].items || []).length);

// GROW (slide 8, idx 7) and SMART (slide 9, idx 8) → deck-table with the CORRECT table
check('GROW slide → deck-table', specs[7].pattern === 'deck-table', specs[7].pattern);
check('GROW slide uses the GROW table (단계 header)', /단계/.test((specs[7].headers || []).join('|')), (specs[7].headers || []).join('|'));
check('SMART slide → deck-table', specs[8].pattern === 'deck-table', specs[8].pattern);
check('SMART slide uses the SMART table (약어 header), NOT GROW', /약어/.test((specs[8].headers || []).join('|')) && !/단계/.test((specs[8].headers || []).join('|')), (specs[8].headers || []).join('|'));

// 훈련/코칭 (slide 7, idx 6) → deck-table from 전개3
check('훈련/코칭 slide → deck-table (from 교수안)', specs[6].pattern === 'deck-table', specs[6].pattern);

// activity slides keep their content; title strips the [활동] marker
const act = specs.filter((s) => s.eyebrow === 'ACTIVITY');
check('activity slides detected (에고그램·로드맵·자기소개)', act.length >= 2, 'n=' + act.length);
check('[활동] marker stripped from titles', specs.every((s) => !/\[활동\]/.test(s.title || '')));
check('activity slides show their instructions (not overwritten by a lesson table)',
  act.every((s) => s.pattern !== 'deck-table'), act.map((s) => s.pattern).join(','));

// pattern variety
const kinds = new Set(specs.map((s) => s.pattern));
check('pattern variety (>=4 kinds)', kinds.size >= 4, [...kinds].join(','));

console.log('— render —');
let err = null, stray = false, totalLen = 0;
for (const s of specs) {
  try {
    const out = DeckPatterns.render(s);
    if (typeof out.html !== 'string') throw new Error('non-string html for ' + s.pattern);
    totalLen += out.html.length;
    if (/&lt;\/div&gt;/.test(out.html)) stray = true;
  } catch (e) { err = s.pattern + ': ' + e.message; break; }
}
check('all specs render without throwing', !err, err || '');
check('no stray escaped </div>', !stray);
check('rendered html non-trivial', totalLen > 2000, 'chars=' + totalLen);

console.log('\n' + (failures ? '✗ ' + failures + ' check(s) failed' : '✓ all compose checks passed (' + specs.length + ' slides)'));
process.exit(failures ? 1 : 0);
