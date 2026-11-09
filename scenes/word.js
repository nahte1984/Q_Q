/* ==========================================================================
   word — 文、體（Figma wenTi）
   --------------------------------------------------------------------------
   30089 ms   divide 的九格開始錯落淡出，露出下面這一段。背景從頭到尾都是一片 #313131，加細顆粒（沒有鏡頭畫面）。
   31024 ms   文和體的範圍裡淡入鏡頭畫面（1 秒；Figma wenTi V2）：前鏡頭畫面套 color.CUBE 調色、不模糊、轉成灰階，
              用柔光（soft light）疊在漸層上；鏡頭畫面鋪滿整個畫面（像 object-fit: cover、左右鏡像），
              字只露出它範圍裡的那一塊，像是從字裡面看出去。
   31345 ms   「文」從最終大小的 75% 彈出來（約 1.25 秒；一開始很快淡入，彈到最大再略微縮小，QQ 的感覺）；
              約 200 毫秒之後（31545 ms）「體」開始彈，32795 ms 兩個字都完整彈出來。
              到定位之後，兩個字都在定位附近微微地隨機游移、微幅旋轉；
              眼睛和嘴巴三個符號也各自稍微游移，大小和角度有非常些微的變化。
   眼睛：      八組，一開始隨機給文和體各一組（不重複）；嘴巴固定。
   點擊文／體： 換那個字的眼睛（舊的眼睛高度迅速變成 0，新的再從 0 變回原本的大小，像眨眼；
              兩隻眼睛隨機一前一後，差一點點時間），
              同時從那幾個顏色裡隨機選兩個不重複的顏色換成新的漸層。
   41134 ms   文、體和六個符號（兩張嘴、四隻眼睛）用隨機的順序錯落地往下掉（像重力一樣越掉越快，
              各自帶一點自轉和左右偏移；符號比較輕，轉得比較快），最慢的那一個在 42334 ms 完全掉出畫面；
              字裡面的鏡頭畫面同時淡掉。之後維持一片 #313131，到 43210 ms 換成 slit。

   index.html：word 用 transition: 'under' 接在 divide 後面（divide 疊在上面自己淡出），
   全部用同一個 WebGL 畫布畫（形狀先畫成貼圖），顆粒和其他段落一樣。
   ========================================================================== */

import { LUT_FILE, parseCube, LUT_GLSL, uploadLut } from './lut.js';
import { WEN, TI, WEN_MOUTH, TI_MOUTH, EYES } from './word-shapes.js';

/* ---------- 時間（毫秒，歌曲時間） ---------- */
const START = 30089;                     // 這一段開始（divide 的格子從這裡開始淡出）
const CAM_AT = 31024;                    // 字裡面的鏡頭畫面開始淡入
const CAM_FADE = 1000;                   // 淡入要多久
const WEN_AT = 31345;                    // 「文」開始彈出來
const POP = 1250;                        // 每個字彈出來要多久
const TI_DELAY = 200;                    // 文開始彈之後，體晚多久開始彈（毫秒）
const TI_AT = WEN_AT + TI_DELAY;         // 「體」開始彈出來（31545；32795 兩個字都彈完）
const POP_FROM = 0.75;                   // 彈進場的起始大小（最終大小的幾倍；一開始很快地淡入）
const POP_FADE = 120;                    // 一開始淡入要多久（毫秒）
const POP_BOUNCE = 2.5, POP_WAVES = 3;   // 彈的樣子：從 0.75 彈到最大（約 1.11 倍）再略微縮小（約 0.96 倍）再回到原本大小

/* ---------- 退場：文、體和六個符號錯落地往下掉 ---------- */
const GONE = 42334;                      // 最慢的那一個完全掉出畫面
const OUT_DUR = 1200;                    // 從第一個開始掉到全部掉出畫面要多久（毫秒）
const OUT_AT = GONE - OUT_DUR;           // 第一個開始掉（41134）
const FALL_SPREAD = 0.45;                // 八個開始掉的時間隨機錯開多少（佔 OUT_DUR 的比例；0 = 一起掉）
// 每一個掉的時候隨機帶一點自轉和左右偏移（往哪邊轉就往哪邊偏，像失去平衡倒下去）
const FALL_SPIN = [4, 18];               // 一開始的自轉速度（度/秒，隨機在這個範圍內）
const FALL_SPIN_ACC = [4, 20];           // 自轉越轉越快（度/秒²）
const FALL_DRIFT = [5, 30];              // 一開始的左右偏移速度（px/秒）
const FALL_DRIFT_ACC = [0, 20];          // 左右偏移越來越快（px/秒²）
const PART_SPIN = 3;                     // 眼睛、嘴巴比較輕：自轉是字的幾倍

