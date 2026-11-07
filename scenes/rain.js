/* ==========================================================================
   rain — 符號雨
   --------------------------------------------------------------------------
   0 ms        按下 PLAY，介面淡出、背景的色彩交融留著，開始下白色的符號雨
   8389 ms     第 4 小節第 1 拍：前鏡頭畫面開始淡入（套 color.CUBE 調色、壓 40% 黑、加細顆粒），2 小節後完全出現；
               之後落下的符號有顏色（Figma 那五個顏色用隨機的順序循環、慢慢漸變），碰到頭會彈開
   16000 ms    「每個人都是一種文體」拆成一個一個白色的字，打散混在符號裡落下
   19000 ms    「你覺得你是哪一種」拆成一個一個白色的字，打散混在符號裡落下

   效能：符號在載入時先畫成一張小圖集（每個符號 × 白色＋漸變的每一階顏色），之後每幀只是貼圖。
   臉部偵測（Blazeface）在背景執行緒跑，不會卡住動畫。
   ========================================================================== */

import { colorBlend, COLORS } from './loading.js';
import { LUT_FILE, parseCube, LUT_GLSL, uploadLut } from './lut.js';

/* ---------- 可以調整的數字 ---------- */
const SYMBOLS = '!@#$%^&*,;:\'"?】◎§—/…《、·(>{%∞〃※';
const SYMBOL_FONT = '"BIZ UDPMincho"';
const SIZE_MIN = 12, SIZE_MAX = 38;      // 符號大小（px）；大部分偏小，少數很大
const SIZE_CURVE = 1.8;                  // 越大，小符號越多

const PHRASE_FONT = '"Chiron Sung HK"';
const CHAR_SIZE_MIN = 40, CHAR_SIZE_MAX = 50;   // 句子拆開後每個字的大小（px，比符號大）
const CHAR_COLOR = '#fff';                       // 句子的字一律白色
const CHAR_SPREAD = 260;                 // 每個字出發時上下錯開的距離（px），讓它們不會排成一排
const CHAR_FALL = 1.25;                  // 句子的字比符號平均落得快多少（1.25 = 快 25%）
const PHRASES = [
  { at: 16000, text: '每個人都是一種文體' },
  { at: 19000, text: '你覺得你是哪一種' },
];

const COLOR_AT = 8389;                   // 第 4 小節第 1 拍：開始有顏色、碰到頭會彈開
const CAMERA_AT = 8389;                  // 鏡頭從這裡開始淡入
const CAMERA_FADE = 3582;                // 淡入花多久（2 小節）
const CAMERA_LUT = LUT_FILE;             // 鏡頭的調色（lut/color.CUBE，設定在 lut.js）。不要調色就改成 null
const CAMERA_DARK = 0.4;                 // 調色之後再壓 40% 的黑
// 鏡頭的顆粒：參考 grainrad 的 Grain（預設大小 2、強度 35），這裡顆粒細一半、強度弱一半。每一幀都會變
const GRAIN_SIZE = 0.5;                  // 顆粒大小（px）；grainrad 預設約 1px
const GRAIN_AMOUNT = 0.175;              // 強度：每顆亮度最多加減這個值的一半（grainrad 預設 0.35）
// 鏡頭淡入之後符號的顏色：這五個顏色用隨機的順序循環（Figma Page 1 左邊那五個）
const RAIN_COLORS = ['#f8efce', '#ffcdb4', '#cdb2f1', '#ccebc8', '#ffb5d3'];
const COLOR_STEP = 4500;                 // 每一個顏色漸變到下一個顏色的毫秒數
const COLOR_SMOOTH = 6;                  // 每段漸變分成幾階（越多越順，但圖集越大）

// 整體速度：1 = 原本，0.5 = 慢一半。落下、飄移、彈開、旋轉都一起變慢，像慢動作
const SPEED = 0.5;
// 每秒落下幾個（畫面越寬越多）。會跟著速度調整，所以畫面上同時的數量不會因為變慢而變多
const SPAWN_PER_SEC = w => (15 + w * 0.085) * SPEED;
const FALL_MIN = 170 * SPEED, FALL_MAX = 420 * SPEED;   // 落下速度（px/秒）
const GRAVITY = 1080 * SPEED * SPEED;                   // 彈開後的重力

