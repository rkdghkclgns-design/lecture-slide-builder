/* ============================================================
   compose.js — 교수안 + 슬라이드 편성안 → 슬라이드 스펙
   "구조는 편성안, 내용은 교수안"
     · 편성안(plan):  ### 슬라이드 N - 제목 + (대응 교수안 / 슬라이드 문구 / 이미지·시각 / 핵심 메시지)
     · 교수안(lesson): ## 진행 아래 ### 도입 / 전개 N / 정리 (설명·멘트·표 포함)
   편성안의 슬라이드 문구를 화면 텍스트로 쓰되, 대응 교수안 섹션에 표가 있으면
   그 표를 deck-table로 렌더해 교수안 내용을 직접 반영한다.
   produces specs in the SAME shape DeckPatterns.render consumes (raw text;
   the renderer escapes/inlines), so the existing render/PPTX/export paths work.
   ============================================================ */
(function (global) {
  'use strict';

  var clip = (global.DeckPatterns && global.DeckPatterns.clip) || function (s, n) {
    s = (s || '').trim(); return s.length <= n ? s : s.slice(0, n).replace(/[\s,·]+\S*$/, '') + '…';
  };
  function pad2(n) { return String(n).padStart(2, '0'); }
  function stripFront(md) { return (md || '').replace(/^﻿?\s*---\n[\s\S]*?\n---\s*\n/, ''); }
  function norm(s) { return (s || '').replace(/\s+/g, '').trim(); }

  /* ============================================================
     detection — classify loaded docs into plan + lesson
     ============================================================ */
  // split a text at top-level H1 headings so two concatenated docs separate.
  function chunksOf(text) {
    return String(text || '').split(/(?=^#[ \t]+\S)/m).map(function (p) { return p.trim(); }).filter(Boolean);
  }
  function classify(chunk) {
    var isPlan = /(^|\n)#[ \t]*슬라이드[ \t]*편성안/.test(chunk) ||
      /(^|\n)##[ \t]*슬라이드[ \t]*편성/.test(chunk) ||
      /(^|\n)###[ \t]*슬라이드[ \t]*\d+/.test(chunk);
    var isLesson = /(^|\n)##[ \t]*진행\b/.test(chunk) ||
      /\*\*\s*설명\s*내용/.test(chunk) ||
      /(^|\n)###[ \t]*전개[ \t]*\d+/.test(chunk) ||
      (/교수안/.test(chunk) && /##[ \t]*학습\s*목표/.test(chunk));
    // a combined chunk could match both; prefer plan vs lesson by the strongest signal
    if (isPlan && !/(^|\n)##[ \t]*진행/.test(chunk)) return 'plan';
    if (isLesson && !/###[ \t]*슬라이드[ \t]*\d+/.test(chunk)) return 'lesson';
    if (isPlan) return 'plan';
    if (isLesson) return 'lesson';
    return 'other';
  }
  // sources: [{name,text}] → {plan, lesson} | null
  function detect(sources) {
    var plans = [], lessons = [];
    (sources || []).forEach(function (s) {
      chunksOf(s && s.text).forEach(function (c) {
        var k = classify(c);
        if (k === 'plan') plans.push(c);
        else if (k === 'lesson') lessons.push(c);
      });
    });
    if (plans.length && lessons.length) return { plan: plans[0], lesson: lessons[0] };
    return null;
  }

  /* ============================================================
     PlanParser — 슬라이드 편성안
     ============================================================ */
  // "(제목) 텍스트" → {role, text}; role: title|sub|big|foot|note|''
  function fungu(s) {
    s = (s || '').trim();
    var m = s.match(/^\(([^)]+)\)\s*(.*)$/);
    if (m) {
      var tag = m[1], text = m[2].trim();
      var role = /제목/.test(tag) ? 'title' : /부제/.test(tag) ? 'sub'
        : /큰\s*문구/.test(tag) ? 'big' : /하단/.test(tag) ? 'foot'
          : /한\s*줄/.test(tag) ? 'note' : '';
      return { role: role, text: text };
    }
    return { role: '', text: s };
  }

  function parsePlan(md) {
    md = stripFront(md).replace(/\r\n?/g, '\n');
    var lines = md.split('\n');
    var deckTitle = '', slides = [], cur = null, field = null;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i], t = raw.trim();
      var h1 = t.match(/^#[ \t]+(.+)/);
      if (h1) {
        if (/슬라이드\s*편성안/.test(h1[1])) deckTitle = h1[1].replace(/^슬라이드\s*편성안\s*-\s*/, '').trim();
        field = null; continue;
      }
      var sH = t.match(/^###[ \t]*슬라이드[ \t]*(\d+)[ \t]*-[ \t]*(.+)/);
      if (sH) { cur = { no: +sH[1], title: sH[2].trim(), lesson: '', lines: [], visual: '', message: '' }; slides.push(cur); field = null; continue; }
      if (!cur) continue;
      // top-level field bullet (indent 0–1): "- 대응 교수안:", "- 슬라이드 문구:", "- 이미지/시각:", "- 핵심 메시지:"
      var fm = raw.match(/^([ \t]{0,1})-[ \t]*(대응\s*교수안|슬라이드\s*문구|이미지[\s·/]*시각|핵심\s*메시지)[ \t]*:?[ \t]*(.*)$/);
      if (fm) {
        var key = norm(fm[2]), val = fm[3].trim();
        if (/대응교수안/.test(key)) { cur.lesson = norm(val); field = null; }
        else if (/슬라이드문구/.test(key)) { field = 'lines'; if (val) cur.lines.push(fungu(val)); }
        else if (/이미지.*시각/.test(key)) { cur.visual = val; field = null; }
        else if (/핵심메시지/.test(key)) { cur.message = val; field = null; }
        continue;
      }
      // any deeper-indented bullet under "슬라이드 문구" → a line (flatten nesting)
      var sub = raw.match(/^[ \t]{2,}-[ \t]+(.*)$/);
      if (sub && field === 'lines') { cur.lines.push(fungu(sub[1])); continue; }
    }
    return { title: deckTitle, slides: slides };
  }

  /* ============================================================
     LessonParser — 교수안 (## 진행 아래 도입/전개 N/정리, 표 포함)
     ============================================================ */
  function isSep(cells) { return cells.every(function (c) { return /^:?-{2,}:?$/.test(c) || c === ''; }); }
  function rowCells(t) { return t.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); }

  function parseLesson(md) {
    md = stripFront(md).replace(/\r\n?/g, '\n');
    var lines = md.split('\n');
    var title = '', objectives = [], sections = {}, order = [];
    var mode = null, cur = null, lastBold = '', tbl = null, tblCtx = '';

    function flushTable() {
      if (cur && tbl && tbl.length) {
        var rows = tbl.filter(function (r) { return !isSep(r); });
        if (rows.length >= 1) cur.tables.push({ headers: rows[0], rows: rows.slice(1), ctx: tblCtx });
      }
      tbl = null; tblCtx = '';
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i], t = raw.trim();
      var h1 = t.match(/^#[ \t]+(.+)/);
      if (h1) { title = h1[1].replace(/^교수안\s*-\s*/, '').trim(); mode = null; cur = null; flushTable(); continue; }
      var h2 = t.match(/^##[ \t]+(.+)/);
      if (h2) {
        flushTable(); cur = null;
        var ht = h2[1].trim();
        mode = /학습\s*목표/.test(ht) ? 'objectives' : /진행/.test(ht) ? 'progress' : null;
        continue;
      }
      var h3 = t.match(/^###[ \t]+(.+)/);
      if (h3 && mode === 'progress') {
        flushTable();
        var seg = h3[1].trim();
        var label = seg.split(/\s*-\s*/)[0].trim();
        var key = norm(label);
        cur = { key: key, label: label, title: seg, tables: [], text: [] };
        sections[key] = cur; order.push(key); lastBold = ''; continue;
      }
      if (mode === 'objectives') {
        var ob = t.match(/^[-*][ \t]+(.+)/); if (ob) objectives.push(ob[1].trim());
        continue;
      }
      if (mode === 'progress' && cur) {
        if (/^\|.*\|$/.test(t)) { if (!tbl) { tbl = []; tblCtx = lastBold; } tbl.push(rowCells(t)); continue; }
        if (tbl) flushTable();
        var bm = t.match(/^\*\*([^*]+)\*\*\s*:?\s*(.*)$/);
        if (bm) { lastBold = bm[1].trim(); if (bm[2]) cur.text.push(bm[2].trim()); continue; }
        var li = t.match(/^[-*][ \t]+(.+)/);
        if (li) { cur.text.push(li[1].trim()); continue; }
        if (t && !/^#{1,6}[ \t]/.test(t)) cur.text.push(t);
      }
    }
    flushTable();
    return { title: title, objectives: objectives, sections: sections, order: order };
  }

  /* ============================================================
     compose — plan slides → specs (content from lesson)
     ============================================================ */
  function parseLabeled(x) {
    var m = x.match(/^([^:：]{1,24})[:：]\s*(.+)$/);
    return m ? { label: m[1].trim(), rest: m[2].trim() } : null;
  }
  // "S 구체적" → {label:'S', desc:'구체적'};  "코딩" → {label:'', desc:'코딩'}
  function splitLabel(s) {
    s = (s || '').trim();
    var m = s.match(/^([A-Z]{1,3}|[①-⑳]|\d{1,2})[ \t.]+(.+)$/);
    if (m) return { label: m[1], desc: m[2].trim() };
    var c = parseLabeled(s);
    if (c) return { label: c.label, desc: c.rest };
    return { label: '', desc: s };
  }
  // when a lesson section has multiple tables, pick the one matching the slide
  function pickTable(tables, sl) {
    if (tables.length === 1) return tables[0];
    var hay = (sl.title + ' ' + sl.lines.map(function (l) { return l.text; }).join(' ')).toUpperCase();
    var tags = ['GROW', 'SMART'];
    for (var k = 0; k < tags.length; k++) {
      if (hay.indexOf(tags[k]) > -1) {
        var hit = tables.filter(function (tb) { return (tb.ctx || '').toUpperCase().indexOf(tags[k]) > -1; })[0];
        if (hit) return hit;
      }
    }
    // fall back: context keyword overlap
    for (var i = 0; i < tables.length; i++) {
      var ctx = norm(tables[i].ctx).toUpperCase();
      if (ctx && hay.replace(/\s/g, '').indexOf(ctx) > -1) return tables[i];
    }
    return tables[0];
  }
  function eyebrowFor(pattern, sl) {
    if (/\[?활동\]?/.test(sl.title)) return 'ACTIVITY';
    return { 'deck-table': 'FRAMEWORK', 'two-cards': 'COMPARE', 'three-cards': 'CONCEPTS',
      'check-box': 'KEY POINTS', 'split-text-image': 'POINT', 'part-divider': 'FOCUS', 'agenda': 'AGENDA' }[pattern] || '';
  }
  function cleanTitle(s) { return (s || '').replace(/^\[\s*활동\s*\]\s*/, '').trim(); }

  function specForSlide(sl, L, idx, total, deckTitle) {
    var lines = sl.lines;
    var texts = lines.map(function (l) { return l.text; }).filter(Boolean);
    var titleLine = lines.filter(function (l) { return l.role === 'title'; })[0];
    var subLine = lines.filter(function (l) { return l.role === 'sub'; })[0];
    var bigLine = lines.filter(function (l) { return l.role === 'big'; })[0];
    var sec = (sl.lesson && sl.lesson !== '-') ? L.sections[sl.lesson] : null;
    var title = cleanTitle(sl.title);
    var isActivity = /활동/.test(sl.title);

    // 1. cover / intro
    if (idx === 0 || titleLine) {
      return { pattern: 'intro-slide', eyebrow: 'ORIENTATION',
        title: titleLine ? titleLine.text : (deckTitle || title),
        lead: clip(subLine ? subLine.text : (texts.filter(function (x) { return !titleLine || x !== titleLine.text; })[0] || ''), 220) };
    }
    // 2. closing
    if (sl.lesson === '정리' || idx === total - 1) {
      return { pattern: 'closing-slide', eyebrow: 'WRAP-UP', title: title,
        sub: clip(texts[texts.length - 1] || sl.message || '', 80), image: null };
    }
    // 3. agenda / 목차
    if (/목차|여정|한눈에/.test(sl.title) || /목차|여정/.test(texts[0] || '')) {
      var numbered = texts.filter(function (x) { return /^\d+[.)]/.test(x); });
      var head = texts.filter(function (x) { return !/^\d+[.)]/.test(x); })[0];
      var items = (numbered.length ? numbered : texts).map(function (x, i) {
        var m = x.match(/^(\d+)[.)]\s*(.+)/);
        return { label: m ? pad2(m[1]) : pad2(i + 1), desc: clip(m ? m[2] : x, 60) };
      });
      return { pattern: 'agenda', eyebrow: 'AGENDA', title: head || title, items: items };
    }
    // 4. hook (큰 문구) → part-divider
    if (bigLine) {
      return { pattern: 'part-divider', eyebrow: eyebrowFor('part-divider', sl), title: bigLine.text,
        sub: clip(texts.filter(function (x) { return x !== bigLine.text; }).join('  ·  '), 150) };
    }
    // 5. lesson table → deck-table (교수안 내용 직접 반영)
    //    단, 활동 슬라이드는 화면 문구(지시·단계)가 핵심이므로 표로 덮지 않는다.
    if (!isActivity && sec && sec.tables && sec.tables.length) {
      var tb = pickTable(sec.tables, sl);
      if (tb && tb.headers && tb.headers.length >= 2 && tb.rows.length) {
        return { pattern: 'deck-table', eyebrow: eyebrowFor('deck-table', sl), title: title,
          headers: tb.headers.slice(0, 4), rows: tb.rows.map(function (r) { return r.slice(0, 4); }) };
      }
    }
    // 6/7. labeled comparison → two / three cards
    var labeled = texts.map(parseLabeled).filter(Boolean);
    if (labeled.length === 2 && labeled.length === texts.length) {
      return { pattern: 'two-cards', eyebrow: eyebrowFor('two-cards', sl), title: title,
        cards: labeled.map(function (c, i) { return { tone: i === 1 ? 'purple' : '', title: clip(c.label, 30), desc: clip(c.rest, 180) }; }) };
    }
    if (labeled.length === 3 && labeled.length >= texts.length - 1) {
      return { pattern: 'three-cards', eyebrow: eyebrowFor('three-cards', sl), title: title,
        cards: labeled.map(function (c) { return { title: clip(c.label, 30), desc: clip(c.rest, 150) }; }) };
    }
    // 8. a single slash-separated line of items → check-box
    if (texts.length <= 2) {
      var cand = texts.filter(function (x) { return x.split(/\s*\/\s*/).length >= 3; })[0];
      if (cand) {
        return { pattern: 'check-box', eyebrow: eyebrowFor('check-box', sl), title: title,
          items: cand.split(/\s*\/\s*/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 8)
            .map(function (s) { var lb = splitLabel(s); return { label: lb.label, desc: clip(lb.desc, 120) }; }) };
      }
    }
    // 9. many lines → check-box
    if (texts.length >= 4) {
      return { pattern: 'check-box', eyebrow: eyebrowFor('check-box', sl), title: title,
        items: texts.slice(0, 8).map(function (x) { var lb = splitLabel(x); return { label: lb.label, desc: clip(lb.desc, 120) }; }) };
    }
    // 10. default → split-text-image (문구 + 제안 비주얼)
    return { pattern: 'split-text-image', eyebrow: eyebrowFor('split-text-image', sl), title: title,
      paras: texts.slice(0, 3).map(function (x) { return clip(x, 210); }), image: null,
      imgPh: clip(sl.visual || '이미지', 18), wide: true };
  }

  function compose(lessonMd, planMd) {
    var L = parseLesson(lessonMd || '');
    var P = parsePlan(planMd || '');
    var deckTitle = P.title || L.title || '강의 슬라이드';
    var total = P.slides.length;
    if (!total) throw new Error('편성안에서 슬라이드를 찾지 못했습니다');
    return P.slides.map(function (sl, idx) { return specForSlide(sl, L, idx, total, deckTitle); });
  }

  global.DeckCompose = {
    detect: detect, compose: compose,
    parsePlan: parsePlan, parseLesson: parseLesson  // exposed for tests
  };
})(window);
