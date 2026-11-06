/* ==========================================================================
   divide — 九宮格 ASCII 鏡頭
   --------------------------------------------------------------------------
   29800 ms   rain 整個畫面縮小進中間那一格，九宮格出現。
              每一格用 grainrad 的一種字符組（Character Set）把前鏡頭畫面轉成 ASCII。
              格子和格子、格子和瀏覽器邊界都距離 15px，九宮格放到最大，直到碰到畫面的寬或高；
              格子比例照 Figma「Frame 4」（108 × 170），字跟著格子一起放大。

   演算法和 grainrad 的 ASCII 一樣：把畫面切成字元大小的格子，取每格的平均亮度，
   亮度 0–1 平均分配到字符組裡的字（越亮用越後面的字），字用米色、底用粉紅色。
   九格一次用 WebGL 畫完，手機上也很輕。
   ========================================================================== */

/* ---------- 可以調整的數字 ---------- */
// 九種字符組（grainrad 的 Character Set），由左到右、由上到下排；中間那格是 MINIMAL
const CHARSETS = [
  { name: 'STANDARD',   chars: ' .:-=+*#%@' },
  { name: 'BLOCKS',     chars: ' ░▒▓█' },
  { name: 'BINARY',     chars: ' 01' },
  { name: 'DETAILED',   chars: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$" },
  { name: 'MINIMAL',    chars: ' .:#' },
  { name: 'ALPHABETIC', chars: ' .icotCOXWM' },
  { name: 'NUMERIC',    chars: ' 1234567890' },
  { name: 'MATH',       chars: ' .-+×÷=≠<>≤≥∞∑∏√∫' },
  { name: 'SYMBOLS',    chars: ' ·•○◎●◐◑◒◓◔◕◖◗' },
];
const FONT = '"Share Tech Mono"';        // grainrad 用的等寬字（字型裡沒有的符號會用系統字型補）
const CHAR_H = 9;                        // 字元格子的高度（以 Figma 108px 寬的格子計，格子放大時字跟著放大）；寬度是高度的 0.6 倍
const CHAR_COLOR = '#f8efce';            // 字
const CARD_COLOR = '#da8a8a';            // 格子的底
const BG_COLOR = '#313131';              // 格子外面
const GRAIN_SIZE = 0.5, GRAIN_AMOUNT = 0.175;   // 格子上的顆粒（和 rain 的鏡頭一樣；不要顆粒就把 GRAIN_AMOUNT 改成 0）

// 版面
const CARD_W = 108, CARD_H = 170;        // 格子比例（Figma）
const GAP = 15;                          // 格子之間、格子和瀏覽器邊界的距離（px）
const RADIUS = 8;                        // 圓角（px）

/* ---------- 字元圖集：每種字符組一列 ---------- */
const GLYPH_W = 30, GLYPH_H = 50;        // 圖集裡每個字的格子（像素，寬:高 = 0.6）
const MAX_LEN = Math.max(...CHARSETS.map(c => Array.from(c.chars).length));
const ALL_CHARS = [...new Set(CHARSETS.flatMap(c => Array.from(c.chars)))].join('');

const hex = h => { const v = parseInt(h.slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };

export default {
  name: 'divide',
  needs: { camera: true },
  dev: { from: 29800, to: 40628 },

  async preload(stage) {
    this.canvas = stage.canvas({ dpr: Math.min(3, window.devicePixelRatio || 1) });
    await stage.font(`${GLYPH_H}px ${FONT}`, ALL_CHARS);
    this.gl = asciiLayer(this.canvas, bakeAtlas());
    if (!this.gl) console.warn('這個瀏覽器不支援 WebGL，divide 不會出現');
    else this.gl.draw(null, this.layout(stage));   // 暖機
  },

  // 九宮格在畫面上的位置：四周和格子之間都留 GAP，格子放到最大（寬或高先碰到邊界為止），置中
  layout(stage) {
    const W = stage.width, H = stage.height;
    const cw = Math.max(1, Math.min((W - GAP * 4) / 3, (H - GAP * 4) / 3 * CARD_W / CARD_H));
    const ch = cw * CARD_H / CARD_W;
    return { W, cw, ch, s: cw / CARD_W, x: (W - cw * 3 - GAP * 2) / 2, y: (H - ch * 3 - GAP * 2) / 2 };
  },

  // 縮小轉場：上一段縮進中間那一格
  transitionTarget(stage) {
    const L = this.layout(stage);
    return { x: L.x + L.cw + GAP, y: L.y + L.ch + GAP, w: L.cw, h: L.ch, r: RADIUS };
  },

  update(stage) {
    if (!this.gl) return;
    const v = stage.camera;
    this.gl.draw(v && v.videoWidth > 0 ? v : null, this.layout(stage));
  },
};

function bakeAtlas() {
  const c = document.createElement('canvas');
  c.width = MAX_LEN * GLYPH_W; c.height = CHARSETS.length * GLYPH_H;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.font = `${GLYPH_H}px ${FONT}, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  CHARSETS.forEach((set, row) => {
    Array.from(set.chars).forEach((ch, i) => {
      g.fillText(ch, i * GLYPH_W + GLYPH_W / 2, row * GLYPH_H + GLYPH_H * 0.8, GLYPH_W);   // 和 grainrad 一樣，基線在 0.8 的位置
    });
  });
  return c;
}

/* ---------- WebGL：一次畫完九格 ---------- */
function asciiLayer(canvas, atlas) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false });
  if (!gl) return null;
  const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const fs = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uCam, uAtlas;
uniform float uHasCam;
uniform vec2 uRes, uOrigin, uCard, uChar, uAtlasGrid, uCamScale, uSeed;
uniform float uGap, uRadius, uGrain, uGrainPx;
uniform float uLen[9];
uniform vec3 uCharCol, uCardCol, uBg;
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float luma(vec2 cardUV){
  vec2 t = (cardUV - 0.5) * uCamScale + 0.5;     // 像 object-fit: cover
  t.x = 1.0 - t.x;                               // 前鏡頭左右鏡像
  return dot(texture2D(uCam, t).rgb, vec3(0.299, 0.587, 0.114));
}
void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) - uOrigin;   // 以九宮格左上角為原點，往下為正
  vec2 stp = uCard + uGap;
  vec2 ij = floor(p / stp);
  vec3 col = uBg;
  if (ij.x >= 0.0 && ij.x < 3.0 && ij.y >= 0.0 && ij.y < 3.0) {
    vec2 l = p - ij * stp;                                             // 格子內的位置
    vec2 q = abs(l - uCard * 0.5) - (uCard * 0.5 - uRadius);
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;   // 圓角
    float inside = clamp(0.5 - d, 0.0, 1.0);
    if (inside > 0.0) {
      float k = ij.y * 3.0 + ij.x;
      vec2 cell = floor(l / uChar), f = fract(l / uChar);
      // 每個字元格子取 2×2 個點的平均亮度
      float b = 0.0;
      if (uHasCam > 0.5) {
        b += luma((cell + vec2(0.25, 0.25)) * uChar / uCard);
        b += luma((cell + vec2(0.75, 0.25)) * uChar / uCard);
        b += luma((cell + vec2(0.25, 0.75)) * uChar / uCard);
        b += luma((cell + vec2(0.75, 0.75)) * uChar / uCard);
        b *= 0.25;
      }
      float len = 1.0;
      for (int i = 0; i < 9; i++) { if (float(i) == k) len = uLen[i]; }
      float idx = floor(clamp(b, 0.0, 0.9999) * len);                 // 亮度平均分配到字符組
      f = clamp(f, vec2(0.02), vec2(0.98));
      float g = texture2D(uAtlas, (vec2(idx, k) + f) / uAtlasGrid).r;
      vec3 c = mix(uCardCol, uCharCol, g);
      c += (hash(floor(gl_FragCoord.xy / uGrainPx) + uSeed) - 0.5) * uGrain;
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
  for (const n of ['uHasCam', 'uRes', 'uOrigin', 'uCard', 'uChar', 'uCamScale', 'uSeed', 'uGap', 'uRadius', 'uGrainPx']) U[n] = u(n);
  gl.uniform1i(u('uCam'), 0);
  gl.uniform1i(u('uAtlas'), 1);
  gl.uniform2f(u('uAtlasGrid'), MAX_LEN, CHARSETS.length);
  gl.uniform1fv(u('uLen'), new Float32Array(CHARSETS.map(c => Array.from(c.chars).length)));
  gl.uniform3fv(u('uCharCol'), hex(CHAR_COLOR));
  gl.uniform3fv(u('uCardCol'), hex(CARD_COLOR));
  gl.uniform3fv(u('uBg'), hex(BG_COLOR));
  gl.uniform1f(u('uGrain'), GRAIN_AMOUNT);

  let texW = 0, texH = 0, fresh = true, watching = null;
  const watch = v => {
    if (watching === v || !v.requestVideoFrameCallback) return;
    watching = v;
    const cb = () => { fresh = true; v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
  };

  return {
    draw(video, L) {
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
      const A = CARD_W / CARD_H;
      gl.viewport(0, 0, Wd, Hd);
      gl.uniform1f(U.uHasCam, video ? 1 : 0);
      gl.uniform2f(U.uRes, Wd, Hd);
      gl.uniform2f(U.uOrigin, L.x * d, L.y * d);
      gl.uniform2f(U.uCard, L.cw * d, L.ch * d);
      gl.uniform2f(U.uChar, CHAR_H * 0.6 * L.s * d, CHAR_H * L.s * d);
      gl.uniform1f(U.uGap, GAP * d);
      gl.uniform1f(U.uRadius, RADIUS * d);
      gl.uniform2f(U.uCamScale, A > V ? 1 : A / V, A > V ? V / A : 1);
      gl.uniform2f(U.uSeed, Math.random() * 1000, Math.random() * 1000);
      gl.uniform1f(U.uGrainPx, Math.max(1, GRAIN_SIZE * d));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