const MODEL_URL = '../models/blazeface/model.json';   // 臉部偵測模型（從 purpleRain 搬來）

/* ---------- 圖集設定 ---------- */
const UNIQUE = [...new Set(Array.from(SYMBOLS))];    // 重複的符號只算一次，每個符號出現的機率都一樣
const PICK = UNIQUE.map((_, i) => i);
const BAKE = 60, CELL = 76;                           // 圖集裡每個符號的字級與格子大小（像素）
const CHAR_BAKE = CHAR_SIZE_MAX * 2;                  // 句子的字預先畫好的字級（像素）

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
// 顏色的順序：每次打開網頁都重新洗牌；五個用完再洗一次，接起來的地方不會連續同一個顏色。
// 排到 rain 結束（加上轉場）為止，之後從頭接回去（最後一個也和第一個不同）
const PALETTE = (() => {
  const need = Math.max(2, Math.ceil((31100 - COLOR_AT) / COLOR_STEP) + 1);   // 用得到的顏色數
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let seq;
  for (let tries = 0; tries < 100; tries++) {
    seq = [];
    while (seq.length < need) {
      let bag;
      do bag = shuffle(RAIN_COLORS); while (seq.length && bag[0] === seq[seq.length - 1] && RAIN_COLORS.length > 1);
      seq.push(...bag);
    }
    seq = seq.slice(0, need);
    if (seq[need - 1] !== seq[0]) break;
  }
  const rgb = h => { const v = parseInt(h.slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
  const rows = [];                                     // 每一段漸變的每一階
  for (let i = 0; i < seq.length; i++) {
    const a = rgb(seq[i]), b = rgb(seq[(i + 1) % seq.length]);
    for (let k = 0; k < COLOR_SMOOTH; k++) {
      const f = k / COLOR_SMOOTH;
      rows.push(`rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * f)).join(',')})`);
    }
  }
  return rows;
})();
// 某個時間點落下的符號是第幾種顏色（第 0 列是白色）
const colorRow = ms => {
  const u = (ms - COLOR_AT) / COLOR_STEP * COLOR_SMOOTH;
  return 1 + ((Math.floor(u) % PALETTE.length) + PALETTE.length) % PALETTE.length;
};

export default {
  name: 'rain',
  needs: { camera: true },
  dev: { from: 0, to: 29800 },

  async preload(stage) {
    const root = stage.root;

    // 1. 背景：和載入畫面同一個色彩交融（同一次開啟時畫面完全一樣，所以看起來是背景留著）
    const bg = document.createElement('canvas');
    bg.className = 'qq-canvas';
    root.appendChild(bg);
    this.bg = colorBlend(bg, COLORS);
    if (!this.bg) bg.style.background = '#f8efce';

    // 2. 鏡頭：用 WebGL 畫（左右鏡像、套 LUT 調色、壓 40% 黑、加顆粒），用手機原本的解析度，顆粒才夠細
    this.camCanvas = stage.canvas({ dpr: Math.min(3, window.devicePixelRatio || 1) });
    this.camCanvas.style.opacity = 0;
    this.cam = cameraLayer(this.camCanvas);
    if (!this.cam) console.warn('這個瀏覽器不支援 WebGL，鏡頭畫面不會出現');

    // 3. 符號雨
    this.canvas = stage.canvas();
    this.g = this.canvas.getContext('2d');

    // 4. 調色檔、字型載好才能畫圖集
    const lut = this.cam && CAMERA_LUT
      ? stage.file(CAMERA_LUT).then(buf => this.cam.setLut(parseCube(buf))).catch(err => console.warn('調色檔沒有套用：', err))
      : null;
    await Promise.all([
      lut,
      stage.font(`${BAKE}px ${SYMBOL_FONT}`, UNIQUE.join('')),
      stage.font(`${CHAR_BAKE}px ${PHRASE_FONT}`, PHRASES.map(p => p.text).join('')),
    ]);
    this.atlas = bakeAtlas();
    // 句子拆成一個一個字，先畫好
    this.charSprites = PHRASES.map(p => Array.from(p.text).map(ch => bakeChar(ch, CHAR_COLOR)));

    // 5. 臉部偵測在背景載入，不擋開始（鏡頭 8.4 秒後才出現，那時早就好了）
    this.faces = [];
    this.detector = startDetector(stage.asset(MODEL_URL), faces => { this.faces = faces; });

    this.drops = [];
    this.lastCamA = -1;
  },

  enter(stage, f) {
    this.drops = [];
    this.acc = 0;
    this.lastMs = f.t * 1000;
    this.done = PHRASES.map(p => this.lastMs > p.at + 300);   // 從中途進場時，已經過了的句子就不補
  },

  exit() {
    this.drops = [];
    this.faces = [];
    this.camCanvas.style.opacity = 0;
    this.lastCamA = -1;
  },

  update(stage, f) {
    const ms = f.t * 1000;
    const dt = f.playing ? Math.min(f.dt, 0.05) : 0;   // 暫停時整個畫面停住
    const W = stage.width, H = stage.height, d = stage.dpr;

    // 往回跳（開發時）：句子可以再出現一次
    if (ms < this.lastMs - 500) this.done = PHRASES.map(p => ms > p.at + 300);
    this.lastMs = ms;

    // 鏡頭淡入（共用的相機，點擊開始時已經開好）
    const video = stage.camera;
    const hasCam = !!(this.cam && video && video.videoWidth > 0);
    const camA = hasCam ? clamp01((ms - CAMERA_AT) / CAMERA_FADE) : 0;
    if (camA !== this.lastCamA && (Math.abs(camA - this.lastCamA) > 0.002 || camA === 0 || camA === 1)) {
      this.camCanvas.style.opacity = camA.toFixed(3);
      this.lastCamA = camA;
    }
    if (camA > 0) this.cam.draw(video);
    // 背景：鏡頭完全蓋住之後就不用再畫
    if (camA < 1 && this.bg) this.bg.draw(performance.now() / 1000);

    // 臉部偵測（鏡頭出現之後才開始）
    if (camA > 0) this.detector.send(video);
    const faces = camA > 0.3 ? this.faces.map(b => toScreen(b, video, W, H)) : [];

    // 新的符號
    if (dt > 0) {
      this.acc += SPAWN_PER_SEC(W) * Math.min(1, f.local / 1.2 + 0.15) * dt;
      while (this.acc >= 1) { this.acc -= 1; this.drops.push(newSymbol(W, ms)); }
      PHRASES.forEach((p, i) => {
        if (!this.done[i] && ms >= p.at) {
          this.done[i] = true;
          for (const s of this.charSprites[i]) this.drops.push(newChar(W, s));
        }
      });
    }

    // 移動、碰撞、畫出來
    const g = this.g, atlas = this.atlas, drops = this.drops;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let i = drops.length - 1; i >= 0; i--) {
      const p = drops[i];
      if (dt > 0) {
        if (!p.bouncing) {
          const k = p.fall || 1;
          p.vy += (Math.random() - 0.5) * 360 * SPEED * k * dt;
          p.vy = Math.min(FALL_MAX * 1.15 * k, Math.max(FALL_MIN * 0.8 * k, p.vy));
          for (let k = 0; k < faces.length; k++) {
            const b = faces[k], dx = p.x - b.cx, dy = p.y - b.cy;
            if (dy < 0 && (dx * dx) / (b.rx * b.rx) + (dy * dy) / (b.ry * b.ry) <= 1) {
              const side = dx > 0 ? 1 : -1;
              p.bouncing = true;
              p.vy = -p.vy * (0.2 + Math.random() * 0.3);
              p.vx = side * (60 + Math.random() * 180) * SPEED;
              p.vr = side * (3 + Math.random() * 5) * SPEED;
              p.y = b.cy - b.ry * Math.sqrt(Math.max(0, 1 - (dx * dx) / (b.rx * b.rx))) - 2;
              break;
            }
          }
        } else {
          p.vy += GRAVITY * dt;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
      const m = p.size;
      if (p.y - m > H || p.x < -m || p.x > W + m) { drops[i] = drops[drops.length - 1]; drops.pop(); continue; }

      const cos = Math.cos(p.rot), sin = Math.sin(p.rot);
      if (p.sprite) {
        const s = p.sprite, k = p.size * d / CHAR_BAKE;
        g.setTransform(cos * k, sin * k, -sin * k, cos * k, p.x * d, p.y * d);
        g.drawImage(s, -s.width / 2, -s.height / 2);
      } else {
        const k = p.size * d / BAKE;
        g.setTransform(cos * k, sin * k, -sin * k, cos * k, p.x * d, p.y * d);
        g.drawImage(atlas, p.col * CELL, p.row * CELL, CELL, CELL, -CELL / 2, -CELL / 2, CELL, CELL);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  },
};

/* ---------- 產生符號、句子 ---------- */
// 符號的速度會依大小乘上 0.85–1.15（大部分符號偏小），這是它們平均的係數；句子的字以它為基準再快 CHAR_FALL
const SYMBOL_AVG = 0.85 + 0.3 / (SIZE_CURVE + 1);
function newSymbol(W, ms) {
  const r = Math.random();
  const size = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * Math.pow(r, SIZE_CURVE);
  const big = (size - SIZE_MIN) / (SIZE_MAX - SIZE_MIN);
  return {
    x: Math.random() * W, y: -size,
    vx: (Math.random() - 0.5) * 90 * SPEED,
    vy: (FALL_MIN + Math.random() * (FALL_MAX - FALL_MIN)) * (0.85 + big * 0.3),   // 大的稍快，有一點遠近感
    rot: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 0.8 * SPEED,
    size, col: PICK[(Math.random() * PICK.length) | 0],
    row: ms >= COLOR_AT ? colorRow(ms) : 0,            // 第 0 列是白色
    bouncing: false,
  };
}
// 句子裡的一個字：像符號一樣隨機位置、旋轉、落下，只是比較大
function newChar(W, sprite) {
  const size = CHAR_SIZE_MIN + Math.random() * (CHAR_SIZE_MAX - CHAR_SIZE_MIN);
  return {
    x: size / 2 + Math.random() * Math.max(0, W - size), y: -size - Math.random() * CHAR_SPREAD,
    vx: (Math.random() - 0.5) * 90 * SPEED,
    vy: (FALL_MIN + Math.random() * (FALL_MAX - FALL_MIN)) * SYMBOL_AVG * CHAR_FALL,
    rot: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 0.8 * SPEED,
    size, sprite, fall: SYMBOL_AVG * CHAR_FALL, bouncing: false,
  };
}

/* ---------- 圖集：每個符號 × 白色＋漸變的每一階顏色 ---------- */
function bakeAtlas() {
  const n = UNIQUE.length;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const white = mk(n * CELL, CELL), wg = white.getContext('2d');
  wg.font = `${BAKE}px ${SYMBOL_FONT}`;
  wg.fillStyle = '#fff';
  wg.textBaseline = 'alphabetic';
  UNIQUE.forEach((ch, i) => {
    const m = wg.measureText(ch);
    // 用字實際的形狀置中（全形標點在字框裡是偏一邊的），旋轉和碰撞才會以符號本身為中心
    const l = m.actualBoundingBoxLeft ?? 0, r = m.actualBoundingBoxRight ?? m.width;
    const a = m.actualBoundingBoxAscent ?? BAKE * 0.8, de = m.actualBoundingBoxDescent ?? BAKE * 0.2;
    wg.fillText(ch, i * CELL + (CELL - (l + r)) / 2 + l, (CELL - (a + de)) / 2 + a);
  });
  const atlas = mk(n * CELL, (PALETTE.length + 1) * CELL), ag = atlas.getContext('2d');
  ag.drawImage(white, 0, 0);
  const tmp = mk(n * CELL, CELL), tg = tmp.getContext('2d');
  for (let k = 0; k < PALETTE.length; k++) {
    tg.globalCompositeOperation = 'copy';
    tg.drawImage(white, 0, 0);
    tg.globalCompositeOperation = 'source-in';
    tg.fillStyle = PALETTE[k];
    tg.fillRect(0, 0, tmp.width, tmp.height);
    ag.drawImage(tmp, 0, (k + 1) * CELL);
  }
  return atlas;
}
function bakeChar(ch, color) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const box = Math.ceil(CHAR_BAKE * 1.3);
  c.width = c.height = box;
  g.font = `${CHAR_BAKE}px ${PHRASE_FONT}`;
  g.fillStyle = color;
  g.textBaseline = 'alphabetic';
  const m = g.measureText(ch);
  const l = m.actualBoundingBoxLeft ?? 0, r = m.actualBoundingBoxRight ?? m.width;
  const a = m.actualBoundingBoxAscent ?? CHAR_BAKE * 0.85, de = m.actualBoundingBoxDescent ?? CHAR_BAKE * 0.15;
  g.fillText(ch, (box - (l + r)) / 2 + l, (box - (a + de)) / 2 + a);   // 用字實際的形狀置中
  return c;
}

/* ---------- 鏡頭畫面：WebGL（左右鏡像、cover 鋪滿、彩度、壓黑、顆粒） ---------- */
function cameraLayer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false });
  if (!gl) return null;
  const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const fs = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTex;
uniform vec2 uRes, uScale, uSeed;
uniform float uUseLut, uDark, uGrain, uGrainPx;
${LUT_GLSL}
// 不用 sin 的雜訊（手機上也不會出現規則的紋路）
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 t = (uv - 0.5) * uScale + 0.5;            // 像 object-fit: cover 一樣鋪滿
  t = vec2(1.0 - t.x, 1.0 - t.y);                // 左右鏡像；影片第一列在畫面上方
  vec3 c = texture2D(uTex, t).rgb;
  if (uUseLut > 0.5) c = lut(c);                 // 調色
  c *= 1.0 - uDark;                              // 壓黑
  float n = hash(floor(gl_FragCoord.xy / uGrainPx) + uSeed) - 0.5;
  gl_FragColor = vec4(c + n * uGrain, 1.0);      // 顆粒：像 grainrad 一樣直接加減亮度
}`;
  const sh = (type, src) => {
    const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
    return o;
  };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (err) { console.warn('鏡頭 shader 失敗', err); return null; }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const u = n => gl.getUniformLocation(prog, n);
  const U = { res: u('uRes'), scale: u('uScale'), seed: u('uSeed'), dark: u('uDark'), grain: u('uGrain'), px: u('uGrainPx'), useLut: u('uUseLut') };
  gl.uniform1i(u('uTex'), 0);
  gl.uniform1f(U.useLut, 0);
  gl.uniform1f(U.dark, CAMERA_DARK);
  gl.uniform1f(U.grain, GRAIN_AMOUNT);

  let texW = 0, texH = 0, fresh = true, watching = null;
  // 只在鏡頭有新畫面時才上傳（鏡頭通常 30fps，畫面 60fps）
  const watch = v => {
    if (watching === v || !v.requestVideoFrameCallback) return;
    watching = v;
    const cb = () => { fresh = true; v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
  };
  let lutTex = null;
  return {
    // 套用調色：L 是 parseCube() 的結果；傳 null 就不調色
    setLut(L) {
      if (!L) { gl.uniform1f(U.useLut, 0); return; }
      lutTex = uploadLut(gl, prog, L, 1, lutTex);
      gl.uniform1f(U.useLut, 1);
    },
    draw(video) {
      if (gl.isContextLost()) return;
      gl.activeTexture(gl.TEXTURE0);
      watch(video);
      const vw = video.videoWidth, vh = video.videoHeight;
      if (fresh || !video.requestVideoFrameCallback) {
        if (vw !== texW || vh !== texH) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video); texW = vw; texH = vh; }
        else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, video);
        fresh = false;
      }
      const W = canvas.width, H = canvas.height, A = W / H, V = vw / vh;
      gl.viewport(0, 0, W, H);
      gl.uniform2f(U.res, W, H);
      gl.uniform2f(U.scale, A > V ? 1 : A / V, A > V ? V / A : 1);
      gl.uniform2f(U.seed, Math.random() * 1000, Math.random() * 1000);   // 每一幀的顆粒都不一樣
      gl.uniform1f(U.px, Math.max(1, GRAIN_SIZE * W / (canvas.clientWidth || W)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

/* ---------- 臉部偵測（Blazeface，在背景執行緒，和 purpleRain 同一套） ---------- */
const CDN = 'https://cdn.jsdelivr.net/npm';
const WORKER_SRC = `
importScripts(
  '${CDN}/@tensorflow/tfjs-core@4.22.0/dist/tf-core.min.js',
  '${CDN}/@tensorflow/tfjs-converter@4.22.0/dist/tf-converter.min.js',
  '${CDN}/@tensorflow/tfjs-backend-wasm@4.22.0/dist/tf-backend-wasm.min.js',
  '${CDN}/@tensorflow-models/blazeface@0.1.0/dist/blazeface.min.umd.js'
);
let model = null;
onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false);
      tf.wasm.setWasmPaths(m.wasmPath);
      await tf.setBackend('wasm');
      await tf.ready();
      model = await blazeface.load({ modelUrl: m.modelUrl });
      await model.estimateFaces(new ImageData(64, 48), false);
      postMessage({ type: 'ready' });
    } catch (err) { postMessage({ type: 'error', message: String(err) }); }
  } else if (m.type === 'frame') {
    try {
      const img = new ImageData(new Uint8ClampedArray(m.buffer), m.width, m.height);
      const preds = await model.estimateFaces(img, false);
      postMessage({ type: 'faces', width: m.width, height: m.height,
        faces: preds.map(p => [p.topLeft[0], p.topLeft[1], p.bottomRight[0], p.bottomRight[1]]) });
    } catch (err) { postMessage({ type: 'faces', width: m.width, height: m.height, faces: [] }); }
  }
};`;

function startDetector(modelUrl, onFaces) {
  const dc = document.createElement('canvas');
  const dg = dc.getContext('2d', { willReadFrequently: true });
  const det = { ready: false, busy: false, send() {} };
  let worker;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
  } catch (err) {
    console.warn('臉部偵測無法啟動（符號照下，只是不會彈開）', err);
    return det;
  }
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'ready') det.ready = true;
    else if (m.type === 'error') console.warn('臉部偵測載入失敗（符號照下，只是不會彈開）', m.message);
    else if (m.type === 'faces') {
      det.busy = false;
      // 換算成鏡頭原始畫面的比例（0–1），畫面座標在每一幀依當時尺寸換算
      onFaces(m.faces.map(([x1, y1, x2, y2]) => ({ x1: x1 / m.width, y1: y1 / m.height, x2: x2 / m.width, y2: y2 / m.height })));
    }
  };
  worker.onerror = e => console.warn('臉部偵測錯誤', e.message || e);
  worker.postMessage({ type: 'init', modelUrl, wasmPath: `${CDN}/@tensorflow/tfjs-backend-wasm@4.22.0/dist/` });
  det.send = video => {
    if (!det.ready || det.busy || !video.videoWidth) return;
    dc.width = 256;
    dc.height = Math.round(256 * video.videoHeight / video.videoWidth);
    dg.drawImage(video, 0, 0, dc.width, dc.height);
    const img = dg.getImageData(0, 0, dc.width, dc.height);
    det.busy = true;
    worker.postMessage({ type: 'frame', buffer: img.data.buffer, width: img.width, height: img.height }, [img.data.buffer]);
  };
  return det;
}

// 鏡頭畫面用 object-fit: cover 鋪滿、左右鏡像；把臉的位置換算成畫面上的橢圓（偏上，對準頭頂）
function toScreen(b, video, W, H) {
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const s = Math.max(W / vw, H / vh), dw = vw * s, dh = vh * s;
  const ox = (W - dw) / 2, oy = (H - dh) / 2;
  const x1 = W - (ox + b.x2 * dw), x2 = W - (ox + b.x1 * dw);
  const y1 = oy + b.y1 * dh, y2 = oy + b.y2 * dh;
  const w = x2 - x1, h = y2 - y1;
  return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 - h * 0.15, rx: w * 0.55, ry: h * 0.65 };
}
