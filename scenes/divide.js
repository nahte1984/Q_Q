/* ==========================================================================
   divide — 九宮格鏡頭，九種 grainrad 效果拼成一個完整的畫面
   --------------------------------------------------------------------------
   29800 ms   rain 整個畫面縮小進中間那一格，九宮格出現。
              前鏡頭畫面鋪滿整個九宮格（像 object-fit: cover），每一格只露出自己那一塊，
              再各自套一種 grainrad 的效果；九格拼起來就是原本完整的鏡頭畫面（格子之間的縫會蓋掉一點）。
   版面：      格子和格子、格子和瀏覽器邊界都距離 5px，九宮格放到最大，直到碰到畫面的寬或高；
              格子比例照 Figma「Frame 4」（122 × 197），圓角 5。

   效果的演算法照 grainrad.com 的 shader 寫（參數用截圖 01–09 的設定），
   由左到右、由上到下：
     01 Halftone    02 ASCII（DETAILED）03 Contour
     04 Noise Field 05 Blockify         06 Dithering
     07 Dots        08 Voronoi          09 Threshold
   九格一次用 WebGL 畫完，手機上也很輕。
   ========================================================================== */

/* ---------- 版面 ---------- */
const CARD_W = 122, CARD_H = 197;        // 格子比例（Figma）
const GAP = 5;                           // 格子之間、格子和瀏覽器邊界的距離（px）
const RADIUS = 5;                        // 圓角（px）
const BG_COLOR = '#313131';              // 格子外面

/* ---------- 效果的尺寸 ----------
   grainrad 的參數（間距 11、方塊 15…）是以 1280 × 720 的鏡頭畫面為單位。
   這裡把鏡頭畫面的高度（720）對齊九宮格的高度，所以效果和人臉的比例跟 grainrad 上看到的一樣。
   覺得點點、方塊太大或太小，就調 EFFECT_SCALE（1 = 照 grainrad；0.8 = 小 20%） */
const EFFECT_SCALE = 1;

/* ---------- 九種效果的參數（照截圖） ---------- */
const FX = {
  halftone:  { brightness: 15, contrast: 0, spacing: 11, angle: 45 },               // 01 Circle、Original
  ascii:     { brightness: 25, contrast: 0, scale: 3, spacing: 0.3 },                // 02 DETAILED、Original、背景黑
  contour:   { brightness: 30, contrast: -5, levels: 6, lineThickness: 0.5, lineColor: '#e0714f' },   // 03 Filled Bands、Original
  noise:     { brightness: 13, contrast: -5, scale: 100, intensity: 3, speed: 0.1 },  // 04 Perlin、1 octave、Animate
  blockify:  { brightness: 10, contrast: 0, blockSize: 15 },                         // 05 Full Blocks、Preserve Colors
  dithering: { brightness: -30, contrast: -30, gamma: 2, matrix: 8 },                 // 06 Bayer 8x8、Original、背景黑
  dots:      { brightness: 10, contrast: 0, size: 1, spacing: 2 },                    // 07 Diamond、Square Grid、Original
  voronoi:   { brightness: 5, contrast: 0, cellSize: 20, randomize: 1 },              // 08 Cell Average、Edge Width 0
  threshold: { brightness: -15, contrast: -25, levels: 6 },                           // 09 Threshold Point 0.1（6 階時用不到）、Original
};
// 03 的線條顏色：grainrad 在 Original 模式下不會顯示這個設定，這是從截圖取的顏色

// 顆粒（和 rain 的鏡頭一樣；不要顆粒就把 GRAIN_AMOUNT 改成 0）
const GRAIN_SIZE = 0.5, GRAIN_AMOUNT = 0.175;

/* ---------- ASCII 用的字 ---------- */
const ASCII_FONT = '"JetBrains Mono"';   // grainrad 的 ASCII 用粗體 JetBrains Mono
// DETAILED（grainrad 的字符組，越後面越亮）
const ASCII_CHARS = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const GLYPH_H = 64, GLYPH_W = Math.ceil(GLYPH_H * 0.6);

