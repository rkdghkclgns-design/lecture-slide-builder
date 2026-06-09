/* ============================================================
   pptx-export.js — 네이티브 편집 가능 PPTX 추출 (PptxGenJS)
   슬라이드 DOM(편집·패턴 변경·이미지 반영)을 읽어 텍스트박스·도형·
   이미지로 출력. 래스터화 없음 → CORS/폰트 행 없음, PowerPoint 편집 가능.
   1920×1080px = 13.333×7.5in,  1px = 1/144in,  fontPt = px * 0.5
   ============================================================ */
(function (global) {
  'use strict';

  // tokens (no #)
  var C = {
    bg: '0A1428', deep: '060E1F', card: '14223A', frame: '0F192D', border: '2A4566',
    accent: '3FC6F1', accentBg: '15314A', red: 'E94560', purple: 'B194E8', amber: 'F0B450',
    text: 'FFFFFF', text2: 'B8C5D6', muted: '6B7A92', cell: 'DBE2EC', cellAlt: 'E9EEF4', ink: '111827'
  };
  var FONT = 'Pretendard', MONO = 'JetBrains Mono';
  function IN(px) { return px / 144; }
  function PT(px) { return px * 0.5; }

  /* ---- read helpers ---- */
  // textContent (not innerText) — deck-stage hides non-active slides with
  // visibility:hidden, which makes innerText return "" for every slide being
  // exported except the active one. textContent is layout-independent.
  function T(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
  function qa(r, s) { return Array.prototype.slice.call(r.querySelectorAll(s)); }
  function imgSrc(fr) { var im = fr && fr.querySelector('img'); return im ? im.src : null; }

  /* ---- SVG icon → PNG dataURL (crisp, no external fonts) ---- */
  function iconBadgePng(name, color, withCircle) {
    var inner = global.DeckPatterns.iconSvg(name, '#' + (color || C.accent)); // <svg ...>…</svg>
    var paths = inner.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    var bg = withCircle ? '<circle cx="40" cy="40" r="40" fill="#' + C.accentBg + '"/>' : '';
    var g = '<g transform="translate(20,20) scale(1.667)" fill="none" stroke="#' + (color || C.accent) +
      '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + paths + '</g>';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' + bg + g + '</svg>';
    return rasterize(svg, 160, 160);
  }
  function rasterize(svg, w, h) {
    return new Promise(function (res) {
      var url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        res(c.toDataURL('image/png'));
      };
      img.onerror = function () { res(null); };
      img.src = url;
    });
  }

  /* ---- common atoms ---- */
  function bg(slide) { slide.background = { color: C.bg }; }
  function eyebrow(slide, text, x, y, w, color) {
    if (!text) return;
    slide.addText(text.toUpperCase(), { x: IN(x), y: IN(y), w: IN(w), h: IN(40), fontFace: MONO,
      fontSize: PT(26), bold: true, color: color || C.accent, charSpacing: 2, align: 'left', valign: 'middle' });
  }
  function divider(slide, x, y, color) {
    slide.addShape('rect', { x: IN(x), y: IN(y), w: IN(72), h: IN(4), fill: { color: color || C.accent } });
  }
  function cardShape(slide, x, y, w, h) {
    slide.addShape('roundRect', { x: IN(x), y: IN(y), w: IN(w), h: IN(h), rectRadius: IN(24),
      fill: { color: C.card }, line: { color: C.border, width: 1 } });
  }
  function frameShape(slide, x, y, w, h, src, ph) {
    slide.addShape('roundRect', { x: IN(x), y: IN(y), w: IN(w), h: IN(h), rectRadius: IN(24),
      fill: { color: C.frame }, line: { color: C.border, width: 1 } });
    if (src) {
      slide.addImage({ data: src, x: IN(x + 1), y: IN(y + 1), w: IN(w - 2), h: IN(h - 2), sizing: { type: 'contain', w: IN(w - 2), h: IN(h - 2) } });
    } else if (ph) {
      slide.addText(ph, { x: IN(x), y: IN(y), w: IN(w), h: IN(h), align: 'center', valign: 'middle',
        color: C.text, bold: true, fontFace: FONT, fontSize: PT(28) });
    }
  }
  // rich text: <strong>/<b>→bold white, .k/.lbl→accent
  function rich(el, baseColor) {
    if (!el) return [{ text: '' }];
    var runs = [];
    el.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { if (n.textContent) runs.push({ text: n.textContent, options: { color: baseColor } }); }
      else {
        var t = n.textContent || '';
        var cls = n.className || '', tag = n.tagName;
        var o = { color: baseColor };
        if (tag === 'STRONG' || tag === 'B') { o.bold = true; o.color = C.text; }
        if (/\bk\b|\blbl\b|\bmark\b/.test(cls)) o.color = C.accent;
        runs.push({ text: t, options: o });
      }
    });
    return runs.length ? runs : [{ text: T(el), options: { color: baseColor } }];
  }

  /* ============================================================
     per-pattern renderers (read sec DOM)
     ============================================================ */
  var REN = {};

  REN['intro-slide'] = REN['part-divider'] = async function (slide, sec, pat) {
    bg(slide);
    var big = pat === 'part-divider';
    var eb = T(sec.querySelector('.eyebrow'));
    slide.addText((eb || (big ? 'PART' : 'INTRODUCTION')).toUpperCase(), { x: 0, y: IN(big ? 300 : 320), w: IN(1920), h: IN(40),
      align: 'center', fontFace: MONO, bold: true, fontSize: PT(28), color: C.accent, charSpacing: 2 });
    slide.addShape('rect', { x: IN(924), y: IN(big ? 370 : 388), w: IN(72), h: IN(4), fill: { color: C.accent } });
    var h = sec.querySelector('h1');
    slide.addText(rich(h, C.text), { x: IN(160), y: IN(big ? 410 : 430), w: IN(1600), h: IN(big ? 200 : 180),
      align: 'center', valign: 'middle', fontFace: FONT, bold: true, fontSize: PT(big ? 120 : 88), color: C.text, lineSpacingMultiple: 1.05 });
    var lead = sec.querySelector('.lead, .sub');
    if (lead) slide.addText(T(lead), { x: IN(370), y: IN(big ? 640 : 650), w: IN(1180), h: IN(140),
      align: 'center', valign: 'top', fontFace: FONT, fontSize: PT(30), color: C.text2, lineSpacingMultiple: 1.4 });
    var prog = big && T(sec.querySelector('.prog'));
    if (prog) slide.addText(prog, { x: 0, y: IN(800), w: IN(1920), h: IN(40), align: 'center', fontFace: MONO, fontSize: PT(24), color: C.muted, charSpacing: 1 });
  };

  REN['section-divider'] = REN['closing-slide'] = async function (slide, sec, pat) {
    bg(slide);
    var closing = pat === 'closing-slide';
    var num = T(sec.querySelector('.num-main')) || T(sec.querySelector('.num'));
    var prog = T(sec.querySelector('.prog-inline'));
    var lx = 100, lw = 820;
    if (num) slide.addText(num.toUpperCase() + (prog ? '   ' + prog : ''), { x: IN(lx), y: IN(300), w: IN(lw), h: IN(40), fontFace: MONO, bold: true, fontSize: PT(28), color: C.accent, charSpacing: 2 });
    var h = sec.querySelector('h1');
    slide.addText(rich(h, C.text), { x: IN(lx), y: IN(346), w: IN(lw), h: IN(closing ? 360 : 320),
      fontFace: FONT, bold: true, fontSize: PT(closing ? 110 : 96), color: C.text, lineSpacingMultiple: 1.03, valign: 'top' });
    var st = sec.querySelector('.subtitle');
    if (st) slide.addText(T(st), { x: IN(lx), y: IN(690), w: IN(lw), h: IN(60), fontFace: FONT, bold: true, fontSize: PT(34), color: C.accent });
    var ds = sec.querySelector('.desc');
    if (ds) slide.addText(T(ds), { x: IN(lx), y: IN(770), w: IN(lw), h: IN(120), fontFace: FONT, fontSize: PT(28), color: C.text2, lineSpacingMultiple: 1.4 });
    var fr = sec.querySelector('.frame');
    frameShape(slide, 1000, 285, 820, 510, fr && imgSrc(fr), fr ? T(fr.querySelector('.ph')) : '');
  };

  function headBlock(slide, sec) {
    var eb = T(sec.querySelector('.eyebrow'));
    var red = sec.querySelector('.eyebrow.red');
    eyebrow(slide, eb, 100, 100, 1200, red ? C.red : C.accent);
    divider(slide, 100, 150, red ? C.red : C.accent);
    var title = sec.querySelector('.page-title');
    if (title) slide.addText(rich(title, C.accent), { x: IN(100), y: IN(178), w: IN(1720), h: IN(120),
      fontFace: FONT, bold: true, fontSize: PT(64), color: C.accent, lineSpacingMultiple: 1.05, valign: 'top' });
  }

  REN['three-cards'] = async function (slide, sec) {
    bg(slide); headBlock(slide, sec);
    var cards = qa(sec, '.cards-3 .card');
    var n = cards.length || 3, gap = 40, x0 = 100, total = 1720;
    var w = (total - gap * (n - 1)) / n, y = 360, h = 600;
    for (var i = 0; i < cards.length; i++) {
      var x = x0 + i * (w + gap);
      cardShape(slide, x, y, w, h);
      var icon = await iconBadgePng(global.DeckPatterns.ICON_ORDER[i % 14], C.accent, true);
      if (icon) slide.addImage({ data: icon, x: IN(x + 64), y: IN(y + 44), w: IN(80), h: IN(80) });
      slide.addText(rich(cards[i].querySelector('h3'), C.text), { x: IN(x + 64), y: IN(y + 150), w: IN(w - 128), h: IN(110), fontFace: FONT, bold: true, fontSize: PT(36), color: C.text, lineSpacingMultiple: 1.1, valign: 'top' });
      var p = cards[i].querySelector('p');
      if (p) slide.addText(rich(p, C.text2), { x: IN(x + 64), y: IN(y + 268), w: IN(w - 128), h: IN(280), fontFace: FONT, fontSize: PT(28), color: C.text2, lineSpacingMultiple: 1.4, valign: 'top' });
    }
  };

  REN['two-cards'] = async function (slide, sec) {
    bg(slide); headBlock(slide, sec);
    var cards = qa(sec, '.cards-2 .card'), gap = 56, x0 = 100, w = (1720 - gap) / 2, y = 360, h = 600;
    var tones = [C.accent, C.purple];
    for (var i = 0; i < cards.length; i++) {
      var x = x0 + i * (w + gap), col = cards[i].classList.contains('purple') ? C.purple : (cards[i].classList.contains('amber') ? C.amber : tones[i] || C.accent);
      cardShape(slide, x, y, w, h);
      var icon = await iconBadgePng(global.DeckPatterns.ICON_ORDER[i % 14], col, true);
      if (icon) slide.addImage({ data: icon, x: IN(x + 56), y: IN(y + 52), w: IN(80), h: IN(80) });
      slide.addText(rich(cards[i].querySelector('h3'), C.text), { x: IN(x + 160), y: IN(y + 52), w: IN(w - 220), h: IN(90), fontFace: FONT, bold: true, fontSize: PT(38), color: C.text, valign: 'middle' });
      var p = cards[i].querySelector('p');
      if (p) slide.addText(rich(p, C.text2), { x: IN(x + 56), y: IN(y + 170), w: IN(w - 112), h: IN(380), fontFace: FONT, fontSize: PT(28), color: C.text2, lineSpacingMultiple: 1.45, valign: 'top' });
    }
  };

  REN['check-box'] = async function (slide, sec) {
    bg(slide); headBlock(slide, sec);
    var items = qa(sec, '.check-item');
    var y0 = 360, ch = Math.min(620, 60 + items.length * 92), pad = 52;
    cardShape(slide, 100, y0, 1720, ch);
    var tick = await iconBadgePng('check', C.accent, false);
    var iy = y0 + pad, rowH = (ch - pad * 2) / Math.max(items.length, 1);
    items.forEach(function (it, i) {
      var ry = y0 + pad + i * rowH;
      if (tick) slide.addImage({ data: tick, x: IN(156), y: IN(ry + 4), w: IN(44), h: IN(44) });
      slide.addText(rich(it.querySelector('.txt'), C.text2), { x: IN(224), y: IN(ry), w: IN(1540), h: IN(rowH), fontFace: FONT, fontSize: PT(28), color: C.text2, valign: 'middle', lineSpacingMultiple: 1.3 });
    });
  };

  REN['split-text-image'] = async function (slide, sec) {
    bg(slide); headBlock(slide, sec);
    var paras = qa(sec, '.split .text .body-text');
    var y = 360, lw = 880;
    var runs = [];
    paras.forEach(function (p, i) { if (i) runs.push({ text: '\n\n', options: {} }); rich(p, C.text2).forEach(function (r) { runs.push(r); }); });
    slide.addText(runs.length ? runs : [{ text: '' }], { x: IN(100), y: IN(y), w: IN(lw), h: IN(560), fontFace: FONT, fontSize: PT(28), color: C.text2, lineSpacingMultiple: 1.5, valign: 'middle' });
    var fr = sec.querySelector('.frame');
    if (fr) frameShape(slide, 1040, 360, 780, 560, imgSrc(fr), T(fr.querySelector('.ph')));
  };

  REN['agenda'] = async function (slide, sec) {
    bg(slide); headBlock(slide, sec);
    var items = qa(sec, '.agenda-item');
    var n = items.length, cols = n > 5 ? 2 : 1, perCol = Math.ceil(n / cols);
    var y0 = 380, colW = cols === 2 ? 820 : 1720, gap = 64;
    items.forEach(function (it, i) {
      var col = Math.floor(i / perCol), row = i % perCol;
      var x = 100 + col * (colW + gap), y = y0 + row * 96;
      var no = T(it.querySelector('.ag-no')), title = T(it.querySelector('.ag-title'));
      slide.addText(no, { x: IN(x), y: IN(y), w: IN(70), h: IN(56), fontFace: MONO, bold: true, fontSize: PT(34), color: C.accent, valign: 'middle' });
      slide.addText(title, { x: IN(x + 86), y: IN(y), w: IN(colW - 86), h: IN(56), fontFace: FONT, bold: true, fontSize: PT(34), color: C.text, valign: 'middle' });
      slide.addShape('line', { x: IN(x), y: IN(y + 78), w: IN(colW), h: 0, line: { color: C.border, width: 1 } });
    });
  };

  REN['bullet-list'] = async function (slide, sec) {
    bg(slide); headBlock(slide, sec);
    var bs = qa(sec, '.bullet');
    var hasImg = sec.querySelector('.split .frame');
    var lw = hasImg ? 880 : 1720, y0 = 380, rowH = 110;
    bs.forEach(function (b, i) {
      var ry = y0 + i * rowH;
      slide.addShape('ellipse', { x: IN(100), y: IN(ry + 12), w: IN(14), h: IN(14), fill: { color: C.accent } });
      slide.addText(rich(b.querySelector('.txt'), C.text2), { x: IN(134), y: IN(ry), w: IN(lw - 50), h: IN(rowH), fontFace: FONT, fontSize: PT(28), color: C.text2, valign: 'top', lineSpacingMultiple: 1.35 });
    });
    if (hasImg) frameShape(slide, 1040, 360, 780, 560, imgSrc(hasImg), T(hasImg.querySelector('.ph')));
  };

  REN['case-study'] = async function (slide, sec) {
    bg(slide);
    eyebrow(slide, 'CASE STUDY', 100, 150, 600, C.red);
    divider(slide, 100, 200, C.red);
    slide.addText(rich(sec.querySelector('.case h2'), C.accent), { x: IN(100), y: IN(240), w: IN(880), h: IN(200), fontFace: FONT, bold: true, fontSize: PT(80), color: C.accent, lineSpacingMultiple: 1.05, valign: 'top' });
    var body = qa(sec, '.case .body-text'); var runs = [];
    body.forEach(function (p, i) { if (i) runs.push({ text: '\n\n', options: {} }); rich(p, C.text2).forEach(function (r) { runs.push(r); }); });
    slide.addText(runs.length ? runs : [{ text: '' }], { x: IN(100), y: IN(470), w: IN(880), h: IN(360), fontFace: FONT, fontSize: PT(28), color: C.text2, lineSpacingMultiple: 1.45, valign: 'top' });
    var src = T(sec.querySelector('.source'));
    if (src) { slide.addShape('line', { x: IN(100), y: IN(880), w: IN(880), h: 0, line: { color: C.border, width: 1 } });
      slide.addText(src, { x: IN(100), y: IN(896), w: IN(880), h: IN(50), fontFace: FONT, italic: true, fontSize: PT(24), color: C.muted }); }
    var fr = sec.querySelector('.frame');
    frameShape(slide, 1080, 200, 740, 700, fr && imgSrc(fr), fr ? T(fr.querySelector('.ph')) : '');
  };

  REN['case-two-image'] = async function (slide, sec) {
    bg(slide);
    eyebrow(slide, 'CASE STUDY', 100, 100, 600, C.red);
    divider(slide, 100, 150, C.red);
    slide.addText(rich(sec.querySelector('.page-title'), C.accent), { x: IN(100), y: IN(178), w: IN(1720), h: IN(110), fontFace: FONT, bold: true, fontSize: PT(64), color: C.accent });
    var cols = qa(sec, '.case2 .col'), gap = 80, w = (1720 - gap) / 2, x0 = 100, y = 360;
    cols.forEach(function (c, i) {
      var x = x0 + i * (w + gap);
      slide.addText(rich(c.querySelector('h3'), C.accent), { x: IN(x), y: IN(y), w: IN(w), h: IN(60), fontFace: FONT, bold: true, fontSize: PT(38), color: C.accent });
      var fr = c.querySelector('.frame');
      frameShape(slide, x, y + 80, w, 460, fr && imgSrc(fr), fr ? T(fr.querySelector('.ph')) : '');
      var p = c.querySelector('.body-text');
      if (p) slide.addText(T(p), { x: IN(x), y: IN(y + 560), w: IN(w), h: IN(120), fontFace: FONT, fontSize: PT(26), color: C.text2, lineSpacingMultiple: 1.4 });
    });
  };

  REN['quote-slide'] = async function (slide, sec) {
    bg(slide);
    var eb = T(sec.querySelector('.eyebrow'));
    if (eb) slide.addText(eb.toUpperCase(), { x: 0, y: IN(300), w: IN(1920), h: IN(40), align: 'center', fontFace: MONO, bold: true, fontSize: PT(26), color: C.accent, charSpacing: 2 });
    slide.addShape('rect', { x: IN(924), y: IN(366), w: IN(72), h: IN(4), fill: { color: C.accent } });
    var bq = sec.querySelector('blockquote');
    slide.addText(rich(bq, C.text), { x: IN(220), y: IN(410), w: IN(1480), h: IN(260), align: 'center', valign: 'middle', fontFace: FONT, bold: true, fontSize: PT(64), color: C.text, lineSpacingMultiple: 1.22 });
    var at = sec.querySelector('.attr');
    if (at) slide.addText(T(at), { x: IN(360), y: IN(700), w: IN(1200), h: IN(60), align: 'center', fontFace: FONT, fontSize: PT(30), color: C.text2 });
  };

  REN['ref-games'] = async function (slide, sec) {
    bg(slide); headBlock(slide, sec);
    var cards = qa(sec, '.refs .card'), gap = 36, x0 = 100, w = (1720 - gap * 3) / 4, y = 360, h = 560;
    cards.forEach(function (c, i) {
      var x = x0 + i * (w + gap);
      cardShape(slide, x, y, w, h);
      slide.addText('REF ' + String(i + 1).padStart(2, '0'), { x: IN(x + 36), y: IN(y + 40), w: IN(w - 72), h: IN(36), fontFace: MONO, bold: true, fontSize: PT(26), color: C.accent, charSpacing: 2 });
      slide.addText(rich(c.querySelector('h3'), C.text), { x: IN(x + 36), y: IN(y + 110), w: IN(w - 72), h: IN(300), fontFace: FONT, bold: true, fontSize: PT(36), color: C.text, valign: 'top', lineSpacingMultiple: 1.15 });
      var tags = qa(c, '.tag').map(function (t) { return T(t); }).join('  ');
      if (tags) slide.addText(tags, { x: IN(x + 36), y: IN(y + h - 80), w: IN(w - 72), h: IN(50), fontFace: MONO, fontSize: PT(22), color: C.text2 });
    });
  };

  REN['deck-table'] = async function (slide, sec) {
    bg(slide); headBlock(slide, sec);
    var headers = qa(sec, 'table.deck-table thead th').map(function (th) { return T(th); });
    var rows = qa(sec, 'table.deck-table tbody tr').map(function (tr) { return qa(tr, 'td').map(function (td) { return T(td); }); });
    var body = [];
    body.push(headers.map(function (h) { return { text: h, options: { color: C.accent, bold: true, fontSize: PT(28), fill: { color: C.bg } } }; }));
    rows.forEach(function (r, ri) {
      body.push(r.map(function (cell, ci) { return { text: cell, options: { color: C.ink, fontSize: PT(26), bold: ci === 0, fill: { color: ri % 2 ? C.cell : C.cellAlt } } }; }));
    });
    slide.addTable(body, { x: IN(100), y: IN(360), w: IN(1720), fontFace: FONT, border: { type: 'solid', color: C.bg, pt: 3 }, valign: 'middle', rowH: IN(72), align: 'left', margin: [6, 14, 6, 14] });
  };

  /* ============================================================
     export entry
     ============================================================ */
  async function exportPptx(deck, fileName, onProgress) {
    var secs = qa(deck, 'section.slide');
    var pptx = new global.PptxGenJS();
    pptx.defineLayout({ name: 'W169', width: 13.333, height: 7.5 });
    pptx.layout = 'W169';
    for (var i = 0; i < secs.length; i++) {
      var sec = secs[i];
      var pat = sec.getAttribute('data-pat');
      var slide = pptx.addSlide();
      var fn = REN[pat] || REN['split-text-image'];
      try { await fn(slide, sec, pat); }
      catch (e) { bg(slide); slide.addText('[' + pat + '] 렌더 오류', { x: 1, y: 1, w: 8, h: 1, color: C.text }); console.error(pat, e); }
      // running footer (page number, bottom-right) on content slides
      if (!sec.classList.contains('bleed')) {
        slide.addText([{ text: String(i + 1).padStart(2, '0'), options: { color: C.accent, bold: true } }, { text: ' / ' + String(secs.length).padStart(2, '0'), options: { color: C.text2 } }],
          { x: IN(1020), y: IN(1000), w: IN(800), h: IN(36), fontFace: MONO, fontSize: PT(20), align: 'right', valign: 'middle', charSpacing: 1 });
      }
      if (onProgress) onProgress(i + 1, secs.length);
    }
    // manual blob + download (watchdog-friendly)
    var blob = await pptx.write('blob');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileName;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return blob.size;
  }

  global.DeckPptx = { export: exportPptx };
})(window);
