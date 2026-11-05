/* ==========================================================================
   載入畫面
   --------------------------------------------------------------------------
   index.html 會自動拿它當 MV 的開場：素材載入時顯示 Loading，載完變成 PLAY。
   直接打開 scenes/loading.html 可以單獨預覽（模擬載入，網址加 ?sim=8000 可以放慢）。

   版面依 Figma「Group 1」：卡片 190 × 420，置中，依螢幕大小等比縮放。
   背景：五個顏色像 Apple Music 播放畫面那樣緩慢交融（WebGL）。
   ========================================================================== */

// 背景的五個顏色（Figma 右邊那五個）
const COLORS = ['#f8efce', '#ffc2b4', '#d2d6d3', '#ccebc8', '#ff8f8f'];
// 背景流動速度：1 = 預設，2 = 兩倍快
const SPEED = 1;
// 封面（相對於這個檔）
const COVER = '../images/cover.webp';

const CSS = `
.ld{position:absolute;inset:0;overflow:hidden;background:#f8efce;transition:opacity .7s ease}
.ld.gone{opacity:0;pointer-events:none}
.ld-bg{position:absolute;inset:0;width:100%;height:100%;display:block}
.ld.nogl{background:linear-gradient(160deg,#f8efce 0%,#ffc2b4 30%,#d2d6d3 55%,#ccebc8 78%,#ff8f8f 100%)}
.ld.nogl .ld-bg{display:none}
.ld-card{position:absolute;left:50%;top:50%;width:190px;height:420px;transform:translate(-50%,-50%) scale(var(--s,1));opacity:0;transition:opacity .9s ease}
.ld.in .ld-card{opacity:1}
.ld-cover{position:absolute;left:0;top:0;width:190px;height:190px;border-radius:10px;box-shadow:0 4px 20px 2px rgba(0,0,0,.1);object-fit:cover;display:block;background:#d2d6d3}
.ld-title{position:absolute;left:0;top:209px;font:26px/34px "BIZ UDPMincho","Hiragino Mincho ProN","Songti TC",serif;color:#748180;white-space:nowrap}
.ld-artist{position:absolute;right:0;top:211px;width:15px;font:15px/17px "Shippori Antique","PingFang TC",sans-serif;color:#748180;text-align:center}
.ld-line{position:absolute;left:0;top:332px;width:190px;height:1px;background:#fff}
.ld-line i{position:absolute;left:0;top:0;height:100%;width:0;background:#748180}
.ld-cap{position:absolute;left:0;top:349px;width:190px;text-align:center;font:12px/17px "Roboto Slab",Georgia,serif;color:#748180;white-space:nowrap}
.ld-btn{position:absolute;left:27px;top:382px;width:135px;height:38px;padding:0;border:0;border-radius:50px;background:#bfbfbf;color:#e5e5e5;font:22px/19px "Roboto Slab",Georgia,serif;cursor:default;transition:background-color .5s ease,opacity .3s ease;-webkit-tap-highlight-color:transparent;outline:none}
.ld-btn span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:opacity .45s ease}
.ld-btn .p{opacity:0}
.ld.ready .ld-btn{background:#748180;cursor:pointer}
.ld.ready .ld-btn .l{opacity:0}
.ld.ready .ld-btn .p{opacity:1}
@media (hover:hover){.ld.ready .ld-btn:hover{background:#68736f}}
.ld.ready .ld-btn:active{background:#5f6a67}
.ld.starting .ld-btn{pointer-events:none;opacity:.7}
`;