const hex = h => { const v = parseInt(h.slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
// grainrad 的亮度／對比：亮度 -100～100 → -1～1；對比 -100～100 → 係數
const bri = v => v / 100;
const con = v => { const c = v / 100; return (1 + c) / (1 - c * 0.99); };

export default {
  name: 'divide',
  needs: { camera: true },
  dev: { from: 29800, to: 40628 },

  async preload(stage) {
    this.canvas = stage.canvas({ dpr: Math.min(3, window.devicePixelRatio || 1) });
    await stage.font(`bold ${GLYPH_H}px ${ASCII_FONT}`, ASCII_CHARS);
    this.gl = effectLayer(this.canvas, bakeAtlas());
    if (!this.gl) console.warn('這個瀏覽器不支援 WebGL，divide 不會出現');
    else this.gl.draw(null, this.layout(stage), 0);   // 暖機
  },

  // 九宮格在畫面上的位置：四周和格子之間都留 GAP，格子放到最大（寬或高先碰到邊界為止），置中
  layout(stage) {
    const W = stage.width, H = stage.height;
    const cw = Math.max(1, Math.min((W - GAP * 4) / 3, (H - GAP * 4) / 3 * CARD_W / CARD_H));
    const ch = cw * CARD_H / CARD_W;
    const gw = cw * 3 + GAP * 2, gh = ch * 3 + GAP * 2;
    return { W, cw, ch, gw, gh, x: (W - gw) / 2, y: (H - gh) / 2 };
  },

  // 縮小轉場：上一段縮進中間那一格
  transitionTarget(stage) {
    const L = this.layout(stage);
    return { x: L.x + L.cw + GAP, y: L.y + L.ch + GAP, w: L.cw, h: L.ch, r: RADIUS };
  },

  update(stage, f) {
    if (!this.gl) return;
    const v = stage.camera;
    this.gl.draw(v && v.videoWidth > 0 ? v : null, this.layout(stage), f ? f.t : 0);
  },
};

function bakeAtlas() {
  const c = document.createElement('canvas');
  c.width = ASCII_CHARS.length * GLYPH_W; c.height = GLYPH_H;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.font = `bold ${GLYPH_H}px ${ASCII_FONT}, "SF Mono", "Courier New", monospace`;
  g.textBaseline = 'top';
  Array.from(ASCII_CHARS).forEach((ch, i) => g.fillText(ch, i * GLYPH_W, 0));
  return c;
}

/* ---------- WebGL：一次畫完九格 ---------- */
const N = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));   // 數字放進 shader
function effectLayer(canvas, atlas) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false });
  if (!gl) return null;
  const P = FX;
  const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const fs = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uCam, uAtlas;
