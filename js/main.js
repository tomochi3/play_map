(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAP = window.JAPAN_MAP;
  const EFFECTS = window.PREF_EFFECTS;
  const svg = document.getElementById('map');
  const fxLayer = document.getElementById('fx');
  const foundCount = document.getElementById('found-count');
  const foundTotal = document.getElementById('found-total');

  // 地方ごとの色
  const REGION_COLORS = [
    [[1, 1], ['#8fd3c1']],                                   // 北海道
    [[2, 7], ['#a9dc8f', '#9ad58a', '#b6e29a']],              // 東北
    [[8, 14], ['#f7d47a', '#f3c867', '#fadf8f']],             // 関東
    [[15, 23], ['#f6b48a', '#f2a679', '#f9c29d']],            // 中部
    [[24, 30], ['#f49ab0', '#ef8aa3', '#f7aec0']],            // 近畿
    [[31, 35], ['#c6a6e6', '#b897df', '#d2b6ec']],            // 中国
    [[36, 39], ['#8cc3ee', '#7bb7e8', '#a0cff2']],            // 四国
    [[40, 47], ['#e6a7d8', '#df96cf', '#ecb9e0']],            // 九州・沖縄
  ];
  function colorFor(id) {
    for (const [[a, b], colors] of REGION_COLORS) {
      if (id >= a && id <= b) return colors[(id - a) % colors.length];
    }
    return '#ccc';
  }

  // ---------- 地図の描画 ----------
  svg.setAttribute('viewBox', `0 0 ${MAP.width} ${MAP.height}`);
  const insetLayer = document.createElementNS(SVG_NS, 'g');
  const prefLayer = document.createElementNS(SVG_NS, 'g');
  svg.append(insetLayer, prefLayer);

  const prefs = new Map();
  for (const p of MAP.prefs) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('pref');
    g.dataset.id = p.id;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('fill', colorFor(p.id));
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = p.name;
    g.append(path, title);
    prefLayer.append(g);
    prefs.set(p.id, { ...p, g, dx: 0, dy: 0, next: 0 });
  }

  // 沖縄の枠（差し込み図）
  {
    const bb = prefs.get(47).g.getBBox();
    const r = document.createElementNS(SVG_NS, 'rect');
    const m = 10;
    r.setAttribute('x', bb.x - m);
    r.setAttribute('y', bb.y - m);
    r.setAttribute('width', bb.width + m * 2);
    r.setAttribute('height', bb.height + m * 2);
    r.setAttribute('rx', 6);
    r.classList.add('inset-frame');
    insetLayer.append(r);
  }

  function setOffset(pref, dx, dy) {
    pref.dx = dx;
    pref.dy = dy;
    pref.g.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // 都道府県の中心の画面座標
  function anchorOf(pref) {
    const m = svg.getScreenCTM();
    const x = pref.cx + pref.dx;
    const y = pref.cy + pref.dy;
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }

  // ---------- 発見記録 ----------
  const TOTAL = Object.values(EFFECTS).reduce((n, list) => n + list.length, 0);
  foundTotal.textContent = TOTAL;
  const STORE_KEY = 'play_map.found';
  let found = new Set();
  try { found = new Set(JSON.parse(localStorage.getItem(STORE_KEY) || '[]')); } catch (e) { /* 保存できない環境 */ }
  function markFound(key) {
    found.add(key);
    foundCount.textContent = found.size;
    try { localStorage.setItem(STORE_KEY, JSON.stringify([...found])); } catch (e) { /* noop */ }
  }
  foundCount.textContent = found.size;

  // ---------- パーティクル ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const particles = [];
  const effects = [];

  function spawn(o) {
    const el = document.createElement('div');
    if (o.drop) {
      el.className = 'drop';
      el.style.width = o.size + 'px';
      el.style.height = o.size * 1.2 + 'px';
      el.style.background = o.drop;
    } else {
      el.className = 'p';
      el.textContent = o.emoji;
      el.style.fontSize = o.size + 'px';
    }
    fxLayer.append(el);
    const p = Object.assign({
      vx: 0, vy: 0, g: 0, drag: 1, rot: 0, vr: 0, scale: 1, age: 0, life: 60,
      fadeIn: 0, flip: false, alpha: 1,
    }, o, { el });
    particles.push(p);
    return p;
  }

  function stepParticles(f) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += f;
      if (p.update) p.update(p, f);
      p.vy += p.g * f;
      p.vx *= Math.pow(p.drag, f);
      p.vy *= Math.pow(p.drag, f);
      p.x += p.vx * f;
      p.y += p.vy * f;
      p.rot += p.vr * f;
      const t = p.age / p.life;
      let a = p.alpha;
      if (t > 0.7) a *= Math.max(0, 1 - (t - 0.7) / 0.3);
      if (p.fadeIn && p.age < p.fadeIn) a *= p.age / p.fadeIn;
      const half = p.size / 2;
      p.el.style.opacity = a;
      p.el.style.transform =
        `translate(${p.x - half}px, ${p.y - half}px) rotate(${p.rot}deg) scale(${p.flip ? -p.scale : p.scale}, ${p.scale})`;
      if (p.age >= p.life || p.y > innerHeight + 200) {
        p.el.remove();
        particles.splice(i, 1);
      }
    }
  }

  // ---------- 吹き出し（セリフ） ----------
  let bubble = null;
  function showBubble(pref, text) {
    if (bubble) bubble.el.remove();
    const el = document.createElement('div');
    el.className = 'bubble';
    el.innerHTML = `<small></small><span></span>`;
    el.querySelector('small').textContent = pref.name;
    el.querySelector('span').textContent = text;
    fxLayer.append(el);
    bubble = { el, pref, age: 0, life: 150 };
  }
  function stepBubble(f) {
    if (!bubble) return;
    bubble.age += f;
    const { x, y } = anchorOf(bubble.pref);
    const w = bubble.el.offsetWidth;
    const h = bubble.el.offsetHeight;
    const bx = Math.min(Math.max(x - w / 2, 8), innerWidth - w - 8);
    const by = Math.max(y - h - 46, 8);
    const pop = Math.min(1, bubble.age / 8);
    const s = 0.6 + 0.4 * pop + Math.sin(Math.min(1, bubble.age / 12) * Math.PI) * 0.08;
    const a = bubble.age > bubble.life - 20 ? Math.max(0, (bubble.life - bubble.age) / 20) : 1;
    bubble.el.style.opacity = a;
    bubble.el.style.transform = `translate(${bx}px, ${by}px) scale(${s})`;
    if (bubble.age >= bubble.life) { bubble.el.remove(); bubble = null; }
  }

  // ---------- 演出タイプ ----------
  // 各演出: { update(f) -> まだ続くなら true, release() ドラッグ終了時 }
  const TYPES = {
    fountain(pref, emojis, color) {
      let held = true;
      let t = 0;
      const liquid = color || '#7cc7ff';
      return {
        update(f) {
          t += f;
          if (!held && t > 50) return false;
          const { x, y } = anchorOf(pref);
          const n = Math.random() < f * 0.9 ? 3 : 2;
          for (let i = 0; i < n; i++) {
            const isDrop = Math.random() < 0.6;
            spawn({
              x: x + rand(-4, 4), y: y - 4,
              vx: rand(-3.2, 3.2), vy: rand(-15, -9), g: 0.42,
              life: rand(55, 80), vr: rand(-8, 8),
              size: isDrop ? rand(6, 12) : rand(22, 34),
              drop: isDrop ? liquid : null,
              emoji: isDrop ? null : pick(emojis),
            });
          }
          return true;
        },
        release() { held = false; },
      };
    },

    float(pref, emojis) {
      let held = true;
      let t = 0;
      let acc = 0;
      return {
        update(f) {
          t += f;
          if (!held && t > 40) return false;
          acc += f;
          while (acc > 5) {
            acc -= 5;
            const { x, y } = anchorOf(pref);
            const phase = rand(0, Math.PI * 2);
            spawn({
              x: x + rand(-20, 20), y: y,
              vy: rand(-2.2, -1.2), life: rand(80, 120), size: rand(24, 40), fadeIn: 10,
              update: (p) => { p.vx = Math.sin(p.age / 12 + phase) * 1.2; p.scale = 0.7 + p.age / p.life * 0.7; },
              emoji: pick(emojis),
            });
          }
          return true;
        },
        release() { held = false; },
      };
    },

    trail(pref, emojis) {
      let held = true;
      let last = anchorOf(pref);
      let dist = 30;
      return {
        update() {
          if (!held) return false;
          const cur = anchorOf(pref);
          dist += Math.hypot(cur.x - last.x, cur.y - last.y);
          last = cur;
          while (dist > 26) {
            dist -= 26;
            spawn({
              x: cur.x + rand(-10, 10), y: cur.y + rand(-6, 6),
              vx: rand(-1, 1), vy: rand(-3, -1), g: 0.25, drag: 0.96,
              vr: rand(-6, 6), life: rand(70, 100), size: rand(22, 32),
              update: (p) => { if (p.age > 14) { p.vy *= 0.6; p.g = 0; p.vx *= 0.8; p.vr *= 0.8; } },
              emoji: pick(emojis),
            });
          }
          return true;
        },
        release() { held = false; },
      };
    },

    burst(pref, emojis) {
      const { x, y } = anchorOf(pref);
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2 + rand(-0.1, 0.1);
        const sp = rand(5, 14);
        spawn({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3, g: 0.3, drag: 0.98,
          vr: rand(-15, 15), life: rand(60, 90), size: rand(22, 40), emoji: pick(emojis),
        });
      }
      spawn({ x, y, life: 18, size: 90, emoji: '💥', update: (p) => { p.scale = 0.5 + p.age / 10; } });
      return { update: () => false, release() {} };
    },

    rain(pref, emojis) {
      let t = 0;
      let acc = 0;
      return {
        update(f) {
          t += f;
          if (t > 100) return false;
          acc += f;
          while (acc > 2) {
            acc -= 2;
            const { x } = anchorOf(pref);
            spawn({
              x: x + rand(-220, 220), y: rand(-80, -30),
              vx: rand(-0.6, 0.6), vy: rand(2, 5), g: 0.22,
              vr: rand(-5, 5), life: 200, size: rand(22, 38), emoji: pick(emojis),
            });
          }
          return true;
        },
        release() {},
      };
    },

    orbit(pref, emojis) {
      const n = 8;
      const items = [];
      let t = 0;
      let held = true;
      for (let i = 0; i < n; i++) {
        items.push(spawn({
          x: 0, y: 0, life: 99999, size: 30, emoji: emojis[i % emojis.length], fadeIn: 12,
        }));
      }
      return {
        update(f) {
          t += f;
          const { x, y } = anchorOf(pref);
          const r = Math.min(1, t / 20) * 70;
          const end = !held && t > 160;
          items.forEach((p, i) => {
            const a = t / 18 + (i / n) * Math.PI * 2;
            p.x = x + Math.cos(a) * r;
            p.y = y + Math.sin(a) * r * 0.75;
            p.scale = 0.9 + Math.sin(a) * 0.2;
            if (end && p.life > p.age + 25) p.life = p.age + 25;
          });
          return !end || items.some((p) => p.age < p.life);
        },
        release() { held = false; },
      };
    },

    march(pref, emojis) {
      const { x, y } = anchorOf(pref);
      const dir = x < innerWidth / 2 ? 1 : -1;
      for (let i = 0; i < 7; i++) {
        const delay = i * 9;
        const phase = rand(0, Math.PI * 2);
        const baseY = y + rand(-25, 25);
        spawn({
          x: x - dir * i * 6, y: baseY, vx: dir * rand(4.5, 6), life: 220, size: rand(30, 44),
          emoji: pick(emojis), flip: dir > 0, fadeIn: 1, alpha: 0,
          update: (p) => {
            if (p.age < delay) { p.vx0 = p.vx0 ?? p.vx; p.vx = 0; return; }
            if (p.vx0 !== undefined) { p.vx = p.vx0; p.vx0 = undefined; }
            p.alpha = 1;
            p.y = baseY - Math.abs(Math.sin(p.age / 5 + phase)) * 14;
          },
        });
      }
      return { update: () => false, release() {} };
    },

    sprout(pref, emojis) {
      let held = true;
      let t = 0;
      let endAt = Infinity;
      const p = spawn({ x: 0, y: 0, life: 99999, size: 120, emoji: emojis[0], scale: 0 });
      p.el.style.transformOrigin = '50% 100%';
      return {
        update(f) {
          t += f;
          const { x, y } = anchorOf(pref);
          // にょきっと伸びて、少しびよんと揺れる
          const k = Math.min(1, t / 22);
          const grow = 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.25;
          let s = grow;
          if (t > endAt) s *= Math.max(0, 1 - (t - endAt) / 15);
          p.scale = s;
          p.rot = Math.sin(t / 6) * 6 * Math.max(0, 1 - t / 60) + Math.sin(t / 20) * 2;
          p.x = x;
          p.y = y - 50; // 下端（拡大の基準点）が中心にくるように
          if (t > endAt + 15) { p.life = 0; return false; }
          return true;
        },
        release() { held = false; endAt = Math.max(t + 70, 90); },
      };
    },

    spin(pref, emojis) {
      let t = 0;
      const p = spawn({ x: 0, y: 0, life: 99999, size: 90, emoji: emojis[0], scale: 0 });
      return {
        update(f) {
          t += f;
          const { x, y } = anchorOf(pref);
          p.x = x;
          p.y = y - 40;
          p.scale = Math.min(1, t / 20) * 1.4 * (t > 100 ? Math.max(0, 1 - (t - 100) / 20) : 1);
          p.rot = t * 12;
          if (t > 120) { p.life = 0; return false; }
          return true;
        },
        release() {},
      };
    },
  };

  function startEffect(pref) {
    const list = EFFECTS[pref.id];
    if (!list) return null;
    const idx = pref.next % list.length;
    pref.next++;
    const [type, emojiStr, label, color] = list[idx];
    const factory = TYPES[type];
    if (!factory) return null;
    const fx = factory(pref, emojiStr.split(/\s+/), color);
    effects.push(fx);
    showBubble(pref, label);
    markFound(`${pref.id}:${idx}`);
    return fx;
  }

  // ---------- メインループ ----------
  let lastTime = performance.now();
  function frame(now) {
    const f = Math.min(3, (now - lastTime) / (1000 / 60));
    lastTime = now;
    for (let i = effects.length - 1; i >= 0; i--) {
      if (!effects[i].update(f)) effects.splice(i, 1);
    }
    stepParticles(f);
    stepBubble(f);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- ドラッグ ----------
  let drag = null;

  function toSvg(e) {
    const m = svg.getScreenCTM().inverse();
    return { x: m.a * e.clientX + m.c * e.clientY + m.e, y: m.b * e.clientX + m.d * e.clientY + m.f };
  }

  svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.pref');
    if (!g || drag) return;
    e.preventDefault();
    const pref = prefs.get(+g.dataset.id);
    g.classList.remove('returning');
    prefLayer.append(g); // 最前面へ
    const pt = toSvg(e);
    drag = { pref, pointerId: e.pointerId, startX: pt.x, startY: pt.y, ox: pref.dx, oy: pref.dy, fx: null };
    svg.setPointerCapture(e.pointerId);
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const pt = toSvg(e);
    const dx = pt.x - drag.startX;
    const dy = pt.y - drag.startY;
    if (!drag.fx) {
      if (Math.hypot(dx, dy) < 4) return; // クリックだけでは発動しない
      drag.pref.g.classList.add('dragging');
      drag.fx = startEffect(drag.pref) || { release() {} };
    }
    setOffset(drag.pref, drag.ox + dx, drag.oy + dy);
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.pref.g.classList.remove('dragging');
    if (drag.fx) drag.fx.release();
    drag = null;
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // ダブルクリックでその県だけ元の位置へ
  svg.addEventListener('dblclick', (e) => {
    const g = e.target.closest('.pref');
    if (!g) return;
    const pref = prefs.get(+g.dataset.id);
    g.classList.add('returning');
    setOffset(pref, 0, 0);
  });

  document.getElementById('reset').addEventListener('click', () => {
    for (const pref of prefs.values()) {
      pref.g.classList.add('returning');
      setOffset(pref, 0, 0);
    }
    // 元の重なり順に戻す
    for (const p of MAP.prefs) prefLayer.append(prefs.get(p.id).g);
  });
})();
