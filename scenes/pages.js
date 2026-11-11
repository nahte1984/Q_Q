/* ==========================================================================
   pages — 假文章鋪滿整個畫面，中間一塊鏡頭網點，一秒六格的定格動畫
   --------------------------------------------------------------------------
   版面照 Figma「pages」（388 × 743 的畫面），依螢幕大小等比縮放：
     背景      每次進場在 COLORS 裡隨機選一個顏色；點畫面任一處再隨機換一個
     假文章    Roboto Slab 16px、#313131；文字框比畫面寬（Figma：611 寬、從 -116 開始），
              所以每一行的頭尾都被畫面切掉；一直鋪到畫面最下面
     鏡頭      置中的 256 × 274 矩形，前鏡頭畫面像 object-fit: cover 一樣鋪滿、左右鏡像，
              做成 grainrad 的 Halftone（參數見 HALFTONE：黑底白點），直接蓋在文章上（不混色）
   定格：      一秒取樣 STEPS_PER_SEC（6）次，照歌曲時間對齊。每一格重新產生一篇假文章、
              抓一張鏡頭的靜態畫面做網點；兩格之間畫面完全不動，所以看起來像 stop motion。

   22041 ms   一格一格（定格的節奏）淡入，蓋過上一段 rain（index.html 用 transition: 'over'）。
   30089 ms   一格一格淡出，32259 ms 完全消失，露出下面已經開始的 word（transition: 'under'）。
   ========================================================================== */

/* ---------- 時間 ---------- */
const STEPS_PER_SEC = 6;                 // 一秒幾格（假文章重新產生、鏡頭重新取樣的次數）
const START = 22041;                     // 上場（index.html 裡 pages 那一行的 at）
const INTRO = 1300;                      // 淡入要多久（毫秒；index.html 裡 pages 那一行的 dur）
const OUTRO_FROM = 30089;                // 開始淡出（index.html 裡 word 那一行的 at）
const OUTRO_TO = 32259;                  // 完全消失（word 那一行的 at + dur）

/* ---------- 版面（Figma pages，388 × 743） ---------- */
// 背景色：每次進場、每次點畫面都從這裡隨機選一個（Figma Page 1 的色票，和 word 的漸層色一樣）
const COLORS = ['#d2d6d3', '#f8efce', '#ffcdb4', '#cdb2f1', '#ccebc8', '#ffb5d3', '#ff8f8f'];
const TEXT = { size: 16, color: '#313131', left: -115.963, top: -11.485, width: 611 };   // 假文章（px，以 388 寬的畫面計）
const IMG = { w: 256, h: 274 };          // 中間的鏡頭矩形（置中）

/* ---------- 網點（grainrad Halftone，照截圖的設定） ---------- */
const HALFTONE = {
  shape: 'circle',                       // Circle
  dotScale: 0.5,                         // Dot Scale（grainrad 用在紙張紋理的強度）
  spacing: 5,                            // Spacing（以 720p 的鏡頭畫面為單位）
  angle: 45,                             // Angle（度）
  invert: false,                         // Invert
  brightness: 0,                         // Brightness（-100～100）
  contrast: 10,                          // Contrast（-100～100）
  fg: '#ffffff',                         // Mono：Foreground（網點）
  bg: '#000000',                         // Mono：Background（網點之間）
};
// 網點大小：1 = 照 grainrad（鏡頭畫面短邊當作 720 像素）；覺得太細或太粗就調這個
const EFFECT_SCALE = 2;
const MIN_DOT_PX = 3;                    // 網點間距至少幾個螢幕像素（電腦螢幕像素比較大，太細會出現摩爾紋）

/* ---------- 假文章（Lorem Ipsum） ---------- */
const WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit integer pretium lectus finibus quis consequat ante pharetra ' +
  'aliquet mauris malesuada tincidunt arcu leo vulputate libero vitae imperdiet felis nec sapien viverra enim eu massa bibendum auctor ' +
  'morbi blandit purus et suscipit pellentesque sed fringilla augue odio efficitur nisl dapibus nulla in mi vel metus suspendisse mollis ' +
  'est maecenas interdum tortor non lacus etiam magna diam tempus ut semper rutrum vivamus euismod convallis tempor erat nunc mattis ac ' +
  'at justo class aptent taciti sociosqu ad litora torquent per conubia nostra inceptos himenaeos aenean luctus lobortis nibh feugiat ' +
  'accumsan id orci nam placerat molestie ultricies porttitor dignissim scelerisque dictum dui fusce commodo donec sagittis ornare ' +
  'ullamcorper eleifend tristique laoreet facilisi porta elementum rhoncus aliquam varius risus eget venenatis ultrices praesent quam ' +
  'duis urna iaculis nisi nullam curabitur condimentum neque turpis egestas faucibus posuere fames primis tellus facilisis gravida cursus ' +
  'velit mattis pulvinar congue vestibulum hendrerit sollicitudin volutpat cras proin phasellus quisque semper fermentum').split(' ');
const OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';   // 第一段的開頭（和 Figma 一樣）

const clamp01 = x => Math.max(0, Math.min(1, x));
const hex = h => { const v = parseInt(h.slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];

// 一句：6–16 個字，第一個字大寫，中間偶爾有逗號
function sentence() {
  const n = rint(6, 16), w = [];
  for (let i = 0; i < n; i++) w.push(pick(WORDS) + (i > 1 && i < n - 2 && Math.random() < 0.12 ? ',' : ''));
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return w.join(' ').replace(/,$/, '') + '.';
}
// 一段：3–9 句
function paragraph(first) {
  const s = first ? [OPENING] : [];
  for (let i = rint(3, 9) - s.length; i > 0; i--) s.push(sentence());
  return s.join(' ');
}

const CSS = `
.pg{position:absolute;inset:0;overflow:hidden;isolation:isolate;opacity:0;-webkit-user-select:none;user-select:none}
.pg-txt{position:absolute;margin:0;color:${TEXT.color};font-family:"Roboto Slab",Georgia,serif;font-weight:400;line-height:normal;
  text-align:left;overflow-wrap:break-word;pointer-events:none}
.pg-txt p{margin:0}
.pg-img{position:absolute;pointer-events:none}
`;

export default {
  name: 'pages',
  needs: { camera: true, motion: false },
  dev: { from: START, to: OUTRO_TO },

  async preload(stage) {
    if (!document.getElementById('pg-css')) {
      const st = document.createElement('style'); st.id = 'pg-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    const el = this.el = document.createElement('div');
    el.className = 'pg';
    el.innerHTML = '<div class="pg-txt"></div><canvas class="pg-img"></canvas>';
    stage.root.appendChild(el);
    this.txt = el.querySelector('.pg-txt');
    this.canvas = el.querySelector('.pg-img');
    this.gl = halftoneLayer(this.canvas);
    if (!this.gl) this.canvas.style.display = 'none';
    this.color = null;
    this.recolor();
    // 點畫面任一處：背景在 COLORS 裡隨機換成另一個顏色
    stage.root.addEventListener('pointerdown', () => { if (this.active) this.recolor(); });
    this.layout(stage);
    this.write();                                    // 暖機：先排一次字
  },

  // 版面：和其他段落一樣依畫面縮放；文字框比畫面寬，左右各超出一點
  layout(stage) {
    const W = stage.width, H = stage.height;
    const s = Math.max(0.82, Math.min(1.45, Math.min(W / 388, H / 743)));
    const over = -TEXT.left * s;                     // 文字框左邊超出畫面多少
    const right = (TEXT.width + TEXT.left - 388) * s; // 右邊超出多少
    Object.assign(this.txt.style, {
      left: -over + 'px', top: TEXT.top * s + 'px', width: W + over + right + 'px', fontSize: TEXT.size * s + 'px',
    });
    const w = IMG.w * s, h = IMG.h * s;
    this.rect = { x: (W - w) / 2, y: (H - h) / 2, w, h };
    Object.assign(this.canvas.style, { left: this.rect.x + 'px', top: this.rect.y + 'px', width: w + 'px', height: h + 'px' });
    const d = Math.min(3, stage.dpr || window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(w * d));
    this.canvas.height = Math.max(1, Math.round(h * d));
    this.H = H;
    this.tick = null;                                // 下一幀重畫
  },

  // 背景隨機換成 COLORS 裡的另一個顏色（不會跟現在的一樣）
  recolor() {
    let c;
    do c = pick(COLORS); while (c === this.color && COLORS.length > 1);
    this.color = c;
    this.el.style.background = c;
  },

  // 產生一篇新的假文章，鋪到畫面最下面為止
  write() {
    const t = this.txt, need = (this.H || 800) - parseFloat(t.style.top || 0) + 30;
    let html = '<p>' + paragraph(true) + '</p>';
    t.innerHTML = html;
    for (let i = 0; i < 20 && t.offsetHeight < need; i++) {   // 不夠就再加一段
      html += '<p>' + paragraph(false) + '</p>';
      t.innerHTML = html;
    }
  },

  enter(stage) {
    this.active = true;
    this.recolor();                                  // 每次進場隨機一個背景色
    this.tick = null;
    this.el.style.opacity = '0';
  },

  update(stage, f) {
    // 定格：照歌曲時間切成一秒 6 格，換格的時候才更新畫面
    const tick = Math.floor(f.t * STEPS_PER_SEC);
    if (tick === this.tick) return;
    this.tick = tick;
    const ms = tick * 1000 / STEPS_PER_SEC;           // 這一格的時間
    // 淡入、淡出也跟著一格一格跳
    const a = clamp01((ms - START) / INTRO + 1 / (INTRO / 1000 * STEPS_PER_SEC)) *
      (1 - clamp01((ms - OUTRO_FROM) / (OUTRO_TO - OUTRO_FROM)));
    this.el.style.opacity = String(a);
    if (a <= 0) return;
    this.write();
    const v = stage.camera;
    if (this.gl && v && v.videoWidth > 0) {
      this.canvas.style.display = '';
      this.gl.draw(v, this.rect, this.canvas.width / this.rect.w);
    } else this.canvas.style.display = 'none';       // 沒有鏡頭就只有文章
  },

  exit() {
    this.active = false;
    this.el.style.opacity = '0';
  },

  resize(stage) { this.layout(stage); },
};

/* ---------- WebGL：grainrad 的 Halftone（Mono），只在換格時畫一次 ---------- */
function halftoneLayer(canvas) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const N = v => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  const H = HALFTONE;
  const c = H.contrast / 100, bri = H.brightness / 100, con = (1 + c) / (1 - c * 0.99);   // grainrad 的亮度／對比
  const SHAPE = { circle: 'length(n)', square: 'max(abs(n.x), abs(n.y))', diamond: 'abs(n.x) + abs(n.y)', line: 'abs(n.y)' }[H.shape];
  const [fr, fg, fb] = hex(H.fg), [br, bg, bb] = hex(H.bg);
  const vs = `
attribute vec2 p;
void main(){ gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  const fs = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uCam;
uniform vec2 uRes, uCamScale;
uniform float uUnit;                 // 每個 grainrad 像素是幾個螢幕像素

// 紙張紋理用的 simplex noise（grainrad 一樣用 Ian McEwan, Ashima Arts 的版本）
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x){ return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);      // 矩形裡的位置（螢幕像素，y 往下）
  // 鏡頭：像 cover 一樣鋪滿矩形，左右鏡像
  vec2 t = (px / uRes - 0.5) * uCamScale + 0.5;
  t.x = 1.0 - t.x;
  vec3 col = clamp((texture2D(uCam, t).rgb + ${N(bri)} - 0.5) * ${N(con)} + 0.5, 0.0, 1.0);
  vec2 q = px / uUnit;                                          // grainrad 的像素座標
  float paper = (snoise(q * 0.1) * 0.5 + snoise(q * 0.2) * 0.25 + snoise(q * 0.4) * 0.125) * 0.02 * ${N(H.dotScale)};
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  ${H.invert ? 'lum = 1.0 - lum;' : ''}
  // 網點：轉 ${H.angle} 度的格子，越亮的地方點越大
  float a = radians(${N(H.angle)}), s = sin(a), c = cos(a);
  float freq = 1.0 / ${N(H.spacing)};
  vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * freq;
  vec2 n = r - floor(r) - 0.5;
  float dist = ${SHAPE};
  float radius = sqrt(max(lum + paper, 0.0)) * 0.5;
  float aa = 0.7 * freq / uUnit;                                // 邊緣柔化一個像素
  float pattern = smoothstep(radius - aa, radius + aa, dist);  // 0 = 網點、1 = 網點之間
  gl_FragColor = vec4(mix(vec3(${N(fr)}, ${N(fg)}, ${N(fb)}), vec3(${N(br)}, ${N(bg)}, ${N(bb)}), pattern), 1.0);
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
  } catch (err) { console.warn('pages shader 失敗', err); return null; }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
  const U = {};
  for (const n of ['uCam', 'uRes', 'uCamScale', 'uUnit']) U[n] = gl.getUniformLocation(prog, n);
  gl.uniform1i(U.uCam, 0);
  let texW = 0, texH = 0;

  return {
    // video：前鏡頭；rect：矩形（CSS px）；d：每個 CSS px 有幾個螢幕像素
    draw(video, rect, d) {
      if (gl.isContextLost()) return;
      const vw = video.videoWidth, vh = video.videoHeight;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // 抓這一刻的鏡頭畫面（定格：一秒只抓 6 次）
      if (vw !== texW || vh !== texH) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video); texW = vw; texH = vh; }
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, video);
      const w = canvas.width, h = canvas.height, A = rect.w / rect.h, V = vw / vh;
      // 網點的單位：鏡頭畫面短邊當作 720 個 grainrad 像素，跟著鏡頭畫面在矩形裡的大小
      const cover = Math.max(rect.w / vw, rect.h / vh);          // 每個鏡頭像素是幾個 CSS px
      let unit = cover * Math.min(vw, vh) / 720 * EFFECT_SCALE * d;
      unit = Math.max(unit, MIN_DOT_PX / HALFTONE.spacing);
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.uRes, w, h);
      gl.uniform2f(U.uCamScale, A > V ? 1 : A / V, A > V ? V / A : 1);
      gl.uniform1f(U.uUnit, unit);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
  };
}
