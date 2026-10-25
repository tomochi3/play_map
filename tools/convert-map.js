// 地図データ生成: node tools/convert-map.js japan.geojson js/map-data.js
// japan.geojson は https://github.com/dataofjapan/land から取得
const fs = require('fs');
const gj = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3];
const K = Math.cos(36 * Math.PI / 180);
// 差し込み枠: 地図左上の空いている海へ移動
const OKI_DX = 5.7, OKI_DY = 15;
function proj([lon, lat], inset) {
  if (inset) { lon += OKI_DX; lat += OKI_DY; }
  return [lon * K, -lat];
}
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / len;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function area(r) { let s = 0; for (let i = 0; i < r.length; i++) { const [a, b] = r[i], [c, d] = r[(i + 1) % r.length]; s += a * d - c * b; } return s / 2; }

const insetBox = [Infinity, Infinity, -Infinity, -Infinity];
const feats = gj.features.map(f => {
  const id = f.properties.id;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const kept = polys.filter(p => !p[0].every(([lon, lat]) => (id === 13 && lat < 31) || (id === 47 && lon > 130)));
  return { id, name: f.properties.nam_ja, polys: kept.map(p => {
    // 沖縄と、鹿児島の奄美・トカラ列島（北緯30.1度以南）は差し込み枠へ
    const inset = id === 47 || (id === 46 && p[0].every(([, lat]) => lat < 30.1));
    const ring = p[0].map(c => proj(c, inset));
    if (inset) for (const [x, y] of ring) { insetBox[0] = Math.min(insetBox[0], x); insetBox[1] = Math.min(insetBox[1], y); insetBox[2] = Math.max(insetBox[2], x); insetBox[3] = Math.max(insetBox[3], y); }
    return ring;
  }) };
});
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const f of feats) for (const r of f.polys) for (const [x, y] of r) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
const W = 1000, pad = 10;
const s = (W - pad * 2) / Math.max(maxX - minX, maxY - minY);
const H = Math.ceil((maxY - minY) * s + pad * 2);
const Wc = Math.ceil((maxX - minX) * s + pad * 2);
const res = feats.sort((a, b) => a.id - b.id).map(f => {
  let rings = f.polys.map(r => r.map(([x, y]) => [(x - minX) * s + pad, (y - minY) * s + pad]));
  const big = Math.max(...rings.map(r => Math.abs(area(r))));
  rings = rings.filter(r => Math.abs(area(r)) > Math.max(1.5, big * 0.004));
  rings = rings.map(r => { const h = r.length >> 1; return dp(r.slice(0, h + 1), 0.6).concat(dp(r.slice(h), 0.6).slice(1, -1)); }).filter(r => r.length >= 4);
  // centroid of largest ring
  if (!rings.length) { console.error("empty", f.id); process.exit(1); }
  const main = rings.reduce((a, b) => Math.abs(area(a)) > Math.abs(area(b)) ? a : b);
  let cx = 0, cy = 0, A = 0;
  for (let i = 0; i < main.length; i++) { const [x0, y0] = main[i], [x1, y1] = main[(i + 1) % main.length]; const c = x0 * y1 - x1 * y0; A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c; }
  A /= 2; cx /= 6 * A; cy /= 6 * A;
  // 凹んだ形で重心が外に出る場合は、内側で重心に最も近い点を使う
  const inside = (px, py) => { let c = false; for (let i = 0, j = main.length - 1; i < main.length; j = i++) { const [xi, yi] = main[i], [xj, yj] = main[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c; } return c; };
  if (!inside(cx, cy)) {
    let best = null, bd = Infinity;
    for (let gx = cx - 60; gx <= cx + 60; gx += 1) for (let gy = cy - 60; gy <= cy + 60; gy += 1) {
      const d = (gx - cx) ** 2 + (gy - cy) ** 2;
      if (d < bd && inside(gx, gy) && inside(gx + 4, gy) && inside(gx - 4, gy) && inside(gx, gy + 4) && inside(gx, gy - 4)) { bd = d; best = [gx, gy]; }
    }
    if (best) [cx, cy] = best;
  }
  const d = rings.map(r => 'M' + r.map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join('L') + 'Z').join('');
  return { id: f.id, name: f.name, cx: +cx.toFixed(1), cy: +cy.toFixed(1), d };
});
const inset = {
  x: +((insetBox[0] - minX) * s + pad).toFixed(1), y: +((insetBox[1] - minY) * s + pad).toFixed(1),
  w: +((insetBox[2] - insetBox[0]) * s).toFixed(1), h: +((insetBox[3] - insetBox[1]) * s).toFixed(1),
};
fs.writeFileSync(out, '// 生成元: dataofjapan/land (japan.geojson) を簡略化\nwindow.JAPAN_MAP = ' + JSON.stringify({ width: Wc, height: H, inset, prefs: res }) + ';\n');
console.log(Wc, H, res.length, fs.statSync(out).size);
