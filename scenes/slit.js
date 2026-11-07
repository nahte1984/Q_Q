/* ==========================================================================
   slit — 造型磁頭的 slit-scan
   --------------------------------------------------------------------------
   參考 nahte1984.github.io/oooslit：一個「磁頭」從畫面中心往外擴張，
   磁頭經過的地方會留下當下那一刻的鏡頭畫面，所以越外圈是越晚的畫面。

   三輪，每一輪的磁頭形狀不同；磁頭在畫面中心時最小，一直長大到整個形狀都在畫面外，就是一輪。
   前一輪留下的畫面不會清掉，下一輪從中心開始一圈一圈蓋過去。
     第一輪  圓形    44210 – 50478 ms
     第二輪  星星    50479 – 57194 ms（images/slit-star.svg）
     第三輪  愛心    57195 – 64481 ms（images/slit-heart.svg）
   背景色 #313131（第一輪還沒掃到的地方）。
   鏡頭畫面套 lut/color.CUBE 的調色（和 rain 一樣，設定在 lut.js）。

   和 oooslit 的差別：
   ・全部用 WebGL 在顯示卡上畫（oooslit 每一幀都用 2D canvas 剪一個圓環再貼整張鏡頭畫面）
   ・每一幀只處理磁頭這一幀掃過的那一圈，而且只算磁頭外框以內的範圍
   ・用手機原本的解析度（oooslit 是 1 倍，Retina 螢幕上會糊）
   ・跟著音樂時間走：暫停時畫面停住，掉幀也不會有縫
   ========================================================================== */

import { LUT_FILE, parseCube, LUT_GLSL, uploadLut } from './lut.js';

/* ---------- 可以調整的數字 ---------- */
// 三輪的磁頭：shape 是 'circle' 或 SVG 檔（相對於這個檔；用檔案裡第一個 path 的外框）
const ROUNDS = [
  { shape: 'circle', from: 44210, to: 50478 },
  { shape: '../images/slit-star.svg', from: 50479, to: 57194 },
  { shape: '../images/slit-heart.svg', from: 57195, to: 64481 },
];
const BG_COLOR = '#313131';
const CAMERA_LUT = LUT_FILE;             // 鏡頭的調色；不要調色就改成 null
// 顆粒（和 rain、divide 一樣；不要顆粒就把 GRAIN_AMOUNT 改成 0）
const GRAIN_SIZE = 0.5, GRAIN_AMOUNT = 0.175;
// 解析度上限（2 倍就很清楚；鏡頭畫面本身也沒有更細）
const MAX_DPR = 2;

/* ---------- 形狀 → 每個角度上外框離中心多遠 ---------- */
const BINS = 1024;   // 角度切成幾份