/* ---------- 背景 ---------- */
const BG_COLOR = '#313131';
const CHAR_CAM = 1;                      // 字裡面的鏡頭（灰階、不模糊、柔光疊在漸層上）有多明顯：0 = 只有漸層，1 = 完整的柔光

/* ---------- 字（Figma wenTi，388 × 743 的畫面） ---------- */
const COLORS = ['#d2d6d3', '#f8efce', '#ffcdb4', '#cdb2f1', '#ccebc8', '#ffb5d3', '#ff8f8f'];   // 點擊時從這裡選兩個做漸層
const SIZE = 1.632;                      // 形狀放大幾倍（Figma 元件頁 → wenTi 版面）
const CHARS = [
  // at：中心在 Figma 畫面上的位置；rot：角度（度）；eyes：眼睛的中心（相對字的中心，元件頁的單位）；colors：一開始的漸層（上 → 下）
  { name: '文', shape: WEN, mouth: WEN_MOUTH, at: [197.5, 189.0], rot: 2, eyes: [-31, -41], colors: ['#ffb5d3', '#f8efce'], popAt: WEN_AT },
  { name: '體', shape: TI, mouth: TI_MOUTH, at: [175.45, 536.05], rot: -3, eyes: [-52, -49], colors: ['#d2d6d3', '#ccebc8'], popAt: TI_AT },
];

/* ---------- 游移 ---------- */
const WANDER_PX = 6;                     // 字在定位附近游移的距離（Figma px）
const WANDER_DEG = 2.5;                  // 字的微幅旋轉（度）
const WANDER_HZ = [0.12, 0.35];          // 游移的快慢（每秒幾次）
const PART_PX = 1.2;                     // 眼睛、嘴巴游移的距離（元件頁的單位，約 2px）
const PART_SCALE = 0.05;                 // 眼睛、嘴巴大小的變化（±5%）
const PART_DEG = 6;                      // 眼睛、嘴巴角度的變化（度）
const PART_HZ = [0.25, 0.7];

/* ---------- 點擊 ---------- */
const BLINK_CLOSE = 90;                  // 舊的眼睛閉上（高度變成 0）要多久（毫秒）
const BLINK_OPEN = 140;                  // 新的眼睛張開要多久（毫秒）
const BLINK_LAG = [30, 110];             // 兩隻眼睛隨機一前一後，相差多少毫秒（每次點擊在這個範圍內隨機）
const COLOR_FADE = 300;                  // 漸層換顏色要多久（毫秒）

const GRAIN_SIZE = 0.5, GRAIN_AMOUNT = 0.175;   // 顆粒（和其他段落一樣）

