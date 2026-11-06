/* ==========================================================================
   rain — 符號雨
   --------------------------------------------------------------------------
   0 ms        按下 PLAY，介面淡出、背景的色彩交融留著，開始下白色的符號雨
   8389 ms     第 4 小節第 1 拍：前鏡頭畫面開始淡入（彩度 -30%、壓 40% 黑），2 小節後完全出現；
               之後落下的符號有顏色（從紫色開始繞色相環），碰到頭會彈開
   16000 ms    「每個人都是一種文體」拆成一個一個白色的字，打散混在符號裡落下
   19000 ms    「你覺得你是哪一種」拆成一個一個白色的字，打散混在符號裡落下

   效能：符號在載入時先畫成一張小圖集（每個符號 × 白色＋36 種顏色），之後每幀只是貼圖。
   臉部偵測（Blazeface）在背景執行緒跑，不會卡住動畫。
   ========================================================================== */

import { colorBlend, COLORS } from './loading.js';

/* ---------- 可以調整的數字 ---------- */
const SYMBOLS = '!@#$%^&*,;:\'"?】◎§—/…《、·(>{%∞〃※';
const SYMBOL_FONT = '"BIZ UDPMincho"';
const SIZE_MIN = 12, SIZE_MAX = 38;      // 符號大小（px）；大部分偏小，少數很大
const SIZE_CURVE = 1.8;                  // 越大，小符號越多

const PHRASE_FONT = '"Chiron Sung HK"';
const CHAR_SIZE_MIN = 40, CHAR_SIZE_MAX = 50;   // 句子拆開後每個字的大小（px，比符號大）
const CHAR_COLOR = '#fff';                       // 句子的字一律白色
const CHAR_SPREAD = 260;                 // 每個字出發時上下錯開的距離（px），讓它們不會排成一排
const PHRASES = [
  { at: 16000, text: '每個人都是一種文體' },
  { at: 19000, text: '你覺得你是哪一種' },
];

const COLOR_AT = 8389;                   // 第 4 小節第 1 拍：開始有顏色、碰到頭會彈開
const CAMERA_AT = 8389;                  // 鏡頭從這裡開始淡入
const CAMERA_FADE = 3582;                // 淡入花多久（2 小節）
const CAMERA_SATURATION = 0.7;           // 彩度降低 30%
const CAMERA_DARK = 0.4;                 // 壓 40% 的黑
const HUE_START = 270;                   // 從紫色開始
const HUE_CYCLE = 15000;                 // 繞色相環一圈的毫秒數（和 purpleRain 一樣）

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
const HUE_STEPS = 36;                                 // 每 10° 一種顏色
const BAKE = 60, CELL = 76;                           // 圖集裡每個符號的字級與格子大小（像素）
const CHAR_BAKE = CHAR_SIZE_MAX * 2;                  // 句子的字預先畫好的字級（像素）

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const hueIndex = ms => {
  const h = HUE_START + (ms - COLOR_AT) / HUE_CYCLE * 360;
  return ((Math.round(h / (360 / HUE_STEPS)) % HUE_STEPS) + HUE_STEPS) % HUE_STEPS;
};
const hueColor = i => `hsl(${i * 360 / HUE_STEPS}, 100%, 55%)`;

