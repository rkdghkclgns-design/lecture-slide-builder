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
    uploads: [],          // {name, url}
    mdDocs: []            // ordered {name, text} markdown files → concatenated in list order
  };
  var deck = null;
  var specByEl = new WeakMap();

  /* ---------------- 테마(KDT / MSW) + 브랜드 로고 ----------------
     KDT = 현재 베이지+주황, MSW = 메이플스토리 월드 코딩 교실 스킨.
     html[data-theme]로 CSS 스킨을 전환하고, 테마별 로고를 우측 상단에 적용한다.
     로고는 교체 가능한 에셋: assets/msw-logo.png(KDT) · assets/logo-worlds.png(MSW).
     (CSS .slide::before 가 --deck-logo 사용 · PPTX/HTML export는 window.DECK_LOGO 사용) */
  var LOGOS = { kdt: '', msw: '' };
  function curTheme() {
    try { return localStorage.getItem('deck.theme') === 'msw' ? 'msw' : 'kdt'; } catch (e) { return 'kdt'; }
  }
  function refreshLogo() {
    var url = (state.theme === 'msw' ? LOGOS.msw : LOGOS.kdt) || LOGOS.kdt || LOGOS.msw || '';
    window.DECK_LOGO = url;
    document.documentElement.style.setProperty('--deck-logo', url ? 'url("' + url + '")' : 'none');
  }
  function applyTheme(t) {
    state.theme = (t === 'msw') ? 'msw' : 'kdt';
    try { localStorage.setItem('deck.theme', state.theme); } catch (e) {}
    document.documentElement.setAttribute('data-theme', state.theme);
    $$('#themeSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.theme === state.theme); });
    refreshLogo();
  }
  function blobToDataUrl(b) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result)); };
      fr.onerror = function () { rej(fr.error || new Error('read error')); };
      fr.readAsDataURL(b);
    });
  }
  function loadLogo(key, path) {
    fetch(path).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then(blobToDataUrl).then(function (u) { LOGOS[key] = u; refreshLogo(); })
      .catch(function () { /* file:// 또는 에셋 없음 → 해당 테마 로고 생략 */ });
  }
  state.theme = curTheme();
  applyTheme(state.theme);
  loadLogo('kdt', 'assets/msw-logo.png');
  loadLogo('msw', 'assets/logo-worlds.png');
  $$('#themeSeg button').forEach(function (b) {
    b.addEventListener('click', function () { applyTheme(b.dataset.theme); });
  });

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

  /* ---------------- input: markdown files (multiple · ordered) ---------------- */
  // Escape user filenames before injecting into the list markup.
  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function readText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(r.error || new Error('read error')); };
      r.readAsText(file);
    });
  }
  // concatenate loaded docs in list order (trailing-trimmed, blank-line joined)
  function joinMdDocs() {
    return state.mdDocs
      .map(function (d) { return (d.text || '').replace(/\s+$/, ''); })
      .filter(function (t) { return t.length; })
      .join('\n\n');
  }
  function syncMdTextarea() {
    if (state.mdDocs.length) $('#md').value = joinMdDocs();
  }
  function renderMdList() {
    var list = $('#mdList'); if (!list) return;
    var has = state.mdDocs.length > 0;
    if ($('#mdListLabel')) $('#mdListLabel').style.display = has ? 'block' : 'none';
    list.innerHTML = state.mdDocs.map(function (d, i) {
      var nm = escAttr(d.name || ('md' + (i + 1)));
      return '<div class="mdrow" data-i="' + i + '">' +
        '<span class="no">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="nm" title="' + nm + '">' + nm + '</span>' +
        '<span class="mv">' +
          '<button class="ic up" title="위로" aria-label="위로">▲</button>' +
          '<button class="ic dn" title="아래로" aria-label="아래로">▼</button>' +
          '<button class="ic rm" title="제거" aria-label="제거">×</button>' +
        '</span></div>';
    }).join('');
    $$('.mdrow', list).forEach(function (row) {
      var i = +row.dataset.i;
      $('.up', row).addEventListener('click', function () { moveMdDoc(i, i - 1); });
      $('.dn', row).addEventListener('click', function () { moveMdDoc(i, i + 1); });
      $('.rm', row).addEventListener('click', function () { removeMdDoc(i); });
    });
  }
  function moveMdDoc(from, to) {
    if (to < 0 || to >= state.mdDocs.length || from === to) return;
    var arr = state.mdDocs.slice();
    arr.splice(to, 0, arr.splice(from, 1)[0]);
    state.mdDocs = arr;
    syncMdTextarea(); renderMdList();
  }
  function removeMdDoc(i) {
    state.mdDocs = state.mdDocs.slice(0, i).concat(state.mdDocs.slice(i + 1));
    syncMdTextarea(); renderMdList();
  }
  function addMdFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    // read all in parallel; Promise.all preserves the FileList order regardless
    // of which read resolves first, so concatenation stays deterministic.
    Promise.all(files.map(readText)).then(function (texts) {
      var newDocs = files.map(function (f, k) { return { name: f.name, text: texts[k] }; });
      state.mdDocs = state.mdDocs.concat(newDocs);   // immutable append (consistent with move/remove)
      syncMdTextarea(); renderMdList();
      toast(files.length + '개 MD 불러옴 · 순서대로 연결 (총 ' + state.mdDocs.length + '개)');
    }).catch(function (err) {
      console.error(err); toast('MD 불러오기 실패: ' + err.message);
    });
  }
  $('#mdFile').addEventListener('change', function (e) {
    addMdFiles(e.target.files);
    e.target.value = '';   // reset so the same file(s) can be re-picked; order stays explicit
  });
  $('#loadMd').addEventListener('click', function () { $('#mdFile').click(); });
  $('#sampleBtn').addEventListener('click', function () {
    state.mdDocs = []; renderMdList();          // sample replaces the textarea wholesale
    $('#md').value = SAMPLE; toast('예제를 채웠습니다');
  });
  // Hand-editing the combined textarea switches to free-form mode: the per-file
  // MD list stops driving the textarea, so a later reorder/remove can never
  // silently clobber manual edits. Programmatic value sets don't fire 'input'.
  $('#md').addEventListener('input', function () {
    if (state.mdDocs.length) { state.mdDocs = []; renderMdList(); }
  });
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
    // deck-stage's :host is position:fixed, so it paints over the absolutely-
    // positioned landing overlay. Hide it declaratively via `body.landing`
    // (CSS visibility) — keeps layout/measurement intact (no resize re-fit),
    // leaves the element's inline style clean (so exports clone it visible),
    // and matches the existing body.collapsed / body.editing idiom.
    document.body.classList.add('landing');
    selectTab('input');
  }
  $('#homeBtn').addEventListener('click', goHome);
  $('#backToDeck').addEventListener('click', function () {
    if (!deck) return;
    document.body.classList.remove('landing');
    $('#empty').classList.add('hide');
  });

  /* ---------------- generation ---------------- */
  function generate() {
    var md = $('#md').value.trim();
    if (!md) { openPanel('input'); toast('마크다운을 입력하세요'); return; }
    busy(true, '교안을 분석하고 슬라이드를 만드는 중…');
    setTimeout(function () {
      try {
        // 교수안 + 슬라이드 편성안이 함께 들어오면 "편성안 모드"로 합성한다.
        // (구조·순서·문구 = 편성안, 표 등 상세 내용 = 교수안)
        var sources = state.mdDocs.length ? state.mdDocs : [{ name: '', text: md }];
        var pair = window.DeckCompose ? DeckCompose.detect(sources) : null;
        if (pair) {
          state.specs = DeckCompose.compose(pair.lesson, pair.plan);
        } else {
          var doc = LectureParser.parse(md);
          state.specs = DeckInfer.infer(doc);
        }
        buildDeck();
        autoMatchUploads();
        applyImages();
        renderSlideList();
        renderImageGrid();
        renderPool();
        $('#empty').classList.add('hide');
        document.body.classList.remove('collapsed');
        document.body.classList.remove('landing');
        selectTab('slides');
        toast(state.specs.length + '개 슬라이드를 만들었습니다' + (pair ? ' · 교수안+편성안 모드' : ''));
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
      return '<div class="poolcell" data-i="' + i + '"><img src="' + escAttr(u.url) + '">' +
        '<button class="rm" title="제거">×</button>' +
        '<div class="nm">' + escAttr(u.name || ('img' + i)) + '</div></div>';
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
      cell.innerHTML = '<div class="thumb">' + (url ? '<img src="' + escAttr(url) + '">' : '+ 지정') + '</div>' +
        '<div class="lab">' + escAttr(id || '') + '</div>';
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
        '<span class="nm">' + escAttr(DeckPatterns.clip((spec.title || spec.pattern).replace(/<[^>]+>/g, ''), 26)) + '</span>' +
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
      var html = '<!DOCTYPE html><html lang="ko" data-theme="' + (state.theme || 'kdt') + '"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>' + escAttr(title) + '</title>' +
        '<style>deck-stage:not(:defined){visibility:hidden}html,body{margin:0;background:#4A3526}' +
          (window.DECK_LOGO ? ':root{--deck-logo:url("' + window.DECK_LOGO + '")}' : '') + '</style>' +
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