const wait = ms => new Promise(r => setTimeout(r, ms));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export default {
  type: 'loading',
  name: '載入畫面',

  // el：全螢幕的容器；ctx.asset(p)：把相對路徑換成網址
  mount(el, ctx) {
    if (!document.getElementById('ld-css')) {
      const s = document.createElement('style'); s.id = 'ld-css'; s.textContent = CSS; document.head.appendChild(s);
    }
    this.stop();
    el.innerHTML =
      '<div class="ld">' +
        '<canvas class="ld-bg"></canvas>' +
        '<div class="ld-card">' +
          '<img class="ld-cover" alt="">' +
          '<div class="ld-title">每個人<br>都是<br>一種文體</div>' +
          '<div class="ld-artist">梅<br>林<br>玫<br>羚</div>' +
          '<div class="ld-line"><i></i></div>' +
          '<div class="ld-cap">Interactive Music Video</div>' +
          '<button class="ld-btn" type="button" disabled><span class="l">Loading</span><span class="p">PLAY</span></button>' +
        '</div>' +
      '</div>';
    this.root = el.querySelector('.ld');
    this.card = el.querySelector('.ld-card');
    this.bar = el.querySelector('.ld-line i');
    this.btn = el.querySelector('.ld-btn');
    this.btn.addEventListener('click', () => { if (this.isReady && this.go) this.go(); });

    this.target = 0; this.shown = 0; this.isReady = false; this.wantReady = false; this.go = null;

    this.bg = colorBlend(el.querySelector('.ld-bg'), COLORS, { speed: SPEED });
    if (!this.bg) this.root.classList.add('nogl');
    else this.bg.draw(performance.now() / 1000);   // 馬上畫第一幀，canvas 不會先黑一下

    this._fit = () => {
      // 用容器的尺寸（手機橫式時容器維持直式尺寸，卡片就不會跟著變）
      const W = this.root ? this.root.clientWidth : innerWidth, H = this.root ? this.root.clientHeight : innerHeight;
      const s = clamp(Math.min(W / 388, H / 743), 0.82, 1.45);
      this.card.style.setProperty('--s', s.toFixed(4));
    };
    this._fit();
    addEventListener('resize', this._fit);

    // 封面和字型都好了才淡入卡片（最多等 2.5 秒）
    const img = el.querySelector('.ld-cover');
    const imgP = new Promise(r => { img.onload = img.onerror = r; img.src = ctx.asset(COVER); });
    const root = this.root;
    Promise.race([Promise.all([imgP, fontsReady()]), wait(2500)]).then(() => root.classList.add('in'));

    let last = performance.now();
    const tick = now => {
      if (this.root !== root) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (this.bg) this.bg.draw(now / 1000);
      // 進度線平滑前進
      this.shown += (this.target - this.shown) * (1 - Math.exp(-dt * 7));
      if (this.wantReady && this.target - this.shown < 0.004) this.shown = 1;
      this.bar.style.width = (this.shown * 190).toFixed(2) + 'px';
      if (this.wantReady && this.shown >= 1 && !this.isReady) {
        this.isReady = true;
        this.btn.disabled = false;
        this.root.classList.add('ready');
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },

  // p：0–1
  progress(p) { this.target = Math.max(this.target, clamp(p, 0, 1)); },

  // 全部載完：進度線走完後按鈕變 PLAY，按下去呼叫 go()
  ready(go) { this.go = go; this.target = 1; this.wantReady = true; },

  // 按下 PLAY 之後（等相機權限時）
  starting() { if (this.root) { this.root.classList.add('starting'); this.btn.disabled = true; } },

  message() {},

  // 淡出，結束後停掉背景
  hide() {
    const root = this.root;
    if (!root) return Promise.resolve();
    root.classList.add('gone');
    return wait(750).then(() => { if (this.root === root) this.stop(); });
  },

  stop() {
    cancelAnimationFrame(this.raf);
    if (this.bg) this.bg.destroy();
    this.bg = null;
    if (this._fit) removeEventListener('resize', this._fit);
    this.root = null;
  },
};

async function fontsReady() {
  if (!document.fonts || !document.fonts.load) return;
  // 先等 Google Fonts 的 CSS 載入，字型才有定義
  const links = [...document.querySelectorAll('link[href*="fonts.googleapis.com/css2"]')];
  await Promise.all(links.map(l => l.sheet ? 0 : new Promise(r => { l.addEventListener('load', r, { once: true }); l.addEventListener('error', r, { once: true }); })));
  await Promise.all([
    document.fonts.load('26px "BIZ UDPMincho"', '每個人都是一種文體'),
    document.fonts.load('15px "Shippori Antique"', '梅林玫羚'),
    document.fonts.load('22px "Roboto Slab"', 'Loading PLAY Interactive Music Video'),
  ]).catch(() => {});
}

/* ==========================================================================
   colorBlend(canvas, colors)：幾個顏色緩慢交融的背景
   之後別的互動也可以用：import { colorBlend } from './loading.js'
   回傳 { draw(秒), destroy() }；不支援 WebGL 時回傳 null
   選項：speed 流動速度、sharp 色塊邊緣（越大越分明）、warp 邊緣扭曲程度、scale 解析度
   ========================================================================== */
export function colorBlend(canvas, colors, { speed = 1, scale = 0.5, sharp = 12, warp = 1.1 } = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const n = colors.length;
  const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const fs = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform float uSharp;
uniform float uWarp;
uniform vec3 uC[${n}];
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.02 + vec2(1.7, 9.2); a *= .5; }
  return v;
}
// 第 i 個色塊目前的中心位置
vec2 center(float fi, float t, float asp){
  return vec2(sin(t * .07 * (1. + fi * .13) + fi * 1.9) * .42 * asp,
              cos(t * .06 * (1. + fi * .11) + fi * 2.7) * .48);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = (uv - .5) * vec2(asp, 1.);
  float t = uTime;
  // 慢慢扭曲空間，色塊的邊緣像液體一樣流動
  vec2 w = vec2(fbm(p * 1.1 + vec2(t * .05, -t * .04)), fbm(p * 1.1 + vec2(-t * .04, t * .05) + 7.3));
  p += (w - .5) * uWarp;
  // 每個顏色是一團會漂移的色塊，彼此柔和地混合
  // 先找出最近的色塊，權重都以它為基準，離所有色塊再遠也不會算成 0（不會露出黑色）
  float m = -1e4;
  for (int i = 0; i < ${n}; i++) { vec2 d = p - center(float(i), t, asp); m = max(m, -dot(d, d) * uSharp); }
  vec3 col = vec3(0.);
  float sum = 0.;
  for (int i = 0; i < ${n}; i++) {
    vec2 d = p - center(float(i), t, asp);
    float k = exp(-dot(d, d) * uSharp - m);
    col += uC[i] * k;
    sum += k;
  }
  col /= sum;
  col += (hash(gl_FragCoord.xy + fract(t)) - .5) / 255.;   // 細微顆粒，避免色階斷層
  gl_FragColor = vec4(col, 1.);
}`;
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (err) {
    console.warn('背景 shader 失敗，改用靜態漸層', err);
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, 'uRes');
  const uTime = gl.getUniformLocation(prog, 'uTime');
  const rgb = colors.flatMap(h => { const v = parseInt(h.replace('#', ''), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; });
  gl.uniform3fv(gl.getUniformLocation(prog, 'uC'), new Float32Array(rgb));
  gl.uniform1f(gl.getUniformLocation(prog, 'uSharp'), sharp);
  gl.uniform1f(gl.getUniformLocation(prog, 'uWarp'), warp);
  const offset = Math.random() * 200;   // 每次打開的樣子都不太一樣

  gl.clearColor(0xf8 / 255, 0xef / 255, 0xce / 255, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  return {
    draw(sec) {
      if (gl.isContextLost()) return;
      const w = Math.max(1, Math.round(canvas.clientWidth * scale));
      const h = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, offset + sec * speed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    },
  };
}