const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = x => x * x * (3 - 2 * x);
const hex = h => { const v = parseInt(h.slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
const rnd = ([a, b]) => a + Math.random() * (b - a);
const center = box => [box[0] + box[2] / 2, box[1] + box[3] / 2];
const rotate = ([x, y], deg) => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [x * c - y * s, x * s + y * c]; };

// 彈進場：大小 0.75 → 約 1.11 → 約 0.96 → 1；k = 大小、a = 透明度
const popIn = ms => {
  if (ms <= 0) return { k: POP_FROM, a: 0 };
  const u = ms / POP;
  const k = u >= 1 ? 1 : 1 - (1 - POP_FROM) * Math.exp(-POP_BOUNCE * u) * Math.cos(POP_WAVES * Math.PI * u) * (1 - u ** 4);
  return { k, a: smooth(clamp01(ms / POP_FADE)) };
};
const shuffled = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// 一組緩慢、自然的隨機擺動（-1 ~ 1）
const wobble = hz => {
  const a = { f: rnd(hz), p: Math.random() * 6.283 }, b = { f: rnd(hz) * 1.7, p: Math.random() * 6.283 };
  return t => 0.6 * Math.sin(6.283 * a.f * t + a.p) + 0.4 * Math.sin(6.283 * b.f * t + b.p);
};
const pickColors = not => {
  for (;;) {
    const i = (Math.random() * COLORS.length) | 0;
    let j = (Math.random() * (COLORS.length - 1)) | 0; if (j >= i) j++;
    const pair = [COLORS[i], COLORS[j]];
    if (!not || pair[0] !== not[0] || pair[1] !== not[1]) return pair;
  }
};

export default {
  name: 'word',
  needs: { camera: true },
  dev: { from: START, to: 43210 },

  async preload(stage) {
    this.canvas = stage.canvas({ dpr: Math.min(2, window.devicePixelRatio || 1) });
    this.gl = wordLayer(this.canvas);
    if (!this.gl) { console.warn('word：這個瀏覽器不支援 WebGL'); return; }
    try { this.gl.setLut(parseCube(await stage.file(LUT_FILE))); }
    catch (err) { console.warn('word：調色檔沒有套用', err); }

    // 形狀先畫成貼圖（照最大可能的大小畫，放大縮小都清楚）
    const k = SIZE * 1.45 * Math.min(2, window.devicePixelRatio || 1) * 1.15;
    const sprite = piece => this.gl.addSprite(piece, k);
    const half = s => Math.hypot(s.w2, s.h2) / 2;   // 貼圖對角線的一半（退場時算什麼時候掉出畫面）
    this.chars = CHARS.map(c => {
      const shapeS = sprite(c.shape), mouthS = sprite(c.mouth);
      return {
        ...c, sc: center(c.shape.box), shapeS, mouthS, R: half(shapeS), mouthR: half(mouthS),
        path: new Path2D(c.shape.d.join(' ')),      // 判斷有沒有點到這個字
      };
    });
    this.eyes = EYES.map(set => {
      const L = set.L.box, R = set.R.box;
      const x0 = Math.min(L[0], R[0]), y0 = Math.min(L[1], R[1]);
      const x1 = Math.max(L[0] + L[2], R[0] + R[2]), y1 = Math.max(L[1] + L[3], R[1] + R[3]);
      const mid = [(x0 + x1) / 2, (y0 + y1) / 2];
      return { rot: set.rot, parts: [set.L, set.R].map(e => ({ s: sprite(e), off: rotate([center(e.box)[0] - mid[0], center(e.box)[1] - mid[1]], set.rot) })) };
    });
    // 眼睛：兩隻眼睛中心離這組中心的距離 + 自己的半徑，取八組裡最大的
    this.eyeR = Math.max(...this.eyes.flatMap(set => set.parts.map(p => Math.hypot(p.off[0], p.off[1]) + half(p.s))));
    this.hitCtx = document.createElement('canvas').getContext('2d');
    stage.root.addEventListener('pointerdown', e => this.tap(stage, e));
    this.reset();
  },

  // 每次進場：眼睛隨機兩組不重複、漸層回到 Figma 的顏色、游移重新隨機
  reset() {
    if (!this.chars) return;
    const first = (Math.random() * EYES.length) | 0;
    let second = (Math.random() * (EYES.length - 1)) | 0; if (second >= first) second++;
    this.state = this.chars.map((c, i) => ({
      eye: { cur: i ? second : first, next: null, t0: 0, lag: [0, 0] },
      col: { from: c.colors, to: c.colors, t0: 0 },
      wx: wobble(WANDER_HZ), wy: wobble(WANDER_HZ), wr: wobble(WANDER_HZ),
      parts: [0, 1, 2].map(() => ({ x: wobble(PART_HZ), y: wobble(PART_HZ), s: wobble(PART_HZ), r: wobble(PART_HZ) })),
    }));
    // 退場：八個東西各自什麼時候開始掉（佔 OUT_DUR 的比例）；順序隨機，間隔也稍微不規則
    // 編號：文 0–3、體 4–7（各自是 外形、嘴巴、左眼、右眼）
    const n = this.chars.length * 4, rank = shuffled([...Array(n).keys()]);
    this.fall = [...Array(n).keys()].map(k => {
      const dir = Math.random() < 0.5 ? -1 : 1, m = k % 4 ? PART_SPIN : 1;   // 往左倒或往右倒；符號轉得比較快
      return {
        at: (rank.indexOf(k) + Math.random() * 0.8) / n * FALL_SPREAD,
        spin: dir * rnd(FALL_SPIN) * m, spinAcc: dir * rnd(FALL_SPIN_ACC) * m,
        drift: dir * rnd(FALL_DRIFT), driftAcc: dir * rnd(FALL_DRIFT_ACC),
      };
    });
  },

  enter() { this.reset(); },

  layout(stage) {
    const W = stage.width, H = stage.height;
    const s = Math.max(0.82, Math.min(1.45, Math.min(W / 388, H / 743)));   // 和其他段落一樣依畫面縮放
    return { W, H, s, ox: W / 2 - 194 * s, oy: H / 2 - 371.5 * s };
  },

  // 字現在的位置、角度、大小（每個元件頁單位是幾個 CSS px）
  pose(i, L, ms, t) {
    const c = this.chars[i], st = this.state[i];
    const pi = popIn(ms - c.popAt), k = pi.k;
    return {
      k, a: pi.a,
      x: L.ox + (c.at[0] + WANDER_PX * st.wx(t)) * L.s,
      y: L.oy + (c.at[1] + WANDER_PX * st.wy(t)) * L.s,
      rot: c.rot + WANDER_DEG * st.wr(t),
      scale: SIZE * L.s * k,
    };
  },

  colorsOf(st, now) {
    const u = smooth(clamp01((now - st.col.t0) / COLOR_FADE));
    return [0, 1].map(j => { const a = hex(st.col.from[j]), b = hex(st.col.to[j]); return a.map((v, n) => v + (b[n] - v) * u); });
  },

  update(stage, f) {
    if (!this.gl || !this.state) return;
    const ms = f.t * 1000, t = f.t, now = performance.now();
    this.ms = ms;
    const L = this.layout(stage);
    this.L = L;
    const sprites = [];
    const camMix = smooth(clamp01((ms - CAM_AT) / CAM_FADE)) * (1 - smooth(clamp01((ms - OUT_AT) / OUT_DUR)));   // 字裡面的鏡頭露出來多少

    // 退場：重力加速度取「最慢的那一個剛好在 GONE 掉出畫面」（會轉，所以用對角線的一半當作半徑，再多留一點游移的空間）
    const T = OUT_DUR / 1000, S = SIZE * L.s;
    let g = 0;
    this.chars.forEach((c, i) => {
      const y0 = L.oy + c.at[1] * L.s, mc = center(c.mouth.box);
      [[0, c.R], [mc[1] - c.sc[1], c.mouthR], [c.eyes[1], this.eyeR], [c.eyes[1], this.eyeR]].forEach(([oy, r], j) => {
        const y = y0 + oy * S, R = r * S + (WANDER_PX + 6) * L.s, left = T * (1 - this.fall[i * 4 + j].at);
        g = Math.max(g, 2 * (L.H + R - y) / (left * left));
      });
    });
    // 第 n 個東西已經掉了多少：位移、自轉；掉出畫面就不畫
    const add = (sp, n) => {
      const fl = this.fall[n], k = Math.max(0, (ms - OUT_AT) / 1000 - fl.at * T);   // 這一個掉了幾秒
      if (k > 0) {
        sp.x += fl.drift * k + 0.5 * fl.driftAcc * k * k;
        sp.y += 0.5 * g * k * k;
        sp.rot += (fl.spin * k + 0.5 * fl.spinAcc * k * k) * Math.PI / 180;
        if (sp.y - Math.hypot(sp.s.w2 * sp.sx, sp.s.h2 * sp.sy) / 2 > L.H) return;   // 已經掉出畫面
      }
      sprites.push(sp);
    };

    this.chars.forEach((c, i) => {
      const P = this.pose(i, L, ms, t), st = this.state[i];
      if (P.a <= 0.001) return;
      const [c1, c2] = this.colorsOf(st, now);
      const place = (off, s, rot, sx = 1, sy = 1) => {
        const [dx, dy] = rotate(off, P.rot);
        return { s, x: P.x + dx * P.scale, y: P.y + dy * P.scale, rot: rot * Math.PI / 180, sx: P.scale * sx, sy: P.scale * sy, a: P.a };
      };
      // 外形（漸層 + 灰階鏡頭柔光）
      add({ ...place([0, 0], c.shapeS, P.rot), c1, c2, cam: true }, i * 4);
      // 嘴巴、兩個眼睛：各自稍微游移
      const part = (n, off, s, baseRot, sy = 1) => {
        const w = st.parts[n], k = 1 + PART_SCALE * w.s(t);
        return place([off[0] + PART_PX * w.x(t), off[1] + PART_PX * w.y(t)], s, P.rot + baseRot + PART_DEG * w.r(t), k, k * sy);
      };
      const mc = center(c.mouth.box);
      add(part(0, [mc[0] - c.sc[0], mc[1] - c.sc[1]], c.mouthS, 0), i * 4 + 1);
      // 眼睛：眨眼換一組（舊的高度變成 0，新的從 0 長回來）；兩隻眼睛各自晚 lag 毫秒開始
      const e = st.eye;
      if (e.next != null && now - e.t0 >= BLINK_CLOSE + BLINK_OPEN + Math.max(e.lag[0], e.lag[1])) { e.cur = e.next; e.next = null; }
      for (let n = 0; n < 2; n++) {
        let set = e.cur, sy = 1;
        if (e.next != null) {
          const el = now - e.t0 - e.lag[n];
          if (el >= BLINK_CLOSE + BLINK_OPEN) set = e.next;
          else if (el >= BLINK_CLOSE) { set = e.next; sy = smooth((el - BLINK_CLOSE) / BLINK_OPEN); }
          else if (el > 0) sy = 1 - smooth(el / BLINK_CLOSE);
        }
        const ES = this.eyes[set], p = ES.parts[n];
        add(part(n + 1, [c.eyes[0] + p.off[0], c.eyes[1] + p.off[1]], p.s, ES.rot, Math.max(0.001, sy)), i * 4 + 2 + n);
      }
    });

    this.gl.draw(stage.camera, L, sprites, camMix * CHAR_CAM);
  },

  // 點到文或體：換眼睛、換漸層（體畫在上面，先檢查體）
  tap(stage, e) {
    if (!this.state || !this.L || this.ms >= OUT_AT) return;
    const r = stage.root.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top, now = performance.now();
    for (let i = this.chars.length - 1; i >= 0; i--) {
      const c = this.chars[i], P = this.pose(i, this.L, this.ms, this.ms / 1000);
      if (P.a < 0.5) continue;                       // 還沒出現
      const [lx, ly] = rotate([(px - P.x) / P.scale, (py - P.y) / P.scale], -P.rot);
      if (!this.hitCtx.isPointInPath(c.path, lx + c.sc[0], ly + c.sc[1])) continue;
      const st = this.state[i], ey = st.eye;
      // 眼睛：選一組兩個字現在都沒在用的
      if (ey.next != null && now - ey.t0 >= BLINK_CLOSE + Math.max(ey.lag[0], ey.lag[1])) ey.cur = ey.next;   // 兩隻都在張開了：新眼睛直接算數
      const used = new Set(this.state.flatMap(s => [s.eye.cur, s.eye.next]).filter(v => v != null));
      const free = EYES.map((_, k) => k).filter(k => !used.has(k));
      ey.next = free[(Math.random() * free.length) | 0];
      ey.t0 = now;
      const lag = rnd(BLINK_LAG);
      ey.lag = Math.random() < 0.5 ? [0, lag] : [lag, 0];   // 隨機哪一隻先眨
      // 漸層：從現在的顏色換到新的兩個顏色
      const cur = this.colorsOf(st, now);
      st.col = { from: cur.map(v => '#' + v.map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('')), to: pickColors(st.col.to), t0: now };
      return;
    }
  },
};

/* ---------- WebGL：#313131 背景 + 貼圖的形狀（字裡面疊灰階鏡頭），全部加顆粒 ---------- */
function wordLayer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false });
  if (!gl) return null;
  const head = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes, uSeed;
