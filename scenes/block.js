/* ==========================================================================
   block — 打磚塊
   --------------------------------------------------------------------------
   70552 ms   接在 slit 最後的畫面之後（#313131 上直排的「看故事謎底玩解讀遊戲」，位置一模一樣）：
              ・每一個字從原本的位置，隨機朝畫面周圍的方向飛出去，各自有一個隨機的等速（有快有慢），帶著自轉。
              ・所有字都飛離畫面中心之後，畫面中間長出一個 215 × 215 的方塊（Figma Page 1），
                由許多 5 × 5 px 的小方塊組成，每個小方塊隨機淡入，一秒內全部出現。
              ・每個小方塊取樣當下位置的鏡頭顏色，帶亂數偏移，一秒重新取樣 25 次（和 mandalaCam 一樣）。
              ・字碰到畫面邊緣會反彈；碰到中間的方塊會擊碎一些小方塊再反彈（碎片會噴開、落下、淡掉）；
                字和字碰到也會互相反彈。反彈之後每個字還是維持自己的速度。
   背景和所有東西都加上和其他畫面一樣的顆粒。
   ========================================================================== */

/* ---------- 可以調整的數字 ---------- */
const START = 70552;                     // 開始（毫秒；字從這一刻開始飛）
const BG_COLOR = '#313131';
// 字（和 slit 最後的背景一樣：BIZ UDPMincho 22px、行高 27px、#F8EFCE，直排在畫面正中央；空字串 = 空一行）
const LINES = ['看', '故', '事', '謎', '底', '', '玩', '解', '讀', '遊', '戲'];
const FONT_SIZE = 22, LINE_HEIGHT = 27, FONT = '"BIZ UDPMincho"', TEXT_COLOR = '#f8efce';
const SPEED = [240, 480];                // 每個字的速度（px/秒，隨機在這個範圍內，一直維持不變）
const SPIN = [40, 140];                  // 自轉速度（度/秒，方向隨機）
const SPREAD = 70;                       // 飛出去的方向：從畫面中心往外的方向左右隨機偏多少度
const HIT_RADIUS = 0.45;                 // 碰撞半徑（字的大小的幾倍）

// 中間的方塊（Figma：215 × 215，畫面正中央）
const SQUARE = 215;                      // 邊長（以 Figma 388 寬的畫面計，跟著畫面縮放）
const CELL = 5;                          // 小方塊的大小（px）
const INTRO = 1000;                      // 所有小方塊出現完的時間（毫秒）
const CELL_FADE = 150;                   // 每個小方塊淡入花多久（毫秒）
const RESAMPLE = 25;                     // 每秒重新取樣幾次鏡頭顏色
const SCATTER = 0.07;                    // 亂數取樣的範圍（鏡頭畫面長邊的比例；和 mandalaCam 一樣）

// 擊碎
const BREAK_RADIUS = 22;                 // 碰到的地方周圍多遠的小方塊也有機會一起碎掉（px）；平均一次碎掉約 10 格
const BREAK_CHANCE = 0.55;               // 周圍的小方塊碎掉的機率
const DEBRIS_SPEED = [40, 140];          // 碎片噴開的速度（px/秒）
const DEBRIS_GRAVITY = 420;              // 碎片往下掉的重力（px/秒²）
const DEBRIS_LIFE = 0.7;                 // 碎片多久淡掉（秒）

// 顆粒（和其他畫面一樣）
const GRAIN_SIZE = 0.5, GRAIN_AMOUNT = 0.175;

const STEP = 1 / 240;                    // 物理每一步的時間（秒；字很快，步子要小才不會穿過方塊）