uniform float uHasCam, uUnit, uTime, uGap, uRadius, uGrain, uGrainPx;
uniform vec2 uRes, uOrigin, uCard, uGridG, uCamScale, uSeed;
uniform vec3 uBg, uLine;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);
float luma(vec3 c){ return dot(c, LUMA); }
// grainrad 的亮度／對比
vec3 bc(vec3 c, float b, float k){ return clamp((c + b - 0.5) * k + 0.5, 0.0, 1.0); }
float grainHash(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

// 鏡頭：q 是 grainrad 的像素座標（從九宮格左上角起算）；鏡頭畫面像 cover 一樣鋪滿整個九宮格，左右鏡像
vec3 cam(vec2 q){
  if (uHasCam < 0.5) return vec3(0.0);
  vec2 t = (clamp(q / uGridG, 0.0, 1.0) - 0.5) * uCamScale + 0.5;
  t.x = 1.0 - t.x;
  return texture2D(uCam, t).rgb;
}

/* 01 Halftone */
vec3 fxHalftone(vec2 q){
  vec3 c = bc(cam(q), ${N(bri(P.halftone.brightness))}, ${N(con(P.halftone.contrast))});
  float a = radians(${N(P.halftone.angle)}), s = sin(a), co = cos(a);
  float freq = 1.0 / ${N(P.halftone.spacing)};
  vec2 r = vec2(q.x * co - q.y * s, q.x * s + q.y * co) * freq;
  float dist = length(fract(r) - 0.5);
  float radius = sqrt(luma(c)) * 0.5;
  float aa = 0.7 * freq / uUnit;                       // 邊緣柔化一個像素
  float pattern = smoothstep(radius - aa, radius + aa, dist);
  return mix(c, vec3(0.0), pattern);
}

/* 02 ASCII（DETAILED） */
vec3 fxAscii(vec2 q){
  vec2 cell = vec2(${N(P.ascii.scale * 8 * 0.6)}, ${N(P.ascii.scale * 8)});
  vec2 cp = floor(q / cell), cuv = fract(q / cell);
  float ob = ${N(P.ascii.brightness / 200)}, ok = ${N((P.ascii.contrast + 100) / 100)};
  float b = 0.0;
  b += clamp((luma(cam((cp + vec2(0.25, 0.25)) * cell)) + ob - 0.5) * ok + 0.5, 0.0, 1.0);
  b += clamp((luma(cam((cp + vec2(0.75, 0.25)) * cell)) + ob - 0.5) * ok + 0.5, 0.0, 1.0);
  b += clamp((luma(cam((cp + vec2(0.25, 0.75)) * cell)) + ob - 0.5) * ok + 0.5, 0.0, 1.0);
  b += clamp((luma(cam((cp + vec2(0.75, 0.75)) * cell)) + ob - 0.5) * ok + 0.5, 0.0, 1.0);
  float idx = floor(clamp(b * 0.25, 0.0, 0.9999) * ${N(ASCII_CHARS.length)});
  vec3 c = clamp((cam((cp + 0.5) * cell) + ob - 0.5) * ok + 0.5, 0.0, 1.0);
  float hg = ${N(P.ascii.spacing * 0.25)};             // 字和字之間的空隙（grainrad 的 Spacing）
  vec2 g = (cuv - hg) / (1.0 - 2.0 * hg);
  float inGap = step(0.0001, hg) * (1.0 - step(0.0, g.x) * step(g.x, 1.0) * step(0.0, g.y) * step(g.y, 1.0));
  g = clamp(g, vec2(0.5 / ${N(GLYPH_W)}, 0.5 / ${N(GLYPH_H)}), vec2(1.0 - 0.5 / ${N(GLYPH_W)}, 1.0 - 0.5 / ${N(GLYPH_H)}));
  float glyph = texture2D(uAtlas, vec2((idx + g.x) / ${N(ASCII_CHARS.length)}, g.y)).r * (1.0 - inGap);
  return c * glyph;                                     // 背景黑
}

/* 03 Contour */
float contourLum(vec2 q){ return luma(bc(cam(q), ${N(bri(P.contour.brightness))}, ${N(con(P.contour.contrast))})); }
vec3 fxContour(vec2 q){
  float L = ${N(P.contour.levels)}, d = ${N(P.contour.lineThickness)};
  vec3 c = bc(cam(q), ${N(bri(P.contour.brightness))}, ${N(con(P.contour.contrast))});
  float cq = floor(luma(c) * L);
  bool line = floor(contourLum(q + vec2(-d, 0.0)) * L) != cq || floor(contourLum(q + vec2(d, 0.0)) * L) != cq
           || floor(contourLum(q + vec2(0.0, -d)) * L) != cq || floor(contourLum(q + vec2(0.0, d)) * L) != cq;
  if (line) return uLine;
  return floor(c * L) / L + 0.5 / L;
}

/* 04 Noise Field（Perlin = value noise） */
float nHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(nHash(i), nHash(i + vec2(1.0, 0.0)), u.x), mix(nHash(i + vec2(0.0, 1.0)), nHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 fxNoise(vec2 q){
  vec2 tc = q / vec2(1280.0, 720.0);                    // grainrad 的 texCoord（以 1280 × 720 的畫面計）
  float at = uTime * ${N(P.noise.speed)};
  vec2 np = tc * ${N(P.noise.scale)} + vec2(at * 0.1);
  float n1 = 0.5 * vnoise(np), n2 = 0.5 * vnoise(np + vec2(100.0));   // 1 octave
  vec2 disp = (vec2(n1, n2) - 0.5) * 2.0 * ${N(P.noise.intensity)} * 0.02;
  vec3 c = bc(cam(clamp(q + disp * vec2(1280.0, 720.0), vec2(0.0), uGridG)), ${N(bri(P.noise.brightness))}, ${N(con(P.noise.contrast))});
  float overlay = 0.5 * vnoise(tc * ${N(P.noise.scale * 2)} + at) * 0.1;
  return clamp(c + overlay * ${N(P.noise.intensity)} * 0.3, 0.0, 1.0);
}

/* 05 Blockify */
vec3 fxBlockify(vec2 q){
  float s = ${N(P.blockify.blockSize)};
  return bc(cam((floor(q / s) + 0.5) * s), ${N(bri(P.blockify.brightness))}, ${N(con(P.blockify.contrast))});
}

/* 06 Dithering（Bayer 8×8） */
float m2(vec2 b){ return 2.0 * b.x + 3.0 * b.y - 4.0 * b.x * b.y; }
float bayer8(vec2 p){
  p = mod(p, 8.0);
  vec2 b0 = mod(p, 2.0), b1 = mod(floor(p / 2.0), 2.0), b2 = floor(p / 4.0);
  return (16.0 * m2(b0) + 4.0 * m2(b1) + m2(b2)) / 64.0;
}
vec3 fxDither(vec2 q){
  float g = ${N(P.dithering.matrix)};
  vec2 bp = floor(q / g);
  vec3 base = cam(bp * g);
  vec3 adj = pow(max(bc(base, ${N(bri(P.dithering.brightness))}, ${N(con(P.dithering.contrast))}), vec3(0.001)), vec3(${N(1 / P.dithering.gamma)}));
  return luma(adj) >= bayer8(bp) ? base : vec3(0.0);   // 背景黑
}

/* 07 Dots（Diamond、Square Grid） */
vec3 fxDots(vec2 q){
  float sp = 8.0 * ${N(P.dots.spacing)};
  vec2 cc = (floor(q / sp) + 0.5) * sp;
  vec3 c = bc(cam(cc), ${N(bri(P.dots.brightness))}, ${N(con(P.dots.contrast))});
  vec2 lp = abs(q - cc);
  float radius = sp * 0.4 * ${N(P.dots.size)} * (0.2 + luma(c) * 0.8);
  return (lp.x + lp.y) < radius * 1.4 ? c : vec3(0.0);
}

/* 08 Voronoi（Cell Average） */
vec2 vHash(vec2 p){
  vec2 k = vec2(0.3183099, 0.3678794);
  vec2 pp = p * k + k.yx;
  return fract(16.0 * k * fract(pp.x * pp.y * (pp.x + pp.y))) * 2.0 - 1.0;
}
vec3 fxVoronoi(vec2 q){
  float cs = ${N(P.voronoi.cellSize)};
  vec2 sp = q / cs, ip = floor(sp), fp = fract(sp), best = ip;
  float md = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 n = vec2(float(x), float(y));
    vec2 pt = n + 0.5 + vHash(ip + n) * ${N(P.voronoi.randomize)} * 0.5;
    float d = length(pt - fp);
    if (d < md) { md = d; best = ip + n; }
  }
  vec3 sum = vec3(0.0);
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) sum += cam((best + 0.5 + vec2(float(x), float(y)) * 0.2) * cs);
  return bc(sum / 25.0, ${N(bri(P.voronoi.brightness))}, ${N(con(P.voronoi.contrast))});
}

