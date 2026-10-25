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
    // 外側の g で位置、内側の piece で持ち上げ・傾きを表す
    const piece = document.createElementNS(SVG_NS, 'g');
    piece.classList.add('piece');
    piece.append(path, title);
    g.append(piece);
    prefLayer.append(g);
    prefs.set(p.id, {
      ...p, g, piece, next: 0,
      dx: 0, dy: 0, vx: 0, vy: 0, mode: 'idle',
      lift: 0, liftT: 0, tilt: 0, moveX: 0, squash: -1, hover: false,
    });
  }

  // 沖縄・奄美の枠（差し込み図）
  {
    const bb = MAP.inset;
    const r = document.createElementNS(SVG_NS, 'rect');
    const m = 10;
    r.setAttribute('x', bb.x - m);
    r.setAttribute('y', bb.y - m);
    r.setAttribute('width', bb.w + m * 2);
    r.setAttribute('height', bb.h + m * 2);
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

  // ---------- 効果音（Web Audio で合成） ----------
  const Sound = (() => {
    const MUTE_KEY = 'play_map.muted';
    let ctx = null;
    let muted = false;
    try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* noop */ }

    function unlock() {
      if (muted) return;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume();
    }
    function ready() { return ctx && !muted && ctx.state === 'running'; }

    // 周波数を f0 → f1 に動かす短い音
    function tone(f0, f1, dur, vol, type = 'sine', delay = 0) {
      if (!ready()) return;
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    // ノイズ（シュワー、ドカン）
    function noise(dur, freq, vol, delay = 0, sweepTo = freq) {
      if (!ready()) return;
      const t = ctx.currentTime + delay;
      const len = Math.ceil(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(freq, t);
      bp.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g).connect(ctx.destination);
      src.start(t);
    }

    const EFFECT_SOUNDS = {
      fountain() { noise(0.7, 900, 0.12, 0, 3000); tone(300, 700, 0.25, 0.06, 'triangle'); },
      sprout() { tone(180, 900, 0.4, 0.1, 'triangle'); tone(900, 1400, 0.08, 0.05, 'sine', 0.38); },
      burst() { noise(0.4, 500, 0.35, 0, 120); tone(140, 40, 0.35, 0.25); },
      rain() { for (let i = 0; i < 10; i++) tone(rand(900, 1700), rand(700, 1200), 0.06, 0.04, 'sine', i * 0.09); },
      orbit() { for (let i = 0; i < 4; i++) tone(500 + i * 120, 700 + i * 120, 0.1, 0.05, 'triangle', i * 0.08); },
      float() { tone(400, 640, 0.5, 0.06); tone(520, 800, 0.5, 0.04, 'sine', 0.12); },
      march() { for (let i = 0; i < 6; i++) tone(i % 2 ? 260 : 320, 200, 0.05, 0.08, 'square', i * 0.13); },
      trail() { for (let i = 0; i < 3; i++) tone(700 - i * 120, 500 - i * 100, 0.07, 0.05, 'sine', i * 0.1); },
      spin() { tone(300, 1200, 0.5, 0.05, 'sawtooth'); },
    };

    return {
      get muted() { return muted; },
      setMuted(v) {
        muted = v;
        try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch (e) { /* noop */ }
        if (!v) unlock();
      },
      unlock,
      pickup() { tone(480, 780, 0.08, 0.09); },
      drop() { tone(200, 90, 0.14, 0.14); noise(0.05, 700, 0.04); },
      snap() { tone(1300, 1250, 0.03, 0.08, 'square'); tone(1700, 1650, 0.04, 0.07, 'square', 0.05); },
      bump() { tone(260, 160, 0.06, 0.07); },
      reset() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.12, 0.06, 'triangle', i * 0.07)); },
      effect(type) { (EFFECT_SOUNDS[type] || (() => {}))(); },
    };
  })();

  function buzz(pattern) {
    if (!Sound.muted && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) { /* noop */ }
    }
  }

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
    Sound.effect(type);
    markFound(`${pref.id}:${idx}`);
    return fx;
  }

  // ---------- 動き（持ち上げ・傾き・投げ・ばね） ----------
  const active = new Set(); // 動きの計算が必要な都道府県
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // 画面に見えている範囲（SVG座標）
  function visibleBounds() {
    const m = svg.getScreenCTM().inverse();
    const tl = { x: m.e, y: m.f };
    const br = { x: m.a * innerWidth + m.e, y: m.d * innerHeight + m.f };
    return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
  }

  // 中心が画面の外に出ないようにする。はみ出したら true
  function keepInside(pref) {
    const b = visibleBounds();
    const m = 14;
    const x = pref.cx + pref.dx;
    const y = pref.cy + pref.dy;
    const cx = clamp(x, b.x0 + m, b.x1 - m);
    const cy = clamp(y, b.y0 + m + 30, b.y1 - m);
    const hitX = cx !== x;
    const hitY = cy !== y;
    if (hitX) pref.dx = cx - pref.cx;
    if (hitY) pref.dy = cy - pref.cy;
    return { hitX, hitY };
  }

  function wake(pref) { active.add(pref); }

  function settle(pref) {
    pref.squash = 0; // ぷるんと着地
    Sound.drop();
    buzz(12);
  }

  function goHome(pref, withSnap) {
    pref.mode = 'home';
    if (withSnap) { Sound.snap(); buzz([8, 30, 8]); }
    wake(pref);
  }

  const HOME_SNAP = 16; // 元の場所にこれ以内で離すと吸い付く（SVG単位）

  function stepPref(pref, f) {
    // 位置
    if (pref.mode === 'glide') {
      pref.dx += pref.vx * f;
      pref.dy += pref.vy * f;
      const fr = Math.pow(0.93, f);
      pref.vx *= fr;
      pref.vy *= fr;
      const { hitX, hitY } = keepInside(pref);
      if (hitX) { pref.vx *= -0.55; Sound.bump(); }
      if (hitY) { pref.vy *= -0.55; Sound.bump(); }
      if (Math.hypot(pref.vx, pref.vy) < 0.25) {
        if (Math.hypot(pref.dx, pref.dy) < HOME_SNAP) goHome(pref, true);
        else { pref.mode = 'idle'; settle(pref); }
      }
    } else if (pref.mode === 'home') {
      // ばね（少しだけ行き過ぎて戻る）
      pref.vx += (-0.09 * pref.dx - 0.32 * pref.vx) * f;
      pref.vy += (-0.09 * pref.dy - 0.32 * pref.vy) * f;
      pref.dx += pref.vx * f;
      pref.dy += pref.vy * f;
      if (Math.hypot(pref.dx, pref.dy) < 0.3 && Math.hypot(pref.vx, pref.vy) < 0.3) {
        pref.dx = pref.dy = pref.vx = pref.vy = 0;
        pref.mode = 'idle';
        pref.squash = 0;
      }
    }
    setOffset(pref, pref.dx, pref.dy);

    // 見た目（持ち上げ・傾き・着地のぷるん）
    pref.lift += (pref.liftT - pref.lift) * (1 - Math.pow(0.7, f));
    const tiltT = pref.mode === 'drag' ? clamp(pref.moveX * 1.4, -12, 12) : 0;
    pref.tilt += (tiltT - pref.tilt) * (1 - Math.pow(0.78, f));
    let sx = 1;
    let sy = 1;
    if (pref.squash >= 0) {
      pref.squash += f;
      const j = 0.09 * Math.exp(-pref.squash / 7) * Math.cos(pref.squash / 2.4);
      sx += j;
      sy -= j;
      if (pref.squash > 45) pref.squash = -1;
    }
    const s = 1 + pref.lift * 0.09;
    pref.piece.style.transform = `rotate(${pref.tilt}deg) scale(${s * sx}, ${s * sy})`;
    if (pref.lift > 0.02) {
      const l = pref.lift;
      pref.piece.style.filter =
        `brightness(${1 + l * 0.08}) drop-shadow(0 ${2 + l * 9}px ${2 + l * 6}px rgba(20, 50, 70, ${0.12 + l * 0.2}))`;
    } else {
      pref.piece.style.filter = '';
    }
    pref.moveX *= Math.pow(0.8, f);

    const still = pref.mode === 'idle' && pref.squash < 0 &&
      Math.abs(pref.lift - pref.liftT) < 0.005 && Math.abs(pref.tilt) < 0.05;
    if (still) {
      pref.lift = pref.liftT;
      pref.tilt = 0;
      active.delete(pref);
    }
  }

  // ---------- メインループ ----------
  let lastTime = performance.now();
  function frame(now) {
    const f = Math.min(3, (now - lastTime) / (1000 / 60));
    lastTime = now;
    for (const pref of active) stepPref(pref, f);
    for (let i = effects.length - 1; i >= 0; i--) {
      if (!effects[i].update(f)) effects.splice(i, 1);
    }
    stepParticles(f);
    stepBubble(f);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- ドラッグ（マルチタッチ対応） ----------
  const drags = new Map(); // pointerId -> drag
  const hint = document.getElementById('hint');

  function toSvg(x, y) {
    const m = svg.getScreenCTM().inverse();
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }

  // 指先が少しずれても、近くの都道府県をつかめるようにする
  function prefAt(e) {
    const direct = e.target.closest && e.target.closest('.pref');
    if (direct) return prefs.get(+direct.dataset.id);
    const maxR = e.pointerType === 'touch' ? 28 : 12;
    for (let r = 6; r <= maxR; r += 6) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const el = document.elementFromPoint(e.clientX + Math.cos(a) * r, e.clientY + Math.sin(a) * r);
        const g = el && el.closest && el.closest('.pref');
        if (g) return prefs.get(+g.dataset.id);
      }
    }
    return null;
  }

  function isHeld(pref) {
    for (const d of drags.values()) if (d.pref === pref) return true;
    return false;
  }

  svg.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const pref = prefAt(e);
    if (!pref || isHeld(pref)) return;
    e.preventDefault();
    Sound.unlock();
    prefLayer.append(pref.g); // 最前面へ
    const pt = toSvg(e.clientX, e.clientY);
    drags.set(e.pointerId, {
      pref, sx: e.clientX, sy: e.clientY,
      gx: pt.x - pref.dx, gy: pt.y - pref.dy, // つかんだ位置のずれ
      samples: [{ t: e.timeStamp, x: pt.x, y: pt.y }], fx: null,
    });
    svg.setPointerCapture(e.pointerId);
    pref.mode = 'drag';
    pref.vx = pref.vy = 0;
    pref.liftT = 1;
    pref.squash = -1;
    pref.g.classList.add('dragging');
    Sound.pickup();
    buzz(8);
    wake(pref);
  });

  svg.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const last = evs.length ? evs[evs.length - 1] : e;
    const pt = toSvg(last.clientX, last.clientY);
    for (const ev of (evs.length ? evs : [e])) {
      const p = toSvg(ev.clientX, ev.clientY);
      d.samples.push({ t: ev.timeStamp, x: p.x, y: p.y });
    }
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 90) d.samples.shift();

    if (!d.fx) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return; // タップだけでは発動しない
      d.fx = startEffect(d.pref) || { release() {} };
      if (hint) hint.classList.add('hide');
    }
    const pref = d.pref;
    const nx = pt.x - d.gx;
    pref.moveX = pref.moveX * 0.5 + (nx - pref.dx) * 0.5;
    pref.dx = nx;
    pref.dy = pt.y - d.gy;
    keepInside(pref);
    setOffset(pref, pref.dx, pref.dy);
  });

  function endDrag(e) {
    const d = drags.get(e.pointerId);
    if (!d) return;
    drags.delete(e.pointerId);
    const pref = d.pref;
    pref.g.classList.remove('dragging');
    pref.liftT = pref.hover ? 0.35 : 0;
    if (d.fx) d.fx.release();

    // 離した瞬間の速さ（60fps の1フレームあたり）
    const s = d.samples;
    let vx = 0;
    let vy = 0;
    if (s.length >= 2 && e.timeStamp - s[s.length - 1].t < 60) {
      const a = s[0];
      const b = s[s.length - 1];
      const dt = Math.max(8, b.t - a.t) / (1000 / 60);
      vx = (b.x - a.x) / dt;
      vy = (b.y - a.y) / dt;
    }
    const speed = Math.hypot(vx, vy);
    if (speed > 1.2) {
      const k = Math.min(1, 40 / speed); // 投げすぎ防止
      pref.vx = vx * k;
      pref.vy = vy * k;
      pref.mode = 'glide';
    } else if (Math.hypot(pref.dx, pref.dy) < HOME_SNAP) {
      goHome(pref, true);
    } else {
      pref.mode = 'idle';
      if (d.fx) settle(pref);
      else { pref.squash = 0; Sound.drop(); }
    }
    wake(pref);
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('contextmenu', (e) => e.preventDefault());

  // マウスを乗せると少し浮く
  svg.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const g = e.target.closest('.pref');
    if (!g) return;
    const pref = prefs.get(+g.dataset.id);
    pref.hover = true;
    if (pref.mode !== 'drag') { pref.liftT = 0.35; wake(pref); }
  });
  svg.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const g = e.target.closest('.pref');
    if (!g || (e.relatedTarget && g.contains(e.relatedTarget))) return;
    const pref = prefs.get(+g.dataset.id);
    pref.hover = false;
    if (pref.mode !== 'drag') { pref.liftT = 0; wake(pref); }
  });

  // ダブルクリックでその県だけ元の位置へ
  svg.addEventListener('dblclick', (e) => {
    const g = e.target.closest('.pref');
    if (!g) return;
    goHome(prefs.get(+g.dataset.id), true);
  });

  document.getElementById('reset').addEventListener('click', () => {
    Sound.unlock();
    let i = 0;
    for (const pref of prefs.values()) {
      if (isHeld(pref) || (pref.dx === 0 && pref.dy === 0)) continue;
      // 少しずつずらして戻すと気持ちいい
      setTimeout(() => goHome(pref, false), Math.min(i++ * 25, 600));
    }
    if (i) Sound.reset();
    // 元の重なり順に戻す
    for (const p of MAP.prefs) prefLayer.append(prefs.get(p.id).g);
  });

  // ---------- ズーム・スクロール ----------
  // 海をドラッグで移動、ホイール／ピンチ／ボタンで拡大縮小
  const view = { x: 0, y: 0, w: MAP.width, h: MAP.height };
  const ZOOM_MIN_W = MAP.width / 6;
  const ZOOM_MAX_W = MAP.width * 1.1;

  function applyView() {
    view.x = clamp(view.x, -view.w / 2, MAP.width - view.w / 2);
    view.y = clamp(view.y, -view.h / 2, MAP.height - view.h / 2);
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  }

  // 画面上の (cx, cy) の下にある地図上の点を動かさずに、幅を w にする
  function zoomTo(w, cx, cy) {
    const before = toSvg(cx, cy);
    w = clamp(w, ZOOM_MIN_W, ZOOM_MAX_W);
    view.w = w;
    view.h = w * MAP.height / MAP.width;
    applyView();
    const after = toSvg(cx, cy);
    view.x += before.x - after.x;
    view.y += before.y - after.y;
    applyView();
  }
  const zoomBy = (factor, cx, cy) => zoomTo(view.w / factor, cx, cy);

  // 地図上の点 p が画面の (cx, cy) に来るように動かす
  function pinTo(p, cx, cy) {
    const q = toSvg(cx, cy);
    view.x += p.x - q.x;
    view.y += p.y - q.y;
    applyView();
  }

  let zoomAnim = null;
  function animateView(target) {
    cancelAnimationFrame(zoomAnim);
    const from = { ...view };
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 380);
      const e = 1 - Math.pow(1 - t, 3);
      for (const k of ['x', 'y', 'w', 'h']) view[k] = from[k] + (target[k] - from[k]) * e;
      applyView();
      if (t < 1) zoomAnim = requestAnimationFrame(step);
    };
    zoomAnim = requestAnimationFrame(step);
  }

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    cancelAnimationFrame(zoomAnim);
    const isMouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50);
    if (e.ctrlKey || isMouseWheel) {
      // ピンチ（トラックパッド）やマウスホイールは拡大縮小
      const k = e.ctrlKey ? 0.012 : 0.0018;
      const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      zoomBy(Math.exp(-dy * k), e.clientX, e.clientY);
    } else {
      // 2本指スクロールは移動
      const u = view.w / svg.getBoundingClientRect().width;
      view.x += e.deltaX * u;
      view.y += e.deltaY * u;
      applyView();
    }
  }, { passive: false });

  const pans = new Map(); // pointerId -> {x, y}（海をつかんでいる指）
  let panState = null;

  function resetPanState() {
    const pts = [...pans.values()];
    if (pts.length === 0) { panState = null; return; }
    const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    panState = { anchor: toSvg(mid.x, mid.y), dist, w: view.w };
  }

  svg.addEventListener('pointerdown', (e) => {
    if (drags.has(e.pointerId) || e.button > 0) return;
    if (prefAt(e)) return;
    e.preventDefault();
    cancelAnimationFrame(zoomAnim);
    svg.setPointerCapture(e.pointerId);
    pans.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.classList.add('panning');
    resetPanState();
  });

  svg.addEventListener('pointermove', (e) => {
    if (!pans.has(e.pointerId)) return;
    pans.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pans.values()];
    const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    if (pts.length > 1 && panState.dist > 0) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      view.w = clamp(panState.w * panState.dist / dist, ZOOM_MIN_W, ZOOM_MAX_W);
      view.h = view.w * MAP.height / MAP.width;
    }
    pinTo(panState.anchor, mid.x, mid.y);
  });

  function endPan(e) {
    if (!pans.has(e.pointerId)) return;
    pans.delete(e.pointerId);
    if (!pans.size) svg.classList.remove('panning');
    resetPanState();
  }
  svg.addEventListener('pointerup', endPan);
  svg.addEventListener('pointercancel', endPan);

  // 海をダブルクリック（ダブルタップ）で拡大
  svg.addEventListener('dblclick', (e) => {
    if (e.target.closest('.pref')) return;
    zoomBy(1.8, e.clientX, e.clientY);
  });

  const stageCenter = () => {
    const r = svg.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  document.getElementById('zoom-in').addEventListener('click', () => zoomBy(1.5, ...stageCenter()));
  document.getElementById('zoom-out').addEventListener('click', () => zoomBy(1 / 1.5, ...stageCenter()));
  document.getElementById('zoom-fit').addEventListener('click', () => {
    animateView({ x: 0, y: 0, w: MAP.width, h: MAP.height });
  });

  const muteBtn = document.getElementById('mute');
  function renderMute() {
    muteBtn.textContent = Sound.muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', Sound.muted ? '音を出す' : '音を消す');
  }
  muteBtn.addEventListener('click', () => {
    Sound.setMuted(!Sound.muted);
    renderMute();
  });
  renderMute();
})();
