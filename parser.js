/* ============================================================
   parser.js — Teacher-에이전트 마크다운 → 구조화 문서 모델
   Handles the Teacher dialect:
     # Title + intro
     ## (empty) + 💡 학습 목표 ...           → objectives
     ## N. 제목 (⏱ NN분)                      → section
     ### N.N. 제목                            → subsection
     #### Key Concept / 구체적 사례 / 본문 설명 → blocks
     <div class="image-wrapper"><img src="local:img_XXX"> → image refs
     <div class="instructor-callout"> ...      → instructor notes (speaker notes)
     ```mermaid ... ```                        → diagram blocks
   Falls back gracefully for plain markdown.
   ============================================================ */
(function (global) {
  'use strict';

  // inline markdown → safe HTML (bold, code, em). Escapes everything else.
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function inline(s) {
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '<em>$1</em>');
    return s;
  }

  // split a bullet line "**term** description" → {label, desc}
  function splitTermDesc(raw) {
    var m = raw.match(/^\s*\*\*([^*]+)\*\*[\s:·\-—]*(.*)$/);
    if (m) return { label: m[1].trim(), desc: m[2].trim() };
    // "label : desc" colon pattern
    var c = raw.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
    if (c) return { label: c[1].trim(), desc: c[2].trim() };
    return { label: '', desc: raw.trim() };
  }

  function parse(md) {
    md = (md || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    var images = [];   // ordered image refs {id, alt}
    var callouts = [];
    var codes = [];

    // 1. fenced code blocks
    md = md.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, body) {
      codes.push({ lang: lang || '', body: body });
      return '\n@@CODE' + (codes.length - 1) + '@@\n';
    });
    // 2. instructor-callout divs
    md = md.replace(/<div class="instructor-callout">([\s\S]*?)<\/div>/g, function (_, body) {
      callouts.push(body.trim());
      return '\n@@CALLOUT' + (callouts.length - 1) + '@@\n';
    });
    // 3. image-wrapper divs (contain a nested .image-caption div) → grab img id/alt.
    //    Consume BOTH the inner caption </div> and the outer wrapper </div> so no stray tag leaks.
    function takeImg(block) {
      var im = block.match(/<img[^>]*src="(?:local:)?([^"]+)"/);
      var id = im ? im[1] : ('img_' + images.length);
      var altM = block.match(/alt="([^"]*)"/);
      images.push({ id: id, alt: altM ? altM[1] : '' });
      return '\n@@IMG:' + id + '@@\n';
    }
    // nested form: ...<div class="image-caption">…</div></div>
    md = md.replace(/<div class="image-wrapper">[\s\S]*?<\/div>\s*<\/div>/g, takeImg);
    // fallback: any remaining single-close image-wrapper
    md = md.replace(/<div class="image-wrapper">[\s\S]*?<\/div>/g, takeImg);
    // 4. standard markdown images
    md = md.replace(/!\[([^\]]*)\]\((?:local:)?([^)]+)\)/g, function (_, alt, src) {
      images.push({ id: src, alt: alt });
      return '\n@@IMG:' + src + '@@\n';
    });
    // 5. strip any remaining raw HTML so no tags ever render as text
    md = md.replace(/<button[\s\S]*?<\/button>/gi, '');
    md = md.replace(/<\/?(?:div|span|p|figure|figcaption|section|article)\b[^>]*>/gi, '');
    md = md.replace(/<img[^>]*>/gi, '');
    md = md.replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, function (m) {
      // keep inline emphasis tags, drop everything else
      return /^<\/?(?:b|strong|i|em|code|u|mark|sub|sup|br)\b/i.test(m) ? m : '';
    });

    var lines = md.split('\n');
    var doc = { title: '', intro: [], objectives: [], sections: [], images: images };

    var i = 0, n = lines.length;
    var curSection = null, curSub = null, curBlock = null;
    var pendingImg = null;            // image awaiting attachment

    function flushImg(target) {
      if (pendingImg && target && !target.image) { target.image = pendingImg; }
      pendingImg = null;
    }
    function newSection(num, title) {
      curSection = { number: num, title: title, duration: '', intro: [], image: null, subs: [], callout: null };
      doc.sections.push(curSection);
      curSub = null; curBlock = null;
    }
    function newSub(num, title) {
      curSub = { number: num, title: title, image: null, blocks: [], callout: null, mermaid: null };
      curSection.subs.push(curSub);
      curBlock = null;
    }

    while (i < n) {
      var line = lines[i];
      var t = line.trim();
      i++;
      if (t === '' || t === '---') { continue; }   // blank/HR: keep current block open (headings end blocks)

      // image marker
      var imM = t.match(/^@@IMG:(.+)@@$/);
      if (imM) {
        pendingImg = imM[1];
        flushImg(curSub || curSection || doc);
        continue;
      }
      // callout marker
      var coM = t.match(/^@@CALLOUT(\d+)@@$/);
      if (coM) {
        var co = callouts[+coM[1]];
        if (curSub) curSub.callout = co;
        else if (curSection) curSection.callout = co;
        continue;
      }
      // code marker (mermaid etc.)
      var cdM = t.match(/^@@CODE(\d+)@@$/);
      if (cdM) {
        var cd = codes[+cdM[1]];
        if (curSub) curSub.mermaid = cd;
        continue;
      }

      // headings
      var h = t.match(/^(#{1,6})\s*(.*)$/);
      if (h) {
        var level = h[1].length;
        var txt = h[2].trim();
        // empty heading → adopt next non-empty line as its text
        if (txt === '') {
          while (i < n && lines[i].trim() === '') i++;
          if (i < n) { txt = lines[i].trim().replace(/^#+\s*/, ''); i++; }
        }
        if (level === 1) {
          doc.title = txt.replace(/[*#]/g, '').trim();
          continue;
        }
        // objectives section (학습 목표)
        if (/학습\s*목표|learning objective/i.test(txt)) {
          curSection = null; curSub = null; curBlock = 'objectives';
          continue;
        }
        if (level === 2) {
          var sm = txt.match(/^(\d+)[.\)]\s*(.*)$/);
          var num = sm ? sm[1] : '';
          var title = (sm ? sm[2] : txt);
          // clean trailing "(⏱" / duration fragments
          var dur = '';
          var dm = txt.match(/(\d+\s*분)/);
          if (dm) dur = dm[1].replace(/\s+/g, '');
          title = title.replace(/\s*\(?\s*⏱[\s\S]*$/u, '').replace(/[（(]\s*$/, '').trim();
          title = title.replace(/[*#]/g, '').trim();
          newSection(num, title);
          curSection.duration = dur;
          continue;
        }
        if (level === 3) {
          if (!curSection) newSection('', '');
          var ssm = txt.match(/^(\d+\.\d+)[.\)]?\s*(.*)$/);
          newSub(ssm ? ssm[1] : '', (ssm ? ssm[2] : txt).replace(/[*#]/g, '').trim());
          continue;
        }
        if (level >= 4) {
          // block type within subsection
          var bt = txt.toLowerCase();
          var kind = 'body';
          if (/key concept|핵심\s*개념/.test(bt)) kind = 'concepts';
          else if (/구체적\s*사례|사례|example|case/.test(bt)) kind = 'examples';
          else if (/본문|설명|상세/.test(bt)) kind = 'body';
          else kind = 'body';
          if (!curSub) { if (!curSection) newSection('', ''); newSub('', curSection.title); }
          curBlock = { type: kind, title: txt, items: [], paras: [] };
          curSub.blocks.push(curBlock);
          continue;
        }
      }

      // bullet item
      var bul = t.match(/^[\*\-•]\s+(.*)$/);
      if (bul) {
        var item = splitTermDesc(bul[1]);
        if (curBlock === 'objectives') { doc.objectives.push(item.desc || bul[1].trim()); continue; }
        if (curBlock && typeof curBlock === 'object') { curBlock.items.push(item); continue; }
        // bullet w/o block → attach to section intro as item-ish
        if (curSub) { curSub.blocks.push({ type: 'body', title: '', items: [item], paras: [] }); }
        continue;
      }
      // sub-bullet (indented) — append to last item desc
      var sub = line.match(/^\s{2,}[\*\-•]\s+(.*)$/);
      if (sub && curBlock && typeof curBlock === 'object' && curBlock.items.length) {
        var last = curBlock.items[curBlock.items.length - 1];
        last.desc += (last.desc ? ' · ' : '') + sub[1].trim();
        continue;
      }

      // plain paragraph line
      var para = t.replace(/^@@\w+\d*@@$/, '').trim();
      if (!para) continue;
      // stray duration fragment (e.g. "️ 60분)") split off a "(⏱ 60분)" heading → capture as duration
      if (!curBlock || typeof curBlock !== 'object') {
        var dmF = para.match(/(\d+)\s*분/);
        if (dmF && para.replace(/[\s\d분()⏱⏰\u200d\ufe0f\uff08\uff09]/gu, '').length === 0) {
          if (curSection && !curSection.duration) curSection.duration = dmF[1] + '분';
          continue;
        }
      }
      if (curBlock === 'objectives') { /* stray */ continue; }
      if (curBlock && typeof curBlock === 'object') {
        if (curBlock.items.length) {
          // continuation of last item
          curBlock.items[curBlock.items.length - 1].desc += ' ' + para;
        } else {
          curBlock.paras.push(para);
        }
      } else if (curSub) {
        // subsection intro paragraph
        if (!curSub._intro) curSub._intro = [];
        curSub._intro.push(para);
      } else if (curSection) {
        curSection.intro.push(para);
      } else {
        doc.intro.push(para);
      }
    }

    return doc;
  }

  global.LectureParser = { parse: parse, inline: inline, esc: esc };
})(window);