const hex = h => { const v = parseInt(h.slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
const clamp01 = x => Math.max(0, Math.min(1, x));
const rnd = ([a, b]) => a + Math.random() * (b - a);

export default {
  name: 'block',
  needs: { camera: true },
  dev: { from: START, to: 90000 },

  async preload(stage) {
    await stage.font(`${FONT_SIZE}px ${FONT}`, LINES.join(''));
    this.canvas = stage.canvas({ dpr: Math.min(2, window.devicePixelRatio || 1) });   // 和 slit 一樣的解析度，接起來才看不出差別
    this.gl = blockLayer(this.canvas);
    if (!this.gl) console.warn('這個瀏覽器不支援 WebGL，block 不會出現');
    this.chars = LINES.map((ch, i) => ({ ch, i })).filter(c => c.ch);
  },

  enter(stage, f) {
    this.reset(stage);
    this.simT = 0;
    this.lastMs = f ? f.t * 1000 : START;
  },

  resize(stage) { this.L = null; this.needReset = true; },

  // 版面：字的大小跟著畫面縮放（和載入畫面、slit 最後的背景一樣）
  layout(stage) {
    const W = stage.width, H = stage.height;
    if (this.L && this.L.W === W && this.L.H === H) return this.L;
    const s = Math.max(0.82, Math.min(1.45, Math.min(W / 388, H / 743)));
    const size = Math.max(CELL, Math.round(SQUARE * s / CELL) * CELL);
    const n = size / CELL;
    this.L = { W, H, s, n, size, x: Math.round((W - size) / 2), y: Math.round((H - size) / 2), font: FONT_SIZE * s, lh: LINE_HEIGHT * s };
    if (this.gl) this.gl.setGlyphs(this.chars.map(c => c.ch), this.L.font, this.canvas.width / W);
    return this.L;
  },

  // 回到一開始的樣子：字在 slit 最後的位置、方塊還沒出現
  reset(stage) {
    const L = this.layout(stage), n = LINES.length;
    this.bodies = this.chars.map(c => {
      const x = L.W / 2, y = L.H / 2 + (c.i - (n - 1) / 2) * L.lh;
      // 從畫面中心往外的方向（直排在中線上，所以是往上或往下），再左右隨機偏一點
      const out = y < L.H / 2 ? -Math.PI / 2 : Math.PI / 2;
      const a = out + (Math.random() * 2 - 1) * SPREAD * Math.PI / 180;
      const sp = rnd(SPEED);
      return {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, speed: sp,
        rot: 0, spin: (Math.random() < 0.5 ? -1 : 1) * rnd(SPIN) * Math.PI / 180,
        r: L.font * HIT_RADIUS, ghost: true,     // ghost：還在方塊範圍裡，先不和方塊碰撞
      };
    });
    // 小方塊：每一格什麼時候淡入、還在不在
    const N = L.n * L.n;
    this.delay = new Float32Array(N);
    this.alive = new Uint8Array(N).fill(1);
    for (let k = 0; k < N; k++) this.delay[k] = Math.random() * (INTRO - CELL_FADE);
    this.debris = [];
    this.growAt = null;                      // 所有字都離開方塊範圍的時間（秒）：方塊從這時開始長出來
    if (this.gl) this.gl.setCells(L.n, this.delay, this.alive, INTRO - CELL_FADE);
  },

  update(stage, f) {
    if (!this.gl) return;
    const ms = f ? f.t * 1000 : START;
    const L = this.layout(stage);
    if (this.needReset) { this.needReset = false; if (!this.bodies || L.n * L.n !== this.alive.length) { this.reset(stage); this.simT = 0; } }
    // 開發時拖時間：往回跳就重來，往前跳就快轉
    if (ms < this.lastMs - 500) { this.reset(stage); this.simT = 0; }
    this.lastMs = ms;
    const target = Math.max(0, (ms - START) / 1000);
    let guard = 0;
    while (this.simT + STEP <= target && guard++ < 20000) { this.step(L, STEP); this.simT += STEP; }

    const v = stage.camera;
    this.gl.draw(v && v.videoWidth > 0 ? v : null, L, this.simT * 1000, this.cellMs(), this.bodies, this.debris);
  },

  // 方塊長出來之後過了幾毫秒（還沒開始就是負的）
  cellMs() { return this.growAt == null ? -1e9 : (this.simT - this.growAt) * 1000; },

  /* ---------- 物理一步 ---------- */
  step(L, dt) {
    const B = this.bodies, tms = this.cellMs();
    for (const b of B) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.spin * dt;
      // 畫面邊緣：反彈
      if (b.x < b.r && b.vx < 0) { b.x = b.r; b.vx = -b.vx; }
      if (b.x > L.W - b.r && b.vx > 0) { b.x = L.W - b.r; b.vx = -b.vx; }
      if (b.y < b.r && b.vy < 0) { b.y = b.r; b.vy = -b.vy; }
      if (b.y > L.H - b.r && b.vy > 0) { b.y = L.H - b.r; b.vy = -b.vy; }
      // 中間的方塊
      if (b.ghost) {
        const dx = Math.max(L.x - b.x, 0, b.x - (L.x + L.size)), dy = Math.max(L.y - b.y, 0, b.y - (L.y + L.size));
        if (dx * dx + dy * dy > b.r * b.r) b.ghost = false;      // 整個飛出方塊外了
      } else this.hitCells(L, b, tms);
    }
    // 所有字都飛出方塊範圍了：方塊開始長出來
    if (this.growAt == null && B.every(b => !b.ghost)) this.growAt = this.simT;
    // 字和字：互相反彈（等質量的彈性碰撞，再把速度調回各自的速度）
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
      if (d >= min || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d, rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel > 0) {
        a.vx -= rel * nx; a.vy -= rel * ny; b.vx += rel * nx; b.vy += rel * ny;
        keepSpeed(a); keepSpeed(b);
      }
      const push = (min - d) / 2;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    }
    // 碎片
    const D = this.debris;
    for (let k = D.length - 1; k >= 0; k--) {
      const p = D[k];
      p.vy += DEBRIS_GRAVITY * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt / DEBRIS_LIFE;
      if (p.life <= 0 || p.y > L.H + CELL) { D[k] = D[D.length - 1]; D.pop(); }
    }
  },

  // 字碰到小方塊：碰到的那幾格和周圍的一些格子碎掉，字反彈
  hitCells(L, b, tms) {
    const n = L.n, C = CELL;
    const i0 = Math.max(0, Math.floor((b.x - b.r - L.x) / C)), i1 = Math.min(n - 1, Math.floor((b.x + b.r - L.x) / C));
    const j0 = Math.max(0, Math.floor((b.y - b.r - L.y) / C)), j1 = Math.min(n - 1, Math.floor((b.y + b.r - L.y) / C));
    if (i0 > i1 || j0 > j1) return;
    let sx = 0, sy = 0, hits = 0, cx = 0, cy = 0;
    const broken = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i;
      if (!this.alive[k] || tms < this.delay[k] + CELL_FADE * 0.5) continue;   // 還沒淡入的不算
      const x0 = L.x + i * C, y0 = L.y + j * C;
      const px = Math.max(x0, Math.min(b.x, x0 + C)), py = Math.max(y0, Math.min(b.y, y0 + C));
      let dx = b.x - px, dy = b.y - py;
      if (dx * dx + dy * dy >= b.r * b.r) continue;
      if (dx === 0 && dy === 0) { dx = b.x - (x0 + C / 2); dy = b.y - (y0 + C / 2); }
      sx += dx; sy += dy; cx += px; cy += py; hits++;
      broken.push(k);
    }
    if (!hits) return;
    cx /= hits; cy /= hits;
    // 碰到的地方周圍的格子，有機率一起碎掉
    const R = BREAK_RADIUS;
    const a0 = Math.max(0, Math.floor((cx - R - L.x) / C)), a1 = Math.min(n - 1, Math.floor((cx + R - L.x) / C));
    const b0 = Math.max(0, Math.floor((cy - R - L.y) / C)), b1 = Math.min(n - 1, Math.floor((cy + R - L.y) / C));
    for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
      const k = j * n + i;
      if (!this.alive[k] || broken.includes(k) || tms < this.delay[k] + CELL_FADE * 0.5) continue;
      const ex = L.x + (i + 0.5) * C - cx, ey = L.y + (j + 0.5) * C - cy;
      if (ex * ex + ey * ey < R * R && Math.random() < BREAK_CHANCE) broken.push(k);
    }
    for (const k of broken) {
      this.alive[k] = 0;
      const i = k % n, j = (k / n) | 0;
      const x = L.x + (i + 0.5) * C, y = L.y + (j + 0.5) * C;
      let ux = x - cx, uy = y - cy;
      const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      // 碎片往遠離字的方向噴開（加一點字的速度和亂數）
      const sp = rnd(DEBRIS_SPEED), ang = (Math.random() - 0.5) * 1.2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      this.debris.push({
        x, y, life: 1, seed: Math.random() * 1000,
        vx: (ux * ca - uy * sa) * sp - b.vx * 0.25, vy: (ux * sa + uy * ca) * sp - b.vy * 0.25,
      });
    }
    this.gl.killCells(broken);
    // 反彈：往碰到的那一面的法線方向反射，速度不變
    const nl = Math.hypot(sx, sy);
    if (nl > 0) {
      const nx = sx / nl, ny = sy / nl, vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; keepSpeed(b); }
    }
  },
};

