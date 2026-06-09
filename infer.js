/* ============================================================
   infer.js — 문서 모델 → 슬라이드 스펙 배열 (패턴 자동 추론)
   Rules follow the manual's "패턴 → 사용 시점" mapping:
     · 3 items  → three-cards
     · 2 items  → two-cards
     · 4–6 items → check-box
     · 단일 사례 → case-study,  2 사례 → two-cards
     · 본문 단락 + 이미지 → split-text-image
   ============================================================ */
(function (global) {
  'use strict';
  var clip = global.DeckPatterns.clip;

  function romanless(n) { return n ? String(n).padStart(2, '0') : ''; }

  function cardsFromItems(items, max) {
    return items.slice(0, max).map(function (it, i) {
      return { icon: null, title: clip(it.label || it.desc, 48), desc: it.label ? clip(it.desc, 150) : '' };
    });
  }

  function conceptSlides(sub, sectionTitle, push) {
    var blocks = sub.blocks || [];
    blocks.forEach(function (b) {
      if (b.type === 'concepts' && b.items.length) {
        var items = b.items;
        var base = { eyebrow: 'KEY CONCEPT', title: sub.title || sectionTitle };
        if (items.length === 3) {
          push(Object.assign({ pattern: 'three-cards', cards: cardsFromItems(items, 3) }, base));
        } else if (items.length === 2) {
          push(Object.assign({ pattern: 'two-cards', cards: cardsFromItems(items, 2) }, base));
        } else {
          // 4–6 per check-box; split larger
          for (var k = 0; k < items.length; k += 6) {
            var chunk = items.slice(k, k + 6);
            push(Object.assign({ pattern: 'check-box',
              items: chunk.map(function (it) { return { label: clip(it.label, 40), desc: clip(it.desc, 120) }; })
            }, { eyebrow: 'KEY CONCEPT', title: sub.title || sectionTitle }));
          }
        }
      }
    });
  }

  function exampleSlides(sub, sectionTitle, push) {
    (sub.blocks || []).forEach(function (b) {
      if (b.type === 'examples' && b.items.length) {
        var items = b.items;
        if (items.length === 1) {
          var it = items[0];
          push({ pattern: 'case-study', title: clip(it.label, 40) || sub.title,
            body: [clip(it.desc, 320)], source: '', image: sub.image });
        } else if (items.length === 2) {
          push({ pattern: 'two-cards', eyebrow: '구체적 사례', title: sub.title || sectionTitle,
            cards: items.map(function (it, i) {
              return { tone: i === 1 ? 'purple' : '', title: clip(it.label, 44), desc: clip(it.desc, 180) };
            }) });
        } else if (items.length === 3) {
          push({ pattern: 'three-cards', eyebrow: '구체적 사례', title: sub.title || sectionTitle,
            cards: cardsFromItems(items, 3) });
        } else {
          push({ pattern: 'bullet-list', eyebrow: '구체적 사례', title: sub.title || sectionTitle,
            items: items.slice(0, 5).map(function (it) { return { label: clip(it.label, 40), desc: clip(it.desc, 130) }; }) });
        }
      }
    });
  }

  function bodySlides(sub, section, push) {
    var paras = [];
    if (sub._intro) paras = paras.concat(sub._intro);
    (sub.blocks || []).forEach(function (b) {
      if (b.type === 'body') {
        if (b.paras && b.paras.length) paras = paras.concat(b.paras);
        if (b.items && b.items.length && !b.paras.length) {
          // a stray bullet body → bullet-list
        }
      }
    });
    paras = paras.filter(Boolean);
    if (!paras.length) return;
    // 2 단락만, 길이 제한 — 가벼운 본문 슬라이드
    var chosen = paras.slice(0, 2).map(function (p) { return clip(p, 210); });
    push({ pattern: 'split-text-image', eyebrow: sub.number || section.number,
      title: sub.title || section.title, paras: chosen, image: sub.image,
      imgPh: sub.title ? clip(sub.title, 18) : '이미지', wide: chosen.length <= 2 });
  }

  function mermaidSlide(sub, section, push) {
    if (!sub.mermaid) return;
    push({ pattern: 'split-text-image', eyebrow: 'DIAGRAM', title: sub.title || section.title,
      paras: ['이 개념의 구조를 도식으로 정리합니다. 우측 프레임에 다이어그램 이미지를 넣으세요.'],
      image: null, imgPh: '다이어그램 이미지', wide: true });
  }

  function infer(doc) {
    var slides = [];
    function push(s) { slides.push(s); }

    // 1. intro
    push({ pattern: 'intro-slide', eyebrow: 'INTRODUCTION',
      title: doc.title || '강의 제목', lead: clip((doc.intro || [])[0] || '', 220) });

    // 2. objectives → 한 장(1 slide)에 모두
    if (doc.objectives && doc.objectives.length) {
      push({ pattern: 'check-box', eyebrow: 'LEARNING OBJECTIVES', title: '학습 목표',
        items: doc.objectives.map(function (o) { return { label: '', desc: clip(o, 130) }; }) });
    }

    // 2b. 개요(agenda) — 이번 차시에서 다루는 단원 목록
    if ((doc.sections || []).length) {
      push({ pattern: 'agenda', eyebrow: 'OVERVIEW', title: '이번 차시에서 다룰 내용',
        items: doc.sections.map(function (s, i) {
          return { label: romanless(s.number || (i + 1)), desc: clip(s.title || '', 60) };
        }) });
    }

    // 3. sections
    var totalSec = (doc.sections || []).length;
    (doc.sections || []).forEach(function (section, si) {
      var sn = romanless(section.number || (si + 1));
      var snum = 'SECTION ' + sn;
      var prog = sn + ' / ' + romanless(totalSec);
      if (section.image) {
        // section-divider: left text + right image (image present) — 소요시간 미표기
        push({ pattern: 'section-divider', num: snum, ghost: sn, progress: prog,
          title: section.title, sub: '',
          desc: clip((section.intro || [])[0] || '', 150), image: section.image,
          imgPh: clip(section.title || '단원', 16) });
      } else {
        // no image → centered part-divider (avoids an empty image box)
        push({ pattern: 'part-divider', eyebrow: snum, ghost: sn, progress: prog,
          title: section.title, sub: clip((section.intro || [])[0] || '', 140) });
      }

      (section.subs || []).forEach(function (sub) {
        conceptSlides(sub, section.title, push);
        exampleSlides(sub, section.title, push);
        bodySlides(sub, section, push);
        mermaidSlide(sub, section, push);
      });
    });

    // 4. closing
    push({ pattern: 'closing-slide', eyebrow: 'WRAP-UP', title: '정리하며',
      sub: clip(doc.title || '', 60), image: null, imgPh: '마무리 이미지' });

    return slides;
  }

  global.DeckInfer = { infer: infer };
})(window);