uniform float uGrain, uGrainPx;
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float grain(){ return (hash(floor(gl_FragCoord.xy / uGrainPx) + uSeed) - 0.5) * uGrain; }
`;
  const triVS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  // 1. 背景：#313131 + 顆粒
  const bgFS = head + `
uniform vec3 uBg;
void main(){
  gl_FragColor = vec4(clamp(uBg + grain(), 0.0, 1.0), 1.0);
}`;
  // 2. 形狀：會轉的方塊貼形狀的圖；外形用漸層（上 → 下），上面用柔光疊灰階的鏡頭畫面（不模糊）；眼睛嘴巴用 #313131
  const sprVS = `
attribute vec2 p;
uniform vec2 uRes, uC, uHalf, uRot;
varying vec2 vUV;
void main(){
  vec2 d = (p * 2.0 - 1.0) * uHalf;
  vec2 px = uC + vec2(d.x * uRot.x - d.y * uRot.y, d.x * uRot.y + d.y * uRot.x);
  vUV = p;
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
}`;
  const sprFS = head + LUT_GLSL + `
uniform sampler2D uTex, uCam;
uniform vec3 uC1, uC2;
uniform vec2 uGrad, uCamScale;
uniform float uAlpha, uCamMix, uHasLut;
varying vec2 vUV;
// 柔光（和 Figma、Photoshop 的 soft light 一樣）：b 是下面的漸層，s 是上面的灰階鏡頭
vec3 softLight(vec3 b, vec3 s){
  vec3 d = mix(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25)));
  return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
}
void main(){
  float a = texture2D(uTex, vUV).a * uAlpha;
  if (a <= 0.0) discard;
  vec3 c = mix(uC1, uC2, clamp((vUV.y - uGrad.x) / uGrad.y, 0.0, 1.0));
  if (uCamMix > 0.0) {
    // 鏡頭畫面在這個像素的位置（和背景一樣 cover、左右鏡像，所以字像一扇窗）
    vec2 t = (gl_FragCoord.xy / uRes - 0.5) * uCamScale + 0.5;
    vec3 v = texture2D(uCam, vec2(1.0 - t.x, 1.0 - t.y)).rgb;
    if (uHasLut > 0.5) v = lut(v);
    float y = dot(v, vec3(0.2126, 0.7152, 0.0722));            // 灰階
    c = mix(c, softLight(c, vec3(y)), uCamMix);
  }
  c = clamp(c + grain(), 0.0, 1.0);
  gl_FragColor = vec4(c * a, a);
}`;
  const sh = (type, src) => {
    const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
    return o;
  };
  const program = (vsrc, fsrc) => {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsrc));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsrc));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const U = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let k = 0; k < n; k++) { const name = gl.getActiveUniform(p, k).name; U[name] = gl.getUniformLocation(p, name); }
    return { p, U };
  };
  let P;
  try {
    P = { bg: program(triVS, bgFS), spr: program(sprVS, sprFS) };
  } catch (err) { console.warn('word shader 失敗', err); return null; }

  const buf = data => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
  const triBuf = buf(new Float32Array([-1, -1, 3, -1, -1, 3]));
  const quadBuf = buf(new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));
  gl.enableVertexAttribArray(0);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const newTex = (unit, filter) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    return t;
  };
  // 貼圖單元：0 鏡頭、1 調色、3 形狀
  const camTex = newTex(0, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(3));
  let lutTex = null, hasLut = false;
  const BG = hex(BG_COLOR), INK = hex(BG_COLOR);
  let texW = 0, texH = 0, fresh = true, watching = null;
  const watch = v => {
    if (watching === v || !v.requestVideoFrameCallback) return;
    watching = v;
    const cb = () => { fresh = true; v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
  };
  const use = (pr, w, h, d, seed) => {
    gl.useProgram(pr.p);
    const U = pr.U;
    if (U.uRes) gl.uniform2f(U.uRes, w, h);
    if (U.uSeed) gl.uniform2f(U.uSeed, seed[0], seed[1]);
    if (U.uGrain) gl.uniform1f(U.uGrain, GRAIN_AMOUNT);
    if (U.uGrainPx) gl.uniform1f(U.uGrainPx, Math.max(1, GRAIN_SIZE * d));
    return U;
  };
  const tri = () => { gl.bindBuffer(gl.ARRAY_BUFFER, triBuf); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 3); };

  return {
    setLut(L) {
      gl.useProgram(P.spr.p);                         // 字裡面的鏡頭套調色
      lutTex = uploadLut(gl, P.spr.p, L, 1, lutTex);
      hasLut = true;
    },
    // 把一個形狀畫成貼圖（白色，透明度就是形狀）；k：每個元件頁單位畫幾個像素
    addSprite(piece, k) {
      const PAD = 2, [x, y, w, h] = piece.box;
      const c = document.createElement('canvas');
      c.width = Math.ceil((w + PAD * 2) * k); c.height = Math.ceil((h + PAD * 2) * k);
      const g = c.getContext('2d');
      g.scale(c.width / (w + PAD * 2), c.height / (h + PAD * 2));
      g.translate(PAD - x, PAD - y);
      g.fillStyle = '#fff';
      for (const d of piece.d) g.fill(new Path2D(d));
      const tex = newTex(3, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      // w2, h2：整張圖（含留白）的大小；grad：形狀本身在圖裡的上下範圍（漸層用）
      return { tex, w2: w + PAD * 2, h2: h + PAD * 2, grad: [PAD / (h + PAD * 2), h / (h + PAD * 2)] };
    },
    // camMix：字裡面的鏡頭有多明顯（0–1）
    draw(video, L, sprites, camMix = 0) {
      if (gl.isContextLost()) return;
      const w = canvas.width, h = canvas.height, d = w / L.W;
      const seed = [Math.random() * 1000, Math.random() * 1000];
      const hasCam = !!(video && video.videoWidth > 0) && camMix > 0;   // 字裡面看不到鏡頭的時候就不更新鏡頭畫面
      let camScale = [1, 1];
      if (hasCam) {
        // 鏡頭畫面 → 貼圖（有新的一格才更新）
        watch(video);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, camTex);
        const vw = video.videoWidth, vh = video.videoHeight;
        if (fresh || !video.requestVideoFrameCallback) {
          if (vw !== texW || vh !== texH) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video); texW = vw; texH = vh; }
          else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, video);
          fresh = false;
        }
        const A = L.W / L.H, V = vw / vh;              // 像 cover 一樣鋪滿整個畫面
        camScale = [A > V ? 1 : A / V, A > V ? V / A : 1];
      }
      // 背景：#313131 + 顆粒
      gl.disable(gl.BLEND);
      gl.viewport(0, 0, w, h);
      let U = use(P.bg, w, h, d, seed);
      gl.uniform3fv(U.uBg, BG);
      tri();
      // 形狀
      gl.enable(gl.BLEND);
      U = use(P.spr, w, h, d, seed);
      gl.uniform1i(U.uTex, 3);
      gl.uniform1i(U.uCam, 0);                       // 鏡頭的貼圖還在單元 0、調色在單元 1
      if (U.uLut) gl.uniform1i(U.uLut, 1);
      gl.uniform1f(U.uHasLut, hasLut ? 1 : 0);
      gl.uniform2f(U.uCamScale, camScale[0], camScale[1]);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      for (const sp of sprites) {
        const s = sp.s;
        gl.bindTexture(gl.TEXTURE_2D, s.tex);
        gl.uniform2f(U.uC, sp.x * d, sp.y * d);
        gl.uniform2f(U.uHalf, s.w2 * sp.sx * d / 2, s.h2 * sp.sy * d / 2);
        gl.uniform2f(U.uRot, Math.cos(sp.rot), Math.sin(sp.rot));
        gl.uniform3fv(U.uC1, sp.c1 || INK);
        gl.uniform3fv(U.uC2, sp.c2 || INK);
        gl.uniform2f(U.uGrad, s.grad[0], s.grad[1]);
        gl.uniform1f(U.uAlpha, sp.a == null ? 1 : sp.a);
        gl.uniform1f(U.uCamMix, hasCam && sp.cam ? camMix : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    },
  };
}