const hex = h => { const v = parseInt(h.slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
const clamp01 = x => Math.max(0, Math.min(1, x));

export default {
  name: 'slit',
  needs: { camera: true },
  dev: { from: 44210, to: 64481 },

  async preload(stage) {
    // 每一輪的形狀算成「角度 → 外框半徑」的表（最遠的一點 = 1）
    const [radial, lut] = await Promise.all([
      Promise.all(ROUNDS.map(async r => (r.shape === 'circle' ? new Float32Array(BINS).fill(1) : radialFromSVG(await stage.file(r.shape))))),
      CAMERA_LUT ? stage.file(CAMERA_LUT).then(parseCube).catch(err => { console.warn('調色檔沒有套用：', err); return null; }) : null,
    ]);
    this.radial = radial;
    this.canvas = stage.canvas({ dpr: Math.min(MAX_DPR, window.devicePixelRatio || 1) });
    this.gl = slitLayer(this.canvas, this.radial);
    if (!this.gl) console.warn('這個瀏覽器不支援 WebGL，slit 不會出現');
    else if (lut) this.gl.setLut(lut);
    this.kmax = [];
  },

  enter() {
    this.round = -1;      // 現在第幾輪
    this.last = 0;        // 上一幀磁頭的大小（CSS px）
    if (this.gl) this.gl.clear();
  },

  resize() { this.kmax = []; },

  // 磁頭要長到多大，整個形狀才會完全在畫面外
  kMax(stage, i) {
    if (this.kmax[i]) return this.kmax[i];
    const W = stage.width, H = stage.height, R = this.radial[i];
    let m = 0;
    const test = (x, y) => {
      const dx = x - W / 2, dy = y - H / 2;
      m = Math.max(m, Math.hypot(dx, dy) / radiusAt(R, Math.atan2(dy, dx)));
    };
    for (let j = 0; j <= 400; j++) { const a = j / 400; test(a * W, 0); test(a * W, H); test(0, a * H); test(W, a * H); }
    return (this.kmax[i] = m + 2);
  },

  update(stage, f) {
    if (!this.gl) return;
    const ms = f ? f.t * 1000 : 0;
    let i = -1;
    for (let j = 0; j < ROUNDS.length; j++) if (ms >= ROUNDS[j].from) i = j;
    const v = stage.camera, video = v && v.videoWidth > 0 ? v : null;
    if (i >= 0) {
      const r = ROUNDS[i];
      const cur = clamp01((ms - r.from) / (r.to - r.from)) * this.kMax(stage, i);
      if (i !== this.round) {
        // 上一輪最後一小圈可能剛好落在兩幀之間：先補完，畫面角落才不會留下縫
        const p = this.round, pm = p >= 0 ? this.kMax(stage, p) : 0;
        if (video && p >= 0 && p < i && this.last < pm) this.gl.scan(video, stage, p, this.last, pm);
        this.round = i; this.last = 0;                            // 新的一輪從中心開始
      }
      if (cur < this.last) this.last = 0;                         // 往回跳（開發時拖時間）
      if (video && cur > this.last) {
        this.gl.scan(video, stage, i, this.last, cur);             // 只畫這一幀掃過的那一圈
        this.last = cur;
      }
    }
    this.gl.show();
  },
};

function radiusAt(R, a) {
  const u = (a / (2 * Math.PI) + 0.5) * BINS - 0.5;
  const i = Math.floor(u), f = u - i;
  const r0 = R[((i % BINS) + BINS) % BINS], r1 = R[(((i + 1) % BINS) + BINS) % BINS];
  return r0 + (r1 - r0) * f;
}

// SVG → 外框的點 → 每個角度上，從中心（外框的中心點）往外最遠碰到外框的距離
function radialFromSVG(buf) {
  const text = new TextDecoder().decode(buf);
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const src = doc.querySelector('path, polygon, polyline, ellipse, circle, rect');
  if (!src) throw new Error('SVG 裡找不到形狀');
  // 放進頁面裡（看不見）才能量長度
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden');
  const el = document.importNode(src, true);
  el.removeAttribute('class'); el.removeAttribute('transform');
  svg.appendChild(el); document.body.appendChild(svg);
  let pts;
  try {
    const L = el.getTotalLength(), n = 2000, b = el.getBBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    pts = [];
    for (let k = 0; k < n; k++) { const p = el.getPointAtLength(L * k / n); pts.push(p.x - cx, p.y - cy); }
  } finally { svg.remove(); }
  const n = pts.length / 2, R = new Float32Array(BINS);
  for (let b = 0; b < BINS; b++) {
    const a = ((b + 0.5) / BINS - 0.5) * 2 * Math.PI, dx = Math.cos(a), dy = Math.sin(a);
    let best = 0;
    for (let k = 0; k < n; k++) {
      const ax = pts[2 * k], ay = pts[2 * k + 1], k2 = (k + 1) % n, bx = pts[2 * k2], by = pts[2 * k2 + 1];
      const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (ax * ey - ay * ex) / den, s = (ax * dy - ay * dx) / den;   // 射線上的距離、線段上的位置
      if (t > 0 && s >= 0 && s <= 1 && t > best) best = t;
    }
    R[b] = best;
  }
  let max = 0;
  for (let b = 0; b < BINS; b++) max = Math.max(max, R[b]);
  for (let b = 0; b < BINS; b++) R[b] = Math.max(R[b] / max, 0.01);
  return R;
}

/* ---------- WebGL ---------- */
function slitLayer(canvas, radial) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const head = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;
  // 1. 掃描：磁頭這一幀掃過的那一圈（last ≤ 大小 < cur）寫進當下的鏡頭畫面，其他地方不動
  const scanFS = head + `
uniform sampler2D uCam, uShape;
uniform vec2 uRes, uCamScale;
uniform float uD, uRow, uRows, uLast, uCur, uUseLut;
${LUT_GLSL}
const float BINS = ${BINS}.0;
float decode(float i){
  vec4 t = texture2D(uShape, vec2((mod(i, BINS) + 0.5) / BINS, (uRow + 0.5) / uRows));
  return (t.r * 65280.0 + t.g * 255.0) / 65535.0;
}
float radiusAt(float a){
  float u = (a / 6.2831853 + 0.5) * BINS - 0.5;
  float i = floor(u);
  return mix(decode(i), decode(i + 1.0), u - i);
}
void main(){
  vec2 p = (gl_FragCoord.xy - uRes * 0.5) / uD;  p.y = -p.y;      // 以畫面中心為原點（CSS px，往下為正）
  float s = length(p) / radiusAt(atan(p.y, p.x));                 // 磁頭要長到多大才會經過這裡
  if (s < uLast || s >= uCur) discard;
  vec2 t = (vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes - 0.5) * uCamScale + 0.5;   // 像 cover 一樣鋪滿
  t.x = 1.0 - t.x;                                                 // 前鏡頭左右鏡像
  vec3 c = texture2D(uCam, t).rgb;
  if (uUseLut > 0.5) c = lut(c);                                   // 調色（color.CUBE）
  gl_FragColor = vec4(c, 1.0);
}`;
  // 2. 顯示：把累積的畫面畫到螢幕上，加顆粒
  const showFS = head + `
uniform sampler2D uHist;
uniform vec2 uRes, uSeed;
uniform float uGrain, uGrainPx;
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main(){
  vec3 c = texture2D(uHist, gl_FragCoord.xy / uRes).rgb;
  c += (hash(floor(gl_FragCoord.xy / uGrainPx) + uSeed) - 0.5) * uGrain;
  gl_FragColor = vec4(c, 1.0);
}`;
  const sh = (type, src) => {
    const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
    return o;
  };
  const program = fsrc => {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsrc));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const U = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let k = 0; k < n; k++) { const name = gl.getActiveUniform(p, k).name; U[name] = gl.getUniformLocation(p, name); }
    return { p, U };
  };
  let scan, show;
  try { scan = program(scanFS); show = program(showFS); } catch (err) { console.warn('slit shader 失敗', err); return null; }

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

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
  // 形狀表：每一輪一列，半徑用 16 位元存在 R、G 兩個通道（8 位元會讓外框有鋸齒）
  const shapeTex = tex(1, gl.NEAREST);
  const rows = radial.length, data = new Uint8Array(BINS * rows * 4);
  radial.forEach((R, row) => {
    for (let b = 0; b < BINS; b++) {
      const v = Math.round(clamp01(R[b]) * 65535), o = (row * BINS + b) * 4;
      data[o] = v >> 8; data[o + 1] = v & 255; data[o + 2] = 0; data[o + 3] = 255;
    }
  });
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, BINS, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  // 鏡頭
  const camTex = tex(0, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
  // 累積的畫面（離屏，大小和畫布一樣）
  let hist = null, fbo = null, hw = 0, hh = 0;
  const BG = hex(BG_COLOR);
  const ensure = () => {
    const w = canvas.width, h = canvas.height;
    if (hist && w === hw && h === hh) return;
    const old = hist, oldFbo = fbo;
    hist = tex(2, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hist, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(BG[0], BG[1], BG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (old) {   // 視窗大小變了：把原本的畫面拉伸搬過來
      gl.useProgram(show.p);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, old);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(show.U.uHist, 3); gl.uniform2f(show.U.uRes, w, h); gl.uniform1f(show.U.uGrain, 0); gl.uniform1f(show.U.uGrainPx, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.deleteTexture(old); gl.deleteFramebuffer(oldFbo);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    hw = w; hh = h;
  };

  let texW = 0, texH = 0, fresh = true, watching = null;
  const watch = v => {
    if (watching === v || !v.requestVideoFrameCallback) return;
    watching = v;
    const cb = () => { fresh = true; v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
  };

  let lutTex = null;
  return {
    // 套用調色：L 是 parseCube() 的結果
    setLut(L) {
      gl.useProgram(scan.p);
      lutTex = uploadLut(gl, scan.p, L, 4, lutTex);
      gl.uniform1f(scan.U.uUseLut, 1);
    },
    clear() {
      if (gl.isContextLost()) return;
      ensure();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.clearColor(BG[0], BG[1], BG[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    // 磁頭從 last 長到 cur（CSS px）：這一圈寫進鏡頭畫面
    scan(video, stage, round, last, cur) {
      if (gl.isContextLost()) return;
      ensure();
      watch(video);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, camTex);
      const vw = video.videoWidth, vh = video.videoHeight;
      if (fresh || !video.requestVideoFrameCallback) {
        if (vw !== texW || vh !== texH) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video); texW = vw; texH = vh; }
        else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, video);
        fresh = false;
      }
      const w = hw, h = hh, d = w / stage.width;
      const A = w / h, V = vw / vh;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, w, h);
      // 只算磁頭外框以內的方塊（形狀最遠的一點 = cur）
      const half = Math.ceil(cur * d) + 2;
      const x0 = Math.max(0, Math.floor(w / 2 - half)), y0 = Math.max(0, Math.floor(h / 2 - half));
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x0, y0, Math.min(w, Math.ceil(w / 2 + half)) - x0, Math.min(h, Math.ceil(h / 2 + half)) - y0);
      gl.useProgram(scan.p);
      const U = scan.U;
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, shapeTex);
      gl.uniform1i(U.uCam, 0); gl.uniform1i(U.uShape, 1);
      gl.uniform2f(U.uRes, w, h);
      gl.uniform2f(U.uCamScale, A > V ? 1 : A / V, A > V ? V / A : 1);
      gl.uniform1f(U.uD, d);
      gl.uniform1f(U.uRow, round); gl.uniform1f(U.uRows, rows);
      gl.uniform1f(U.uLast, last); gl.uniform1f(U.uCur, cur);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    show() {
      if (gl.isContextLost()) return;
      ensure();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(show.p);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, hist);
      const U = show.U, d = canvas.width / (canvas.clientWidth || canvas.width);
      gl.uniform1i(U.uHist, 2);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform2f(U.uSeed, Math.random() * 1000, Math.random() * 1000);
      gl.uniform1f(U.uGrain, GRAIN_AMOUNT);
      gl.uniform1f(U.uGrainPx, Math.max(1, GRAIN_SIZE * d));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