function keepSpeed(b) {
  const v = Math.hypot(b.vx, b.vy) || 1;
  b.vx *= b.speed / v; b.vy *= b.speed / v;
}

/* ---------- WebGL ---------- */
function blockLayer(canvas) {
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
  // 鏡頭：像 cover 一樣鋪滿整個畫面、左右鏡像；在位置附近亂數取樣（三角分布，和 mandalaCam 一樣）
  const camGLSL = `
uniform sampler2D uCam;
uniform vec2 uCamScale, uSpread;
uniform float uHasCam, uTick;
vec4 hash43(vec3 p){ vec4 q = fract(vec4(p.xyzx) * vec4(.1031, .1030, .0973, .1099)); q += dot(q, q.wzxy + 33.33); return fract((q.xxyz + q.yzzw) * q.zywx); }
vec3 camAt(vec2 dev, vec2 seed){
  if (uHasCam < 0.5) return vec3(0.0);
  vec2 t = (dev / uRes - 0.5) * uCamScale + 0.5;
  t.x = 1.0 - t.x;
  vec4 r = hash43(vec3(seed, uTick));
  t += vec2(r.x + r.y - 1.0, r.z + r.w - 1.0) * uSpread;
  return texture2D(uCam, clamp(t, vec2(0.001), vec2(0.999))).rgb;
}
`;
  // 背景
  const bgVS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const bgFS = head + `
uniform vec3 uBg;
void main(){ gl_FragColor = vec4(clamp(uBg + grain(), 0.0, 1.0), 1.0); }`;
  // 方塊：一個矩形，裡面每 5px 一格
  const rectVS = `
attribute vec2 p;
uniform vec2 uRes;
uniform vec4 uRect;
void main(){ vec2 px = uRect.xy + p * uRect.zw; gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0); }`;
  const cellFS = head + camGLSL + `
uniform sampler2D uState;
uniform vec4 uRect;
uniform float uN, uCellPx, uT, uFade, uIntro;
void main(){
  vec2 dev = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 cell = floor((dev - uRect.xy) / uCellPx);
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uN || cell.y >= uN) discard;
  vec4 st = texture2D(uState, (cell + 0.5) / uN);                  // g：淡入時間；b：還在不在
  float a = st.b * clamp((uT - st.g * uIntro) / uFade, 0.0, 1.0);
  if (a <= 0.0) discard;
  vec3 c = camAt(uRect.xy + (cell + 0.5) * uCellPx, cell);
  c = clamp(c + grain(), 0.0, 1.0);
  gl_FragColor = vec4(c * a, a);
}`;
  // 碎片：一個點 = 一個 5px 的小方塊
  const ptVS = `
attribute vec4 p;            // x, y（裝置像素）、透明度、亂數
uniform vec2 uRes;
uniform float uCellPx;
varying vec3 vInfo;
void main(){
  vInfo = vec3(p.z, p.w, 0.0);
  gl_PointSize = uCellPx;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}`;
  const ptFS = head + camGLSL + `
varying vec3 vInfo;
void main(){
  vec2 dev = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 c = clamp(camAt(dev, vec2(vInfo.y, 7.0)) + grain(), 0.0, 1.0);
  gl_FragColor = vec4(c * vInfo.x, vInfo.x);
}`;
  // 字：每個字一個會轉的方塊，貼字的圖
  const charVS = `
attribute vec2 p;
uniform vec2 uRes, uC, uRot;
uniform float uG, uIdx, uCount;
varying vec2 vUV;
void main(){
  vec2 d = (p - 0.5) * uG;
  vec2 px = uC + vec2(d.x * uRot.x - d.y * uRot.y, d.x * uRot.y + d.y * uRot.x);
  vUV = vec2((uIdx + p.x) / uCount, p.y);
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
}`;
  const charFS = head + `
uniform sampler2D uGlyph;
uniform vec3 uFg;
varying vec2 vUV;
void main(){
  float a = texture2D(uGlyph, vUV).a;
  if (a <= 0.0) discard;
  vec3 c = clamp(uFg + grain(), 0.0, 1.0);
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
    P = { bg: program(bgVS, bgFS), cell: program(rectVS, cellFS), pt: program(ptVS, ptFS), ch: program(charVS, charFS) };
  } catch (err) { console.warn('block shader 失敗', err); return null; }

  const buf = data => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
  const triBuf = buf(new Float32Array([-1, -1, 3, -1, -1, 3]));
  const quadBuf = buf(new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));
  const ptBuf = gl.createBuffer();
  let ptData = new Float32Array(4 * 256);
  gl.enableVertexAttribArray(0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const tex = (unit, filter) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    return t;
  };
  const camTex = tex(0, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(3));
  const stateTex = tex(1, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const glyphTex = tex(2, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

  const BG = hex(BG_COLOR), FG = hex(TEXT_COLOR);
  let state = null, stateN = 0, glyphG = 0, glyphCount = 1;

  let texW = 0, texH = 0, fresh = true, watching = null;
  const watch = v => {
    if (watching === v || !v.requestVideoFrameCallback) return;
    watching = v;
    const cb = () => { fresh = true; v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
  };
  const common = (pr, w, h, d, seed) => {
    gl.useProgram(pr.p);
    const U = pr.U;
    if (U.uRes) gl.uniform2f(U.uRes, w, h);
    if (U.uSeed) gl.uniform2f(U.uSeed, seed[0], seed[1]);
    if (U.uGrain) gl.uniform1f(U.uGrain, GRAIN_AMOUNT);
    if (U.uGrainPx) gl.uniform1f(U.uGrainPx, Math.max(1, GRAIN_SIZE * d));
    return U;
  };

  return {
    // 字的圖：每個字一格，用 canvas 畫（和 slit 一樣置中、textBaseline middle），位置才會完全接得上
    setGlyphs(chars, fontPx, d) {
      const size = fontPx * d, G = Math.ceil(size * 1.6);
      const c = document.createElement('canvas'); c.width = G * chars.length; c.height = G;
      const g = c.getContext('2d');
      g.font = `${size}px ${FONT}`;
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      chars.forEach((ch, i) => g.fillText(ch, i * G + G / 2, G / 2));
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, glyphTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      glyphG = G; glyphCount = chars.length;
    },
    // 小方塊的狀態：g = 淡入的時間、b = 還在不在
    setCells(n, delay, alive, maxDelay) {
      stateN = n;
      state = new Uint8Array(n * n * 4);
      for (let k = 0; k < n * n; k++) { state[k * 4 + 1] = Math.round(delay[k] / maxDelay * 255); state[k * 4 + 2] = alive[k] ? 255 : 0; state[k * 4 + 3] = 255; }
      this.introMs = maxDelay;
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, stateTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, state);
      this.dirty = false;
    },
    killCells(list) {
      for (const k of list) state[k * 4 + 2] = 0;
      this.dirty = true;
    },
    draw(video, L, simMs, tms, bodies, debris) {
      if (gl.isContextLost()) return;
      const w = canvas.width, h = canvas.height, d = w / L.W;
      const seed = [Math.random() * 1000, Math.random() * 1000];
      let V = 1;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, camTex);
      if (video) {
        watch(video);
        const vw = video.videoWidth, vh = video.videoHeight;
        if (fresh || !video.requestVideoFrameCallback) {
          if (vw !== texW || vh !== texH) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video); texW = vw; texH = vh; }
          else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, video);
          fresh = false;
        }
        V = vw / vh;
      }
      if (this.dirty) {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, stateTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, stateN, stateN, gl.RGBA, gl.UNSIGNED_BYTE, state);
        this.dirty = false;
      }
      gl.viewport(0, 0, w, h);
      // 鏡頭的對應：cover 鋪滿畫面；亂數範圍換成貼圖座標
      const A = w / h, camScale = [A > V ? 1 : A / V, A > V ? V / A : 1];
      const spread = [SCATTER * Math.max(1, 1 / V), SCATTER * Math.max(1, V)];   // 鏡頭畫面長邊的 7%（換成貼圖座標）
      const tick = Math.floor(simMs / 1000 * RESAMPLE);
      const camU = U => {
        gl.uniform1i(U.uCam, 0);
        gl.uniform2f(U.uCamScale, camScale[0], camScale[1]);
        gl.uniform2f(U.uSpread, spread[0], spread[1]);
        gl.uniform1f(U.uHasCam, video ? 1 : 0);
        gl.uniform1f(U.uTick, tick);
      };

      // 1. 背景
      let U = common(P.bg, w, h, d, seed);
      gl.uniform3fv(U.uBg, BG);
      gl.bindBuffer(gl.ARRAY_BUFFER, triBuf); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 2. 中間的方塊
      if (state) {
        U = common(P.cell, w, h, d, seed);
        camU(U);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, stateTex);
        gl.uniform1i(U.uState, 1);
        gl.uniform4f(U.uRect, L.x * d, L.y * d, L.size * d, L.size * d);
        gl.uniform1f(U.uN, stateN); gl.uniform1f(U.uCellPx, CELL * d);
        gl.uniform1f(U.uT, tms); gl.uniform1f(U.uFade, CELL_FADE); gl.uniform1f(U.uIntro, this.introMs);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      // 3. 碎片
      if (debris.length) {
        if (ptData.length < debris.length * 4) ptData = new Float32Array(debris.length * 8);
        debris.forEach((q, k) => { ptData[k * 4] = q.x * d; ptData[k * 4 + 1] = q.y * d; ptData[k * 4 + 2] = Math.max(0, q.life); ptData[k * 4 + 3] = q.seed; });
        U = common(P.pt, w, h, d, seed);
        camU(U);
        gl.uniform1f(U.uCellPx, CELL * d);
        gl.bindBuffer(gl.ARRAY_BUFFER, ptBuf);
        gl.bufferData(gl.ARRAY_BUFFER, ptData.subarray(0, debris.length * 4), gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, debris.length);
      }

      // 4. 字
      U = common(P.ch, w, h, d, seed);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, glyphTex);
      gl.uniform1i(U.uGlyph, 2);
      gl.uniform3fv(U.uFg, FG);
      gl.uniform1f(U.uG, glyphG); gl.uniform1f(U.uCount, glyphCount);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      bodies.forEach((b, i) => {
        gl.uniform2f(U.uC, b.x * d, b.y * d);
        gl.uniform2f(U.uRot, Math.cos(b.rot), Math.sin(b.rot));
        gl.uniform1f(U.uIdx, i);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      });
    },
  };
}
