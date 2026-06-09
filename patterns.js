/* ============================================================
   patterns.js — 14 슬라이드 패턴 렌더러 + 자동 추론 엔진
   All icons use hex stroke (#3FC6F1) per PPTX-compat rule.
   Each renderer returns the inner HTML of a <section class="slide …">.
   ============================================================ */
(function (global) {
  'use strict';
  var P = global.LectureParser;
  var inline = P.inline, esc = P.esc;

  /* ---------------- icon set (line, hex stroke) ---------------- */
  var ICON_PATHS = {
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="C" stroke="none"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3Z"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5.6M17 20a5.5 5.5 0 0 0-2.2-4.4"/>',
    puzzle: '<path d="M10 4a2 2 0 0 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 0 1 0 4h-1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 0 0-4 0v1H7a1 1 0 0 1-1-1v-3H5a2 2 0 0 1 0-4h1V6a1 1 0 0 1 1-1h3Z"/>',
    layers: '<path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
    gamepad: '<path d="M7 9h10a5 5 0 0 1 5 5 3 3 0 0 1-5.4 1.8L15 14H9l-1.6 1.8A3 3 0 0 1 2 14a5 5 0 0 1 5-5Z"/><path d="M6 12h2M7 11v2M15.5 11h.01M17.5 13h.01"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3M10 17h4M9 21h6M12 13v4"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h6v16H6a2 2 0 0 0-2 2V5Z"/><path d="M20 5a2 2 0 0 0-2-2h-6v16h6a2 2 0 0 1 2 2V5Z"/>',
    chart: '<path d="M4 4v16h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
    flag: '<path d="M6 21V4M6 4h11l-2 3 2 3H6"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    scale: '<path d="M12 4v16M7 20h10M5 8l-2.5 5a3 3 0 0 0 5 0L5 8Zm0 0 7-1.5M19 8l-2.5 5a3 3 0 0 0 5 0L19 8Zm0 0-7 1.5"/>',
    link: '<path d="M9.5 14.5 14.5 9.5M8 12l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 12l2-2a3.5 3.5 0 0 0-5-5l-2 2"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    message: '<path d="M4 5h16v11H9l-4 3v-3H4V5Z"/><path d="M8 9h8M8 12h5"/>',
    rocket: '<path d="M12 3c3 1.5 5 4.5 5 8l-2 4H9l-2-4c0-3.5 2-6.5 5-8Z"/><circle cx="12" cy="9" r="1.6"/><path d="M9 15l-2 4M15 15l2 4M12 15v5"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    spark: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3.5 3.5M14.5 14.5 18 18M18 6l-3.5 3.5M9.5 14.5 6 18"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.3 2.3L16 9.5"/>'
  };
  var ICON_ORDER = ['target', 'bulb', 'puzzle', 'layers', 'compass', 'gear', 'chart', 'users', 'book', 'rocket', 'eye', 'spark', 'grid', 'shield'];

  function iconSvg(name, color) {
    color = color || '#3FC6F1';
    var p = (ICON_PATHS[name] || ICON_PATHS.target).replace(/C/g, color);
    return '<svg viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  }
  function pickIcon(i) { return ICON_ORDER[i % ICON_ORDER.length]; }

  /* ---------------- editable helpers ---------------- */
  var eid = 0;
  function ed(html, tag, cls) {
    tag = tag || 'div';
    return '<' + tag + (cls ? ' class="' + cls + '"' : '') + ' data-edit="t-' + (eid++) + '">' + html + '</' + tag + '>';
  }
  function frame(imgId, ph) {
    return '<div class="frame anim anim-3" data-img="' + (imgId || '') + '"><span class="ph">' +
      esc(ph || '이미지') + '</span></div>';
  }
  function clip(s, n) {
    s = (s || '').trim();
    if (s.length <= n) return s;
    return s.slice(0, n).replace(/[\s,·]+\S*$/, '') + '…';
  }

  /* ============================================================
     RENDERERS — return {cls, html}
     ============================================================ */
  var R = {};

  R.intro = function (s) {
    return { cls: 'intro bleed', html:
      '<div class="bleed-inner">' +
        '<div class="eyebrow anim">' + esc(s.eyebrow || 'INTRODUCTION') + '</div>' +
        '<div class="divider anim anim-2"></div>' +
        ed(inline(s.title || ''), 'h1', 'anim anim-2') +
        (s.lead ? ed(inline(s.lead), 'p', 'lead anim anim-3') : '') +
      '</div>' };
  };

  R.part = function (s) {
    return { cls: 'part bleed', html:
      '<div class="bleed-inner">' +
        '<div class="eyebrow anim">' + esc(s.eyebrow || 'PART') + '</div>' +
        '<div class="divider anim anim-2 center"></div>' +
        ed(inline(s.title || ''), 'h1', 'anim anim-2') +
        (s.sub ? ed(inline(s.sub), 'p', 'sub anim anim-3') : '') +
        (s.progress ? '<div class="prog anim anim-3">' + esc(s.progress) + '</div>' : '') +
      '</div>' };
  };

  R['section'] = function (s) {
    return { cls: 'bleed section-div', html:
      '<div class="bleed-inner" style="justify-content:center">' +
        '<div class="split-divider">' +
          '<div class="text">' +
            (s.num ? '<div class="num anim"><span class="num-main">' + esc(s.num) + '</span>' +
              (s.progress ? '<span class="prog-inline">' + esc(s.progress) + '</span>' : '') + '</div>' : '') +
            ed(inline(s.title || ''), 'h1', 'anim anim-2') +
            (s.sub ? ed(inline(s.sub), 'p', 'subtitle anim anim-2') : '') +
            (s.desc ? ed(inline(s.desc), 'p', 'desc anim anim-3') : '') +
          '</div>' +
          frame(s.image, s.imgPh || '단원 이미지') +
        '</div>' +
      '</div>' };
  };

  R.closing = function (s) {
    return { cls: 'closing bleed', html:
      '<div class="bleed-inner" style="justify-content:center">' +
        '<div class="split-divider">' +
          '<div class="text">' +
            (s.eyebrow ? '<div class="num anim">' + esc(s.eyebrow) + '</div>' : '') +
            ed(inline(s.title || ''), 'h1', 'anim anim-2') +
            (s.sub ? ed(inline(s.sub), 'p', 'subtitle anim anim-3') : '') +
          '</div>' +
          frame(s.image, s.imgPh || '마무리 이미지') +
        '</div>' +
      '</div>' };
  };

  function head(s) {
    return '<div class="page-head">' +
      '<div class="eyebrow anim">' + esc(s.eyebrow || '') + '</div>' +
      '<div class="divider anim"></div>' +
      ed(inline(s.title || ''), 'h2', 'page-title anim anim-2') +
      '</div>';
  }

  R.three = function (s) {
    var cards = (s.cards || []).slice(0, 3).map(function (c, i) {
      return '<div class="card anim anim-' + (i + 2) + '">' +
        '<span class="card-idx">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<div class="icon">' + iconSvg(c.icon || pickIcon(i)) + '</div>' +
        ed(inline(c.title || ''), 'h3') +
        (c.desc ? ed(inline(c.desc), 'p') : '') +
      '</div>';
    }).join('');
    return { cls: '', html: head(s) + '<div class="cards-3">' + cards + '</div>' };
  };

  R.two = function (s) {
    var tones = ['', 'purple'];
    var cards = (s.cards || []).slice(0, 2).map(function (c, i) {
      var tone = c.tone || tones[i] || '';
      var col = tone === 'purple' ? '#B194E8' : (tone === 'amber' ? '#F0B450' : '#3FC6F1');
      return '<div class="card ' + tone + ' anim anim-' + (i + 2) + '">' +
        '<span class="card-idx">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<div class="head"><div class="icon">' + iconSvg(c.icon || pickIcon(i), col) + '</div>' +
        ed(inline(c.title || ''), 'h3') + '</div>' +
        (c.desc ? ed(inline(c.desc), 'p') : '') +
      '</div>';
    }).join('');
    return { cls: '', html: head(s) + '<div class="cards-2">' + cards + '</div>' };
  };

  R.check = function (s) {
    var items = (s.items || []).slice(0, 8).map(function (it) {
      var txt = it.label ? '<b>' + inline(it.label) + '</b> — ' + inline(it.desc || '') : inline(it.desc || '');
      return '<div class="check-item">' +
        '<span class="tick">' + iconSvg('check') + '</span>' +
        ed(txt, 'div', 'txt') + '</div>';
    }).join('');
    return { cls: '', html: head(s) + '<div class="checklist"><div class="card anim anim-2">' + items + '</div></div>' };
  };

  R.split = function (s) {
    var blocks = (s.paras || []).slice(0, 3).map(function (p, i) {
      return ed(inline(p), 'p', 'body-text anim anim-' + (i + 2));
    }).join('');
    if (!s.image) {
      // no image → single-column text (no empty frame)
      return { cls: '', html: head(s) +
        '<div class="split" style="grid-template-columns:1fr"><div class="text" style="max-width:1400px">' + blocks + '</div></div>' };
    }
    return { cls: '', html: head(s) +
      '<div class="split' + (s.wide ? ' wide' : '') + '">' +
        '<div class="text">' + blocks + '</div>' +
        frame(s.image, s.imgPh || '이미지') +
      '</div>' };
  };

  R.agenda = function (s) {
    var items = (s.items || []).slice(0, 10);
    var cols = items.length > 5 ? 2 : 1;
    var rows = items.map(function (it, i) {
      return '<div class="agenda-item anim anim-' + (Math.min(i, 3) + 2) + '">' +
        '<span class="ag-no">' + esc(it.label || String(i + 1).padStart(2, '0')) + '</span>' +
        ed(inline(it.desc || it.label || ''), 'div', 'ag-title') + '</div>';
    }).join('');
    return { cls: '', html: head(s) +
      '<div class="agenda" style="grid-template-columns:repeat(' + cols + ',1fr)">' + rows + '</div>' };
  };

  R.bullet = function (s) {
    var bs = (s.items || []).slice(0, 5).map(function (it) {
      var txt = it.label ? '<span class="lbl">' + inline(it.label) + '</span> — ' + inline(it.desc || '') : inline(it.desc || '');
      return '<div class="bullet"><span class="dot"></span>' + ed(txt, 'div', 'txt') + '</div>';
    }).join('');
    var left = '<div class="text"><div class="bullets anim anim-2">' + bs + '</div></div>';
    if (s.image) {
      return { cls: '', html: head(s) + '<div class="split"><div class="text"><div class="bullets">' + bs + '</div></div>' + frame(s.image, s.imgPh || '이미지') + '</div>' };
    }
    return { cls: '', html: head(s) + '<div class="split" style="grid-template-columns:1fr">' + left + '</div>' };
  };

  R.caseStudy = function (s) {
    return { cls: '', html:
      '<div class="case">' +
        '<div class="text">' +
          '<div class="eyebrow red anim">CASE STUDY</div>' +
          '<div class="divider anim" style="background:#E94560"></div>' +
          ed(inline(s.title || ''), 'h2', 'anim anim-2') +
          (s.body || []).slice(0, 2).map(function (p, i) { return ed(inline(p), 'p', 'body-text anim anim-' + (i + 2)); }).join('') +
          (s.source ? '<div class="src-wrap anim anim-4">' + ed(esc(s.source), 'div', 'source') + '</div>' : '') +
        '</div>' +
        frame(s.image, s.imgPh || '사례 이미지') +
      '</div>' };
  };

  R.caseTwo = function (s) {
    var cols = (s.cols || []).slice(0, 2).map(function (c, i) {
      return '<div class="col anim anim-' + (i + 2) + '">' +
        ed(inline(c.title || ''), 'h3') +
        frame(c.image, c.imgPh || '이미지') +
        (c.desc ? ed(inline(c.desc), 'p', 'body-text') : '') +
      '</div>';
    }).join('');
    return { cls: '', html:
      '<div class="page-head"><div class="eyebrow red anim">CASE STUDY</div><div class="divider anim" style="background:#E94560"></div>' +
      ed(inline(s.title || ''), 'h2', 'page-title anim anim-2') + '</div>' +
      '<div class="case2"><div class="cols">' + cols + '</div></div>' };
  };

  R.quote = function (s) {
    return { cls: 'quote bleed', html:
      '<div class="bleed-inner">' +
        (s.eyebrow ? '<div class="eyebrow anim">' + esc(s.eyebrow) + '</div>' : '') +
        '<div class="divider anim anim-2"></div>' +
        ed('<span class="mark">“</span>' + inline(s.title || '') + '<span class="mark">”</span>', 'blockquote', 'anim anim-2') +
        (s.sub ? ed(inline(s.sub), 'p', 'attr anim anim-3') : '') +
      '</div>' };
  };

  R.refs = function (s) {
    var cards = (s.cards || []).slice(0, 4).map(function (c, i) {
      var tags = (c.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
      return '<div class="card anim anim-' + (i + 2) + '">' +
        '<div class="ref-no">REF ' + String(i + 1).padStart(2, '0') + '</div>' +
        ed(inline(c.title || ''), 'h3') +
        (tags ? '<div class="tags">' + tags + '</div>' : '') +
      '</div>';
    }).join('');
    return { cls: '', html: head(s) + '<div class="refs">' + cards + '</div>' };
  };

  R.table = function (s) {
    var thead = '<tr>' + (s.headers || []).map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>';
    var rows = (s.rows || []).map(function (r) {
      return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return { cls: '', html: head(s) + '<div class="deck-table-wrap anim anim-2"><table class="deck-table"><thead>' + thead + '</thead><tbody>' + rows + '</tbody></table></div>' };
  };

  /* map pattern key → renderer */
  var RENDER = {
    'intro-slide': R.intro, 'part-divider': R.part, 'section-divider': R['section'],
    'closing-slide': R.closing, 'three-cards': R.three, 'two-cards': R.two,
    'check-box': R.check, 'split-text-image': R.split, 'case-study': R.caseStudy,
    'case-two-image': R.caseTwo, 'quote-slide': R.quote, 'ref-games': R.refs,
    'deck-table': R.table, 'bullet-list': R.bullet, 'agenda': R.agenda
  };

  var PATTERN_LIST = [
    ['intro-slide', '인트로'], ['part-divider', '파트 디바이더'], ['section-divider', '섹션 디바이더'],
    ['closing-slide', '클로징'], ['three-cards', '3-카드'], ['two-cards', '2-카드'],
    ['check-box', '체크리스트'], ['split-text-image', '좌텍스트/우이미지'], ['case-study', '케이스 스터디'],
    ['case-two-image', '케이스 2-이미지'], ['quote-slide', '인용문'], ['ref-games', '레퍼런스 그리드'],
    ['deck-table', '데크 테이블'], ['bullet-list', '글머리 리스트'], ['agenda', '개요']
  ];

  function renderSlide(spec) {
    var fn = RENDER[spec.pattern] || R.split;
    var out = fn(spec);
    return { cls: out.cls, html: out.html };
  }

  global.DeckPatterns = {
    render: renderSlide, RENDER: RENDER, PATTERN_LIST: PATTERN_LIST,
    iconSvg: iconSvg, ICON_ORDER: ICON_ORDER, clip: clip
  };
})(window);
