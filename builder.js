/* ============================================================
   builder.js — 앱 오케스트레이션
   입력 → 파싱 → 추론 → deck-stage 렌더 · 이미지 매칭 · 편집 · 내보내기
   ============================================================ */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var state = {
    specs: [],            // slide specs aligned to sections
    imgMap: {},           // imageId / slotId → dataURL
    uploads: []           // {name, url}
  };
  var deck = null;
  var specByEl = new WeakMap();

  /* ---------------- UI plumbing ---------------- */
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function busy(on, lbl) {
    $('#busyLbl').textContent = lbl || '처리 중…';
    $('#busy').classList.toggle('show', !!on);
  }
  function openPanel(tab) {
    document.body.classList.remove('collapsed');
    if (tab) selectTab(tab);
  }
  function selectTab(tab) {
    $$('.tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    $$('.tabpane').forEach(function (p) { p.classList.toggle('active', p.dataset.pane === tab); });
  }
  $$('.tabs button').forEach(function (b) { b.addEventListener('click', function () { selectTab(b.dataset.tab); }); });
  $('#togglePanel').addEventListener('click', function () { document.body.classList.toggle('collapsed'); });

  // export menu
  var menu = $('#exportMenu');
  $('#exportBtn').addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('open'); });
  document.addEventListener('click', function () { menu.classList.remove('open'); });
  $$('#exportMenu .pop button').forEach(function (b) {
    b.addEventListener('click', function () {
      menu.classList.remove('open');
      if (!deck) { toast('먼저 슬라이드를 생성하세요'); return; }
      var x = b.dataset.x;
      if (x === 'html') exportHTML();
      else if (x === 'pdf') exportPDF();
      else if (x === 'pptx') exportPPTX();
    });
  });

  /* ---------------- input ---------------- */
  $('#mdFile').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () { $('#md').value = r.result; toast('불러왔습니다 · 생성을 눌러주세요'); };
    r.readAsText(f);
  });
  $('#loadMd').addEventListener('click', function () { $('#mdFile').click(); });
  $('#sampleBtn').addEventListener('click', function () { $('#md').value = SAMPLE; toast('예제를 채웠습니다'); });
  $('#genBtn').addEventListener('click', generate);
  $('#emptyGen').addEventListener('click', function () {
    if (!$('#md').value.trim()) $('#md').value = SAMPLE;
    generate();
  });

  // Home → 처음 화면(랜딩)으로. 작업은 보존하며, 덱이 있으면 되돌아가기 제공.
  function goHome() {
    $('#empty').classList.remove('hide');
    $('#backToDeck').style.display = deck ? 'inline-flex' : 'none';
    document.body.classList.remove('collapsed');
    selectTab('input');
  }
  $('#homeBtn').addEventListener('click', goHome);
  $('#backToDeck').addEventListener('click', function () {
    if (deck) $('#empty').classList.add('hide');
  });

  /* ---------------- generation ---------------- */
  function generate() {
    var md = $('#md').value.trim();
    if (!md) { openPanel('input'); toast('마크다운을 입력하세요'); return; }
    busy(true, '교안을 분석하고 슬라이드를 만드는 중…');
    setTimeout(function () {
      try {
        var doc = LectureParser.parse(md);
        state.specs = DeckInfer.infer(doc);
        buildDeck();
        autoMatchUploads();
        applyImages();
        renderSlideList();
        renderImageGrid();
        renderPool();
        $('#empty').classList.add('hide');
        document.body.classList.remove('collapsed');
        selectTab('slides');
        toast(state.specs.length + '개 슬라이드를 만들었습니다');
      } catch (err) {
        console.error(err); toast('오류: ' + err.message);
      }
      busy(false);
    }, 30);
  }

  function labelFor(spec, i) {
    var names = {
      'intro-slide': 'Intro', 'part-divider': 'Part', 'section-divider': 'Section',
      'closing-slide': 'Closing', 'three-cards': 'Cards', 'two-cards': 'Compare',
      'check-box': 'Checklist', 'split-text-image': 'Text+Image', 'case-study': 'Case',
      'case-two-image': 'Case 2img', 'quote-slide': 'Quote', 'ref-games': 'Refs',
      'deck-table': 'Table', 'bullet-list': 'Bullets', 'agenda': 'Overview'
    };
    var raw = (spec.title || names[spec.pattern] || 'Slide').replace(/<[^>]+>/g, '');
    return String(i + 1).padStart(2, '0') + ' ' + DeckPatterns.clip(raw, 22);
  }

  function makeSection(spec, i) {
    var out = DeckPatterns.render(spec);
    var sec = document.createElement('section');
    sec.className = 'slide ' + (out.cls || '');
    sec.setAttribute('data-label', labelFor(spec, i));
    sec.setAttribute('data-pat', spec.pattern);
    sec.innerHTML = out.html;
    specByEl.set(sec, spec);
    return sec;
  }

  function buildDeck() {
    var stage = $('#stage');
    if (deck) deck.remove();
    deck = document.createElement('deck-stage');
    deck.setAttribute('width', '1920');
    deck.setAttribute('height', '1080');
    state.specs.forEach(function (spec, i) { deck.appendChild(makeSection(spec, i)); });
    stage.appendChild(deck);
    assignSlotIds();
    renumberFooters();
    deck.addEventListener('slidechange', function (e) {
      highlightSlide(e.detail.index);
      var s = e.detail.slide;
      if (s) { s.classList.add('play'); setTimeout(function () { s.classList.remove('play'); }, 720); }
    });
    // keep panel in sync when the thumbnail rail reorders / deletes / duplicates slides
    deck.addEventListener('deckchange', function () {
      assignSlotIds(); applyImages(); renumberFooters(); renderSlideList(); renderImageGrid();
    });
  }

  // running footer (brand + page number) on content slides (not bleed dividers/intro)
  function renumberFooters() {
    if (!deck) return;
    var secs = $$('section.slide', deck), total = secs.length;
    secs.forEach(function (sec, i) {
      var old = sec.querySelector(':scope > .slide-foot'); if (old) old.remove();
      if (!sec.classList.contains('bleed')) {
        var f = document.createElement('footer');
        f.className = 'slide-foot';
        f.innerHTML = '<span class="ft-page"><b>' + String(i + 1).padStart(2, '0') + '</b> / ' + String(total).padStart(2, '0') + '</span>';
        sec.appendChild(f);
      }
    });
  }

  // give every frame a stable id (use spec image id, else slot_N)
  function assignSlotIds() {
    var n = 0;
    $$('.frame', deck).forEach(function (fr) {
      var id = fr.getAttribute('data-img');
      if (!id) { id = 'slot_' + (n++); fr.setAttribute('data-img', id); }
    });
  }

  /* ---------------- images ---------------- */
  function baseName(name) { return name.replace(/\.[^.]+$/, '').toLowerCase(); }

  function autoMatchUploads() {
    if (!state.uploads.length) return;
    var frames = $$('.frame', deck);
    var usedUrls = {};
    // 1. filename ↔ image id match
    state.uploads.forEach(function (u) {
      var bn = baseName(u.name);
      frames.forEach(function (fr) {
        var id = (fr.getAttribute('data-img') || '').toLowerCase();
        if (!state.imgMap[fr.getAttribute('data-img')] && id && (id === bn || id.indexOf(bn) > -1 || bn.indexOf(id) > -1)) {
          state.imgMap[fr.getAttribute('data-img')] = u.url; usedUrls[u.url] = 1;
        }
      });
    });
    // 2. remaining uploads → fill empty frames in order
    var pool = state.uploads.filter(function (u) { return !usedUrls[u.url]; });
    var pi = 0;
    frames.forEach(function (fr) {
      var id = fr.getAttribute('data-img');
      if (!state.imgMap[id] && pi < pool.length) { state.imgMap[id] = pool[pi++].url; }
    });
  }

  function applyImages() {
    $$('.frame', deck).forEach(function (fr) {
      var id = fr.getAttribute('data-img');
      var url = state.imgMap[id];
      var existing = fr.querySelector('img');
      if (url) {
        var im = existing || new Image();
        // adopt the image's natural aspect ratio so it fits the frame with no cropping
        im.onload = function () {
          if (im.naturalWidth && im.naturalHeight) {
            fr.style.aspectRatio = im.naturalWidth + ' / ' + im.naturalHeight;
          }
        };
        im.src = url;
        if (!existing) fr.appendChild(im);
        else if (im.complete && im.naturalWidth) { fr.style.aspectRatio = im.naturalWidth + ' / ' + im.naturalHeight; }
        fr.setAttribute('data-has-img', '');
      } else {
        if (existing) existing.remove();
        fr.style.aspectRatio = '';        // restore the pattern's default ratio for the placeholder
        fr.removeAttribute('data-has-img');
      }
    });
  }

  // shared: ingest a list of files into the upload pool
  function addFiles(fileList, done) {
    var files = Array.prototype.slice.call(fileList).filter(function (f) { return /^image\//.test(f.type); });
    if (!files.length) { if (done) done(0); return; }
    var left = files.length;
    files.forEach(function (f) {
      var r = new FileReader();
      r.onload = function () {
        state.uploads.push({ name: f.name, url: r.result });
        if (--left === 0) {
          if (deck) { autoMatchUploads(); applyImages(); renderImageGrid(); }
          renderPool();
          toast(files.length + '장 첨부' + (deck ? ' · 자동 매칭 완료' : ' · 생성 시 자동 매칭'));
          if (done) done(files.length);
        }
      };
      r.readAsDataURL(f);
    });
  }

  // render the attached-image pool (input tab + images tab)
  function renderPool() {
    var html = state.uploads.map(function (u, i) {
      return '<div class="poolcell" data-i="' + i + '"><img src="' + u.url + '">' +
        '<button class="rm" title="제거">×</button>' +
        '<div class="nm">' + (u.name || ('img' + i)) + '</div></div>';
    }).join('');
    ['#poolGrid', '#poolGrid2'].forEach(function (sel) {
      var g = $(sel); if (!g) return; g.innerHTML = html;
      $$('.poolcell .rm', g).forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          removeUpload(+btn.parentNode.dataset.i);
        });
      });
    });
    var has = state.uploads.length > 0;
    if ($('#poolLabel2')) $('#poolLabel2').style.display = has ? 'block' : 'none';
  }
  function removeUpload(i) {
    var u = state.uploads[i]; if (!u) return;
    state.uploads.splice(i, 1);
    // clear any frame assignment pointing at this url
    Object.keys(state.imgMap).forEach(function (k) { if (state.imgMap[k] === u.url) delete state.imgMap[k]; });
    if (deck) { applyImages(); renderImageGrid(); }
    renderPool();
  }

  // drop zone (input tab)
  var dz = $('#dropZone');
  dz.addEventListener('click', function () { $('#upFile').click(); });
  dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', function () { dz.classList.remove('over'); });
  dz.addEventListener('drop', function (e) {
    e.preventDefault(); dz.classList.remove('over');
    if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  $('#upBtn').addEventListener('click', function () { $('#upFile').click(); });
  $('#upFile').addEventListener('change', function (e) {
    addFiles(e.target.files, function () { e.target.value = ''; });
  });

  // assign one image to a specific frame id
  var pendingSlot = null;
  $('#slotFile').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f || !pendingSlot) return;
    var r = new FileReader();
    r.onload = function () {
      state.imgMap[pendingSlot] = r.result;
      state.uploads.push({ name: f.name, url: r.result });
      applyImages(); renderImageGrid(); renderPool();
      e.target.value = '';
    };
    r.readAsDataURL(f);
  });
  function pickForSlot(id) { pendingSlot = id; $('#slotFile').click(); }

  function renderImageGrid() {
    var grid = $('#imgGrid'); grid.innerHTML = '';
    var frames = deck ? $$('.frame', deck) : [];
    $('#imgEmpty').style.display = frames.length ? 'none' : 'block';
    if ($('#slotLabel')) $('#slotLabel').style.display = frames.length ? 'block' : 'none';
    frames.forEach(function (fr) {
      var id = fr.getAttribute('data-img');
      var url = state.imgMap[id];
      var ph = (fr.querySelector('.ph') ? fr.querySelector('.ph').textContent : id);
      var cell = document.createElement('div');
      cell.className = 'imgcell' + (url ? ' assigned' : '');
      cell.innerHTML = '<div class="thumb">' + (url ? '<img src="' + url + '">' : '+ 지정') + '</div>' +
        '<div class="lab">' + (id || '') + '</div>';
      cell.addEventListener('click', function () { pickForSlot(id); });
      grid.appendChild(cell);
    });
  }

  /* ---------------- slide list + pattern override ---------------- */
  function renderSlideList() {
    var list = $('#slideList'); list.innerHTML = '';
    $('#slidesEmpty').style.display = state.specs.length ? 'none' : 'block';
    var secs = deck ? $$('section.slide', deck) : [];
    secs.forEach(function (sec, i) {
      var spec = specByEl.get(sec);
      var row = document.createElement('div');
      row.className = 'srow'; row.dataset.idx = i;
      var opts = DeckPatterns.PATTERN_LIST.map(function (p) {
        return '<option value="' + p[0] + '"' + (p[0] === spec.pattern ? ' selected' : '') + '>' + p[1] + '</option>';
      }).join('');
      row.innerHTML = '<span class="no">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="nm">' + DeckPatterns.clip((spec.title || spec.pattern).replace(/<[^>]+>/g, ''), 26) + '</span>' +
        '<select>' + opts + '</select>';
      row.querySelector('.nm').addEventListener('click', function () { if (deck) deck.goTo(i); });
      row.querySelector('.no').addEventListener('click', function () { if (deck) deck.goTo(i); });
      var sel = row.querySelector('select');
      sel.addEventListener('click', function (e) { e.stopPropagation(); });
      sel.addEventListener('change', function () { changePattern(sec, sel.value); });
      list.appendChild(row);
    });
  }
  function highlightSlide(idx) {
    $$('#slideList .srow').forEach(function (r) { r.classList.toggle('cur', +r.dataset.idx === idx); });
  }

  function changePattern(sec, pat) {
    var spec = specByEl.get(sec);
    spec = Object.assign({}, spec, { pattern: pat });
    coerceSpec(spec, pat);
    specByEl.set(sec, spec);
    var out = DeckPatterns.render(spec);
    sec.className = 'slide ' + (out.cls || '');
    sec.setAttribute('data-pat', pat);
    sec.innerHTML = out.html;
    assignSlotIds();
    applyImages();
    renumberFooters();
    renderImageGrid();
    toast('패턴 변경: ' + pat);
  }

  // adapt fields when switching pattern so the new renderer has data
  function coerceSpec(spec, pat) {
    var textPool = [];
    if (spec.paras) textPool = textPool.concat(spec.paras);
    if (spec.body) textPool = textPool.concat(spec.body);
    if (spec.cards) spec.cards.forEach(function (c) { textPool.push((c.title || '') + (c.desc ? ' — ' + c.desc : '')); });
    if (spec.items) spec.items.forEach(function (it) { textPool.push((it.label ? it.label + ' — ' : '') + (it.desc || '')); });
    var asCards = function (n) {
      var src = spec.cards || (spec.items || []).map(function (it) { return { title: it.label || it.desc, desc: it.label ? it.desc : '' }; });
      if (!src.length) src = textPool.map(function (t) { return { title: DeckPatterns.clip(t, 40), desc: '' }; });
      return src.slice(0, n);
    };
    var asItems = function () {
      if (spec.items) return spec.items;
      if (spec.cards) return spec.cards.map(function (c) { return { label: c.title, desc: c.desc }; });
      return textPool.map(function (t) { return { label: '', desc: DeckPatterns.clip(t, 120) }; });
    };
    switch (pat) {
      case 'three-cards': spec.cards = asCards(3); break;
      case 'two-cards': spec.cards = asCards(2); break;
      case 'ref-games': spec.cards = asCards(4).map(function (c) { return { title: c.title, tags: [] }; }); break;
      case 'check-box': spec.items = asItems().slice(0, 8); break;
      case 'agenda': spec.items = asItems().slice(0, 10); break;
      case 'bullet-list': spec.items = asItems().slice(0, 5); break;
      case 'split-text-image': spec.paras = (textPool.length ? textPool : [spec.title || '']).slice(0, 3); break;
      case 'case-study': spec.body = (textPool.length ? textPool : [spec.title || '']).slice(0, 2); break;
      case 'case-two-image': spec.cols = asCards(2).map(function (c) { return { title: c.title, desc: c.desc }; }); break;
      case 'deck-table': {
        var rowsSrc = [];
        if (spec.items && spec.items.length) rowsSrc = spec.items.map(function (it) { return [it.label || '—', it.desc || '']; });
        else if (spec.cards && spec.cards.length) rowsSrc = spec.cards.map(function (c) { return [c.title || '—', c.desc || '']; });
        else if (textPool.length) rowsSrc = textPool.map(function (t) { var p = t.split(/\s*[—:]\s*/); return p.length > 1 ? [p[0], p.slice(1).join(' ')] : ['—', t]; });
        if (!rowsSrc.length) rowsSrc = [['항목', '내용']];
        spec.headers = ['항목', '설명'];
        spec.rows = rowsSrc.slice(0, 7);
        break;
      }
      case 'intro-slide': case 'part-divider': case 'quote-slide':
        spec.lead = spec.lead || textPool[0] || ''; spec.sub = spec.sub || textPool[0] || ''; break;
      case 'section-divider': case 'closing-slide':
        spec.desc = spec.desc || textPool[0] || ''; break;
    }
  }

  /* ---------------- editing ---------------- */
  var editing = false;
  $('#editToggle').addEventListener('click', function () {
    editing = !editing;
    document.body.classList.toggle('editing', editing);
    $('#editToggle').classList.toggle('on', editing);
    $$('.slide [data-edit]', deck || document).forEach(function (el) {
      el.setAttribute('contenteditable', editing ? 'true' : 'false');
    });
    toast(editing ? '편집 모드 · 텍스트 클릭, 이미지 클릭 교체' : '편집 종료');
  });
  // image frame click → replace (only in edit mode)
  document.addEventListener('click', function (e) {
    if (!editing) return;
    var fr = e.target.closest && e.target.closest('.frame');
    if (fr && deck && deck.contains(fr)) { pickForSlot(fr.getAttribute('data-img')); }
  });
  // drag-drop image onto a frame
  document.addEventListener('dragover', function (e) {
    if (e.target.closest && e.target.closest('.frame')) e.preventDefault();
  });
  document.addEventListener('drop', function (e) {
    var fr = e.target.closest && e.target.closest('.frame');
    if (!fr || !deck || !deck.contains(fr)) return;
    e.preventDefault();
    var f = e.dataTransfer.files[0]; if (!f || !/^image\//.test(f.type)) return;
    var r = new FileReader();
    r.onload = function () {
      state.imgMap[fr.getAttribute('data-img')] = r.result;
      state.uploads.push({ name: f.name, url: r.result });
      applyImages(); renderImageGrid();
    };
    r.readAsDataURL(f);
  });

  /* ---------------- exports ---------------- */
  function cleanDeckClone() {
    var clone = deck.cloneNode(true);
    $$('[contenteditable]', clone).forEach(function (el) { el.removeAttribute('contenteditable'); });
    $$('[data-deck-active]', clone).forEach(function (el) { el.removeAttribute('data-deck-active'); });
    return clone;
  }

  async function fetchText(p) { var r = await fetch(p); return await r.text(); }

  async function exportHTML() {
    busy(true, 'HTML 파일을 만드는 중…');
    try {
      var css = await fetchText('slide-system.css');
      var js = await fetchText('deck-stage.js');
      var clone = cleanDeckClone();
      clone.removeAttribute('data-fonts-pending');
      var title = (state.specs[0] && state.specs[0].title || '강의 슬라이드').replace(/<[^>]+>/g, '');
      // escape any sequence that would prematurely close the inline <style>/<script>
      var safeCss = css.replace(/<\/(style)/gi, '<\\/$1');
      var safeJs = js.replace(/<\/(script)/gi, '<\\/$1');
      var html = '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>' + title + '</title>' +
        '<style>deck-stage:not(:defined){visibility:hidden}html,body{margin:0;background:#060e1f}</style>' +
        '<style>' + safeCss + '</style></head><body>' +
        clone.outerHTML +
        '<scr' + 'ipt>' + safeJs + '</scr' + 'ipt></body></html>';
      var blob = new Blob([html], { type: 'text/html' });
      downloadBlob(blob, sanitize(title) + '.html');
      toast('HTML 다운로드 완료');
    } catch (err) { console.error(err); toast('HTML 내보내기 실패'); }
    busy(false);
  }

  function exportPDF() {
    toast('인쇄 창에서 “PDF로 저장”을 선택하세요');
    setTimeout(function () { window.print(); }, 350);
  }

  async function exportPPTX() {
    if (typeof PptxGenJS === 'undefined' || !window.DeckPptx) { toast('PPTX 모듈 로드 실패'); return; }
    var title = (state.specs[0] && state.specs[0].title || '강의 슬라이드').replace(/<[^>]+>/g, '');
    busy(true, 'PPTX 생성 중…');
    var done = false;
    var watchdog = setTimeout(function () {
      if (!done) { busy(false); toast('PPTX 생성이 지연됩니다. HTML/PDF 내보내기를 이용하거나 다시 시도하세요.'); }
    }, 90000);
    try {
      var size = await DeckPptx.export(deck, sanitize(title) + '.pptx', function (d, t) {
        $('#busyLbl').textContent = 'PPTX 생성 중… ' + d + '/' + t + ' 슬라이드';
      });
      done = true; clearTimeout(watchdog);
      toast('PPTX 추출 완료 · PowerPoint에서 편집 가능');
    } catch (err) { done = true; clearTimeout(watchdog); console.error(err); toast('PPTX 추출 실패: ' + err.message); }
    busy(false);
  }

  function sanitize(s) { return (s || 'deck').replace(/[^\w가-힣\- ]/g, '').trim().slice(0, 40) || 'deck'; }
  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------------- sample ---------------- */
  var SAMPLE = [
    '# 게임 기획의 이해와 역할',
    '',
    '게임 기획은 단순한 아이디어 구상을 넘어, 게임이 어떻게 플레이되고 어떤 재미를 주는지 설계하는 복합적인 작업입니다. 이 강의는 게임 기획자의 역할과 게임의 본질적 요소를 다룹니다.',
    '',
    '## 💡 학습 목표',
    '*   게임 기획의 정의와 중요성을 설명할 수 있습니다.',
    '*   게임 기획자의 핵심 역량을 이해할 수 있습니다.',
    '*   게임을 구성하는 기본 요소들을 식별할 수 있습니다.',
    '*   MDA 프레임워크로 재미 요소를 분석할 수 있습니다.',
    '*   코어 루프 개념을 이해할 수 있습니다.',
    '',
    '---',
    '',
    '## 1. 게임 기획, 그 시작과 본질 (⏱ 60분)',
    '',
    '게임 기획이라는 직업의 정의를 명확히 하고, 왜 게임 개발에서 기획이 필수적인지 탐구합니다.',
    '',
    '### 1.1. 게임 기획의 정의와 범위',
    '',
    '게임 기획은 플레이어가 경험할 게임의 모든 요소를 설계하고 구체화하는 작업입니다. 단순한 아이디어로 끝나지 않고 목표, 규칙, 스토리, 시스템까지 청사진을 그리는 과정입니다.',
    '',
    '#### Key Concept',
    '*   **게임 기획(Game Design)** 플레이어가 경험할 게임의 모든 요소를 설계하고 구체화하는 과정.',
    '*   **청사진(Blueprint)** 게임 개발의 전체 방향과 세부 계획을 담은 문서 또는 구상.',
    '*   **플레이어 경험(PX)** 게임을 플레이하며 느끼는 총체적인 감정과 행동. 기획의 핵심 목표.',
    '',
    '#### 구체적 사례',
    '*   **리그 오브 레전드** 각 챔피언의 스킬과 아이템 상호작용, 맵 오브젝트까지 치밀하게 기획되어 전략적 플레이를 유도합니다.',
    '*   **젤다의 전설: 야생의 숨결** 오픈월드 환경과 물리 엔진 퍼즐이 유기적으로 연결되어 끝없는 탐험의 동기를 부여하도록 기획되었습니다.',
    '',
    '#### 본문 설명',
    '게임 기획은 매우 광범위한 영역을 포괄합니다. 초기 아이디어 단계에서 핵심 컨셉을 정립하고, 구체적인 시스템과 콘텐츠를 설계합니다.',
    '또한 게임 기획은 지속적인 수정과 개선의 연속입니다. 개발 과정에서 예상치 못한 문제를 만나면 유연하게 사고하고 최적의 해답을 찾아야 합니다.',
    '',
    '### 1.2. 게임 기획이 필요한 이유',
    '',
    '재미는 주관적이고 추상적인 개념입니다. 이를 구체적인 시스템으로 구현하려면 체계적인 기획 과정이 필수적입니다.',
    '',
    '#### Key Concept',
    '*   **비전 공유** 개발팀 전체가 게임의 목표와 핵심 가치를 공유하는 과정.',
    '*   **자원 효율성** 개발 시간·인력·비용을 효율적으로 배분하고 낭비를 줄이는 것.',
    '',
    '---',
    '',
    '## 2. 재미란 무엇인가 (⏱ 70분)',
    '',
    '게임 기획의 궁극적 목표는 재미 창출입니다. 다양한 재미의 유형과 이를 분석하는 프레임워크를 소개합니다.',
    '',
    '### 2.1. MDA 프레임워크',
    '',
    'MDA는 게임을 메커니즘·다이내믹스·에스테틱스 세 관점에서 분석하는 도구입니다.',
    '',
    '#### Key Concept',
    '*   **메커니즘(Mechanics)** 게임의 기본 규칙·시스템·데이터. 가장 낮은 수준의 요소.',
    '*   **다이내믹스(Dynamics)** 메커니즘이 상호작용하며 발생하는 게임 플레이의 흐름.',
    '*   **에스테틱스(Aesthetics)** 플레이어가 경험하는 감각적·감성적 즐거움. 재미의 최종 결과물.'
  ].join('\n');

  window.__deckState = state; // debug
})();