export default {
  name: 'rain',
  needs: { camera: true },
  dev: { from: 0, to: 29882 },

  async preload(stage) {
    const root = stage.root;

    // 1. 背景：和載入畫面同一個色彩交融（同一次開啟時畫面完全一樣，所以看起來是背景留著）
    const bg = document.createElement('canvas');
    bg.className = 'qq-canvas';
    root.appendChild(bg);
    this.bg = colorBlend(bg, COLORS);
    if (!this.bg) bg.style.background = '#f8efce';

    // 2. 鏡頭（彩度 -30%、左右鏡像）和 30% 黑
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.autoplay = true; v.setAttribute('playsinline', '');
    v.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);` +
      `filter:saturate(${CAMERA_SATURATION});-webkit-filter:saturate(${CAMERA_SATURATION});opacity:0;pointer-events:none`;
    root.appendChild(v);
    this.video = v;
    const dark = document.createElement('div');
    dark.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none';
    root.appendChild(dark);
    this.dark = dark;

    // 3. 符號雨
    this.canvas = stage.canvas();
    this.g = this.canvas.getContext('2d');

    // 4. 字型載好才能畫圖集
    await Promise.all([
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

  ready(stage) {
    // 用共用的相機串流（點擊開始時已經開好）
    if (stage.camera && stage.camera.srcObject) {
      this.video.srcObject = stage.camera.srcObject;
      this.video.play().catch(() => {});
    }
  },

  enter(stage, f) {
    this.drops = [];
    this.acc = 0;
    this.lastMs = f.t * 1000;
    this.done = PHRASES.map(p => this.lastMs > p.at + 300);   // 從中途進場時，已經過了的句子就不補
    if (this.video.srcObject) this.video.play().catch(() => {});
  },

  exit() {
    this.drops = [];
    this.faces = [];
    this.video.style.opacity = 0;
    this.dark.style.opacity = 0;
    this.lastCamA = -1;
  },

  update(stage, f) {
    const ms = f.t * 1000;
    const dt = f.playing ? Math.min(f.dt, 0.05) : 0;   // 暫停時整個畫面停住
    const W = stage.width, H = stage.height, d = stage.dpr;

    // 往回跳（開發時）：句子可以再出現一次
    if (ms < this.lastMs - 500) this.done = PHRASES.map(p => ms > p.at + 300);
    this.lastMs = ms;

    // 鏡頭淡入
    const hasCam = !!this.video.srcObject && this.video.videoWidth > 0;
    const camA = hasCam ? clamp01((ms - CAMERA_AT) / CAMERA_FADE) : 0;
    if (camA !== this.lastCamA && (Math.abs(camA - this.lastCamA) > 0.002 || camA === 0 || camA === 1)) {
      this.video.style.opacity = camA.toFixed(3);
      this.dark.style.opacity = (camA * CAMERA_DARK).toFixed(3);
      this.lastCamA = camA;
    }
    // 背景：鏡頭完全蓋住之後就不用再畫
    if (camA < 1 && this.bg) this.bg.draw(performance.now() / 1000);

    // 臉部偵測（鏡頭出現之後才開始）
    if (camA > 0 && hasCam) this.detector.send(stage.camera || this.video);
    const faces = camA > 0.3 ? this.faces.map(b => toScreen(b, this.video, W, H)) : [];

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
          p.vy += (Math.random() - 0.5) * 360 * SPEED * dt;
          p.vy = Math.min(FALL_MAX * 1.15, Math.max(FALL_MIN * 0.8, p.vy));
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
    row: ms >= COLOR_AT ? 1 + hueIndex(ms) : 0,        // 第 0 列是白色
    bouncing: false,
  };
}
// 句子裡的一個字：像符號一樣隨機位置、旋轉、落下，只是比較大
function newChar(W, sprite) {
  const size = CHAR_SIZE_MIN + Math.random() * (CHAR_SIZE_MAX - CHAR_SIZE_MIN);
  return {
    x: size / 2 + Math.random() * Math.max(0, W - size), y: -size - Math.random() * CHAR_SPREAD,
    vx: (Math.random() - 0.5) * 90 * SPEED,
    vy: FALL_MIN + Math.random() * (FALL_MAX - FALL_MIN),
    rot: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 0.8 * SPEED,
    size, sprite, bouncing: false,
  };
}

/* ---------- 圖集：每個符號 × 白色＋36 種顏色 ---------- */
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
  const atlas = mk(n * CELL, (HUE_STEPS + 1) * CELL), ag = atlas.getContext('2d');
  ag.drawImage(white, 0, 0);
  const tmp = mk(n * CELL, CELL), tg = tmp.getContext('2d');
  for (let k = 0; k < HUE_STEPS; k++) {
    tg.globalCompositeOperation = 'copy';
    tg.drawImage(white, 0, 0);
    tg.globalCompositeOperation = 'source-in';
    tg.fillStyle = hueColor(k);
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