/* 09 Threshold（6 階、Original） */
vec3 fxThreshold(vec2 q){
  vec3 c = bc(cam(q), ${N(bri(P.threshold.brightness))}, ${N(con(P.threshold.contrast))});
  float L = ${N(P.threshold.levels)} - 1.0;
  return clamp(floor(c * L + 0.5) / L, 0.0, 1.0);
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) - uOrigin;   // 以九宮格左上角為原點，往下為正（裝置像素）
  vec2 stp = uCard + uGap;
  vec2 ij = floor(p / stp);
  vec3 col = uBg;
  if (ij.x >= 0.0 && ij.x < 3.0 && ij.y >= 0.0 && ij.y < 3.0) {
    vec2 l = p - ij * stp;
    vec2 r = abs(l - uCard * 0.5) - (uCard * 0.5 - uRadius);
    float inside = clamp(0.5 - (length(max(r, 0.0)) + min(max(r.x, r.y), 0.0) - uRadius), 0.0, 1.0);   // 圓角
    if (inside > 0.0) {
      vec2 q = p / uUnit;                                   // grainrad 的像素座標
      float k = ij.y * 3.0 + ij.x;
      vec3 c;
      if (k < 0.5) c = fxHalftone(q);
      else if (k < 1.5) c = fxAscii(q);
      else if (k < 2.5) c = fxContour(q);
      else if (k < 3.5) c = fxNoise(q);
      else if (k < 4.5) c = fxBlockify(q);
      else if (k < 5.5) c = fxDither(q);
      else if (k < 6.5) c = fxDots(q);
      else if (k < 7.5) c = fxVoronoi(q);
      else c = fxThreshold(q);
      c += (grainHash(floor(gl_FragCoord.xy / uGrainPx) + uSeed) - 0.5) * uGrain;
      col = mix(uBg, c, inside);
    }
  }
  gl_FragColor = vec4(col, 1.0);
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
  } catch (err) { console.warn('divide shader 失敗', err); return null; }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const mkTex = unit => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  };
  mkTex(1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, atlas);
  mkTex(0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));

  const u = n => gl.getUniformLocation(prog, n);
  const U = {};
  for (const n of ['uHasCam', 'uUnit', 'uTime', 'uGap', 'uRadius', 'uGrainPx', 'uRes', 'uOrigin', 'uCard', 'uGridG', 'uCamScale', 'uSeed']) U[n] = u(n);
  gl.uniform1i(u('uCam'), 0);
  gl.uniform1i(u('uAtlas'), 1);
  gl.uniform3fv(u('uBg'), hex(BG_COLOR));
  gl.uniform3fv(u('uLine'), hex(P.contour.lineColor));
  gl.uniform1f(u('uGrain'), GRAIN_AMOUNT);

  let texW = 0, texH = 0, fresh = true, watching = null;
  const watch = v => {
    if (watching === v || !v.requestVideoFrameCallback) return;
    watching = v;
    const cb = () => { fresh = true; v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
  };

  return {
    draw(video, L, time) {
      if (gl.isContextLost()) return;
      gl.activeTexture(gl.TEXTURE0);
      let V = 1;
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
      const Wd = canvas.width, Hd = canvas.height, d = Wd / L.W;   // d：每個 CSS px 有幾個像素
      const unit = L.gh / 720 * EFFECT_SCALE;                      // 每個 grainrad 像素是幾個 CSS px
      const A = L.gw / L.gh;
      gl.viewport(0, 0, Wd, Hd);
      gl.uniform1f(U.uHasCam, video ? 1 : 0);
      gl.uniform1f(U.uUnit, unit * d);
      gl.uniform1f(U.uTime, time || 0);
      gl.uniform2f(U.uRes, Wd, Hd);
      gl.uniform2f(U.uOrigin, L.x * d, L.y * d);
      gl.uniform2f(U.uCard, L.cw * d, L.ch * d);
      gl.uniform1f(U.uGap, GAP * d);
      gl.uniform1f(U.uRadius, RADIUS * d);
      gl.uniform2f(U.uGridG, L.gw / unit, L.gh / unit);
      gl.uniform2f(U.uCamScale, A > V ? 1 : A / V, A > V ? V / A : 1);
      gl.uniform2f(U.uSeed, Math.random() * 1000, Math.random() * 1000);
      gl.uniform1f(U.uGrainPx, Math.max(1, GRAIN_SIZE * d));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
