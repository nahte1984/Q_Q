/* ==========================================================================
   stage.js — 《每個人都是一種文體》互動 MV 共用程式
   --------------------------------------------------------------------------
   單獨開發一個互動：打開 scenes/xxx.html，它會呼叫 solo()，
     自動載入同名的 scenes/xxx.js，並從那個互動設定的毫秒數開始播歌。
   組裝整支 MV：index.html 呼叫 mv([...時間軸...])，
     開場的載入畫面用 scenes/loading.js。
   兩種模式用的是同一份互動程式，不用改寫。

   互動（scene）的寫法：見 scenes/_template.js
   載入畫面的寫法：見 scenes/loading.js（直接開 scenes/loading.html 可以單獨預覽）

   這裡也負責所有頁面共用的規則：
   ・畫面太扁（橫式）時壓 30% 黑和提示 → 見下方 LANDSCAPE_RATIO
   ・共用字型 → 見下方 FONTS

   原則：
   ・音樂時間是唯一的時鐘（f.t），不要在互動裡自己計時。
   ・重的工作（載素材、建 canvas、編譯 shader）全部在 preload 做完。
   ・相機、陀螺儀、聲音由這裡在「點擊開始」時統一開一次，互動只拿來用。
   ・歌曲用 <audio> 播放，不用 Web Audio：iPhone 用 Web Audio 發出聲音的那一刻會有一聲爆音。
     互動裡如果要加音效，也請用 <audio>，不要用 Web Audio。

   網址參數：
   ?from=29800&to=40628   單獨開發時覆蓋播放範圍（毫秒）
   ?loop=0                單獨開發時不循環
   ?hud=0                 隱藏開發資訊
   ?dev                   組裝模式顯示開發資訊（index.html?dev&from=60000）
   ?sim=5000              預覽載入畫面時，模擬載入要花幾毫秒
   ========================================================================== */

export const SONG_URL = new URL('./theSong.m4a', import.meta.url).href;   // 和 theSong.aac 是同一段聲音，只是換成 m4a 容器（跳轉才精準）
export const GRID = { bpm: 134, downbeat: 1225 };   // 毫秒；和 timecode.html 一致
const MV_TITLE = '每個人都是一種文體';

// 手機轉成橫式（寬 ÷ 高 超過這個值）時：
// ・排版鎖在直式：整個畫面維持直式的尺寸，轉 90° 鋪滿螢幕，canvas 不重新排版、不重設大小
// ・壓上 30% 黑和「Vertical View Only」提示
// 電腦不受影響（視窗多寬都照常排版）。手機的判斷：觸控螢幕，而且螢幕短邊 ≤ 600px
const LANDSCAPE_RATIO = 1;
function isPhone() {
  try {
    const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    return touch && Math.min(screen.width, screen.height) <= 600;
  } catch (e) { return false; }
}

// 共用字型（Google Fonts）。中文字型只下載用到的字，所以文字有改的話，這裡也要補上新的字
const FONT_TEXT = {
  // BIZ UDPMincho：載入畫面的標題、rain 的符號雨
  biz: '每個人都是一種文體' + '!@#$%^&*,;:\'"?】◎§—/…《、·(>{∞〃※',
  // Shippori Antique：歌手名、橫式提示
  shippori: '梅林玫羚請把手機轉成直式' + '請同意相機權限',
  // Chiron Sung HK：rain 落下的句子
  chiron: '每個人都是一種文體你覺得你是哪一種',
};
const FONTS = [
  'https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@400&display=swap',
  'https://fonts.googleapis.com/css2?family=BIZ+UDPMincho&display=swap&text=' + encodeURIComponent(FONT_TEXT.biz),
  'https://fonts.googleapis.com/css2?family=Shippori+Antique&display=swap&text=' + encodeURIComponent(FONT_TEXT.shippori),
  'https://fonts.googleapis.com/css2?family=Chiron+Sung+HK:wght@400&display=swap&text=' + encodeURIComponent(FONT_TEXT.chiron),
  // JetBrains Mono 粗體：divide 的 ASCII（grainrad 用的字型；英文字型，檔案很小，整套載入）
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@700&display=swap',
];
// 等 Google Fonts 的 CSS 載好，再等指定的字型和字下載完成（canvas 寫字前要先等，不然會用到預設字型）
async function fontReady(css, text) {
  if (!document.fonts || !document.fonts.load) return;
  const links = [...document.querySelectorAll('link[href*="fonts.googleapis.com/css2"]')];
  await Promise.all(links.map(l => l.sheet ? 0 : new Promise(r => { l.addEventListener('load', r, { once: true }); l.addEventListener('error', r, { once: true }); })));
  await Promise.race([document.fonts.load(css, text), wait(8000)]).catch(() => {});
}

const params = new URLSearchParams(location.search);
const num = k => { const v = params.get(k); if (v == null || v === '') return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const wait = ms => new Promise(r => setTimeout(r, ms));
const fmt = t => {
  const ms = Math.max(0, Math.round(t * 1000));
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, r = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
};

/* ---------- 所有互動共用的東西（每個互動的 stage 都能讀到） ---------- */
const shared = {
  grid: GRID,
  camera: null,          // 前鏡頭 <video>；needs.camera 的互動在 ready / enter 之後可用，被拒絕時是 null
  cameraStream: null,
  motion: { alpha: 0, beta: 0, gamma: 0, ax: 0, ay: 0, az: 0, available: false },
  level: 0,              // 音量 0–1（大約）
  spectrum: new Uint8Array(1024),   // 頻譜 0–255，低頻在前
  waveform: new Uint8Array(2048),   // 波形 0–255，128 是靜音
  width: innerWidth, height: innerHeight,
  dpr: Math.min(2, window.devicePixelRatio || 1),
  get duration() { return audio.duration; },
};

/* ---------- 音樂時鐘 ----------
   用網頁內建的 <audio> 播放（iPhone 上用 Web Audio 播放，開始時會有一聲爆音）。
   <audio> 回報的時間比較粗，這裡用 performance.now() 把它補成每一幀都平滑前進的時間。 */
const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

const audio = {
  el: null, dur: 0,
  running: false,      // 時間是否在走（真的開始出聲之後才算）
  pos: 0, anchorT: 0, anchorP: 0, lastCT: -1, lastOut: 0, unlocking: false, unlocked: false,
  get playing() { return !!this.el && !this.el.paused && !this.el.ended; },
  get duration() { return this.dur; },
  attach(url) {
    const el = new Audio();
    el.preload = 'auto'; el.playsInline = true; el.setAttribute('playsinline', '');
    const sync = () => {
      if (el.paused || el.seeking) return;
      this.anchorT = this.lastCT = this.lastOut = el.currentTime;
      this.anchorP = performance.now();
      this.running = true;
    };
    el.addEventListener('playing', sync);
    el.addEventListener('seeked', sync);
    el.addEventListener('waiting', () => { if (this.running) this.pos = this.now(); this.running = false; });
    el.addEventListener('pause', () => { this.running = false; });
    el.addEventListener('ended', () => { this.running = false; this.pos = this.duration; });
    el.addEventListener('durationchange', () => { if (isFinite(el.duration) && el.duration > 0) this.dur = el.duration; });
    el.src = url;
    this.el = el;
    return new Promise(res => {
      if (el.readyState >= 1) return res();
      el.addEventListener('loadedmetadata', res, { once: true });
      el.addEventListener('error', res, { once: true });
      setTimeout(res, 4000);
      el.load();
    });
  },
  // 耳朵目前聽到的位置（秒）
  now() {
    if (!this.running) return this.pos;
    const pn = performance.now();
    let est = this.anchorT + (pn - this.anchorP) / 1000;
    const ct = this.el.currentTime;
    if (ct !== this.lastCT) {               // <audio> 回報了新的時間：慢慢校正，差太多就直接對齊
      this.lastCT = ct;
      const drift = ct - est;
      if (Math.abs(drift) > 0.1) { this.anchorT = ct; this.anchorP = pn; est = ct; this.lastOut = ct; }
      else { this.anchorT += drift * 0.1; est += drift * 0.1; }
    }
    if (est < this.lastOut && this.lastOut - est < 0.1) est = this.lastOut;   // 不讓時間倒退
    this.lastOut = est;
    return Math.min(this.duration || est, Math.max(0, est));
  },
  // iPhone：一定要在點擊的當下呼叫一次 play()，之後（例如等完相機權限）才能自由播放
  unlock() {
    if (!this.el || this.unlocked) return;
    this.unlocked = this.unlocking = true;
    const p = this.el.play();
    if (p && p.then) p.then(() => { if (this.unlocking) this.el.pause(); }).catch(() => {});
  },
  play() {
    if (!this.el) return;
    this.unlocking = false;
    if (this.el.ended || this.pos >= this.duration - 0.01) this.seek(0);
    const p = this.el.play();
    if (p && p.catch) p.catch(err => report(null, '播放', err));
  },
  pause() {
    if (!this.el) return;
    this.unlocking = false;
    this.pos = this.now();
    this.running = false;
    this.el.pause();
  },
  seek(t) {
    if (!this.el) return;
    t = Math.min(Math.max(0, t), this.duration || t);
    this.pos = t;
    if (Math.abs(this.el.currentTime - t) < 0.001) return;
    this.running = false;                   // 跳轉完成（seeked）後時間才繼續走
    this.el.currentTime = t;
  },
};

/* ---------- 音量、頻譜、波形：從解碼後的歌曲直接計算（不經過 Web Audio 播放） ---------- */
const analysis = {
  ch0: null, ch1: null, sr: 0, N: 2048,
  async decode(ab) {
    try {
      let oc;
      try { oc = new OAC(2, 1, 24000); } catch (e) { oc = new OAC(2, 1, 44100); }
      const buf = await new Promise((res, rej) => { const p = oc.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
      const N = this.N;
      this.win = new Float32Array(N); this.re = new Float32Array(N); this.im = new Float32Array(N);
      this.sm = new Float32Array(N / 2); this.rev = new Uint16Array(N);
      this.cos = new Float32Array(N / 2); this.sin = new Float32Array(N / 2);
      for (let i = 0; i < N; i++) {
        this.win[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (N - 1));
        let r = 0; for (let b = 1, x = i; b < N; b <<= 1, x >>= 1) r = (r << 1) | (x & 1);
        this.rev[i] = r;
      }
      for (let k = 0; k < N / 2; k++) { this.cos[k] = Math.cos(2 * Math.PI * k / N); this.sin[k] = Math.sin(2 * Math.PI * k / N); }
      this.ch0 = buf.getChannelData(0);
      this.ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : this.ch0;
      this.sr = buf.sampleRate;
      if (!audio.dur) audio.dur = buf.duration;
    } catch (err) {
      console.warn('音量／頻譜分析用的解碼失敗（不影響播放）', err);
    }
  },
  fft() {
    const re = this.re, im = this.im, n = this.N, rev = this.rev, C = this.cos, S = this.sin;
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * C[k] + im[b] * S[k], ti = im[b] * C[k] - re[b] * S[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  },
  update(t) {
    const wf = shared.waveform, sp = shared.spectrum;
    if (!this.ch0 || !audio.running) {     // 沒在播：像靜音一樣慢慢歸零
      shared.level *= 0.85;
      wf.fill(128);
      for (let k = 0; k < sp.length; k++) sp[k] = sp[k] * 0.85;
      if (this.sm) this.sm.fill(0);
      return;
    }
    const N = this.N, end = Math.floor(t * this.sr), start = end - N, a = this.ch0, b = this.ch1, len = a.length;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const j = start + i;
      const v = j >= 0 && j < len ? (a[j] + b[j]) * 0.5 : 0;
      sum += v * v;
      wf[i] = Math.max(0, Math.min(255, Math.round(128 + v * 128)));
      this.re[i] = v * this.win[i]; this.im[i] = 0;
    }
    shared.level += (Math.min(1, Math.sqrt(sum / N) * 2.5) - shared.level) * 0.35;
    this.fft();
    for (let k = 0; k < N / 2; k++) {
      const m = Math.hypot(this.re[k], this.im[k]) / N;
      this.sm[k] = 0.75 * this.sm[k] + 0.25 * m;
      const db = 20 * Math.log10(this.sm[k] + 1e-12);
      sp[k] = Math.max(0, Math.min(255, Math.round(255 * (db + 100) / 70)));
    }
  },
};

/* ---------- 載入進度（依份量加權，歌曲依下載的位元組計算） ---------- */
const progress = {
  items: [],
  add(w = 1) { const it = { w, f: 0 }; this.items.push(it); ui.progress(); return it; },
  set(it, f) { it.f = clamp01(f); ui.progress(); },
  track(p, w = 1) { const it = this.add(w); return Promise.resolve(p).finally(() => this.set(it, 1)); },
  value() { let a = 0, b = 0; for (const it of this.items) { a += it.w * it.f; b += it.w; } return b ? a / b : 0; },
};

// 歌曲：整個下載到記憶體再交給 <audio>，播放和跳轉都不用等網路。
// 下載完就能開始；音量／頻譜用的解碼在背景進行，不擋開始
let songPromise = null;
function loadSong() { return songPromise || (songPromise = loadSongNow()); }
async function loadSongNow() {
  const it = progress.add(8);
  try {
    const r = await fetch(SONG_URL);
    if (!r.ok) throw new Error(`載不到 ${SONG_URL.split('/').pop()}（${r.status}）`);
    const total = +r.headers.get('content-length') || 0;
    let ab, got = 0;
    if (r.body && r.body.getReader) {
      const reader = r.body.getReader(), chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        progress.set(it, 0.9 * (total ? got / total : 1 - Math.exp(-got / 4e6)));
      }
      const u8 = new Uint8Array(got); let o = 0;
      for (const c of chunks) { u8.set(c, o); o += c.length; }
      ab = u8.buffer;
    } else {
      ab = await r.arrayBuffer();
    }
    const blob = new Blob([ab], { type: 'audio/mp4' });   // Blob 會複製一份，原本的 ab 可以拿去解碼
    await audio.attach(URL.createObjectURL(blob));
    if (audio.el.error) throw new Error('這個瀏覽器無法播放這個音檔');
    analysis.decode(ab);
    setMediaSession();
  } finally {
    progress.set(it, 1);
  }
}

// 手機鎖定畫面／控制中心顯示的歌名和封面
function setMediaSession() {
  try {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: '每個人都是一種文體', artist: '梅林玫羚', album: 'Interactive Music Video',
      artwork: [{ src: new URL('./images/cover.webp', import.meta.url).href, sizes: '800x800', type: 'image/webp' }],
    });
  } catch (e) {}
}

/* ---------- 共用樣式 ---------- */
const CSS = `
html,body{margin:0;height:100%;background:#f8efce;overflow:hidden;overscroll-behavior:none}
#qq-root{position:fixed;inset:0;overflow:hidden;background:#f8efce}
body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;touch-action:none}
#qq-stage{position:fixed;inset:0;overflow:hidden;background:#f8efce}
.qq-scene{position:absolute;inset:0;visibility:hidden;pointer-events:none;z-index:1}
.qq-scene.on{visibility:visible;pointer-events:auto}
.qq-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}

.qq-start{position:fixed;inset:0;z-index:50}
.qq-dev{background:#f8efce;color:#748180;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif;transition:opacity .35s}
.qq-dev.gone{opacity:0;pointer-events:none}
.qq-dev.ready{cursor:pointer}
.qq-dev .t{font-size:clamp(20px,5vw,30px);font-weight:600;letter-spacing:.08em}
.qq-dev .s,.qq-dev .m{font:12px ui-monospace,"SF Mono",Menlo,monospace;color:#9aa3a1;min-height:1.2em}
.qq-dev .b{width:min(260px,70vw);height:1px;background:#fff;overflow:hidden}
.qq-dev .b i{display:block;height:100%;width:0;background:#748180;transition:width .2s}
.qq-dev button{font:inherit;font-size:15px;color:#e5e5e5;background:#748180;border:0;border-radius:999px;padding:12px 30px;cursor:pointer}

#qq-orient{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.3);display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px}
#qq-orient.show{display:flex}
#qq-orient .card{position:relative;width:270px;height:70px;border-radius:15px;background:rgba(255,255,255,.9);color:#748180;text-align:center}
#qq-orient .en{position:absolute;left:0;right:0;top:15px;font:22px/17px "Roboto Slab",Georgia,serif}
#qq-orient .zh{position:absolute;left:0;right:0;top:38px;font:15px/17px "Shippori Antique","PingFang TC",sans-serif}
#qq-orient .dev{font:11px ui-monospace,Menlo,monospace;color:rgba(255,255,255,.8)}

#qq-hud{position:fixed;z-index:40;left:max(10px,env(safe-area-inset-left));top:max(10px,env(safe-area-inset-top));font:11px/1.6 ui-monospace,"SF Mono",Menlo,monospace;color:#eee;background:rgba(0,0,0,.62);padding:8px 10px;border-radius:6px;pointer-events:none;font-variant-numeric:tabular-nums;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);min-width:180px}
#qq-hud .ms{font-size:20px;line-height:1.15}
#qq-hud .dim{color:#8b8b92}
#qq-hud .btns{display:flex;gap:4px;margin-top:6px;pointer-events:auto}
#qq-hud button{font:inherit;color:#eee;background:#222;border:1px solid #3a3a40;border-radius:4px;padding:4px 8px;cursor:pointer}
#qq-hud button.on{background:#eee;color:#000;border-color:#eee}
#qq-hud.min{background:transparent;padding:0;min-width:0;-webkit-backdrop-filter:none;backdrop-filter:none}
#qq-hud.min .row,#qq-hud.min .btns button:not([data-a=hud]){display:none}

.qq-note{position:fixed;z-index:45;left:10px;bottom:10px;font:11px/1.5 ui-monospace,Menlo,monospace;color:rgba(0,0,0,.55);pointer-events:none}
#qq-err{position:fixed;z-index:80;left:10px;right:10px;bottom:10px;font:12px/1.6 ui-monospace,"SF Mono",Menlo,monospace;color:#fff;background:rgba(170,25,25,.94);padding:8px 12px;border-radius:6px;display:none;max-height:40vh;overflow:auto;-webkit-user-select:text;user-select:text}
#qq-err.show{display:block}
`;

/* ---------- 畫面尺寸與手機橫式（所有頁面共用） ---------- */
let rootEl = null;
const layout = {
  el: null, portrait: null, locked: null, dismissed: false,
  mount() {
    const o = document.createElement('div'); o.id = 'qq-orient';
    o.innerHTML = '<div class="card"><div class="en">Vertical View Only</div><div class="zh">請把手機轉成直式</div></div>' +
      (devMode ? '<div class="dev">開發模式：點一下暫時關閉提示</div>' : '');
    o.addEventListener('click', () => { if (devMode) { this.dismissed = true; this.apply(); } });
    document.body.appendChild(o);
    this.el = o;
    addEventListener('resize', () => this.apply());
    addEventListener('orientationchange', () => setTimeout(() => this.apply(), 250));
    if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', () => setTimeout(() => this.apply(), 250));
    this.apply();
  },
  angle() {
    const a = screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle
      : typeof window.orientation === 'number' ? window.orientation : 90;
    return ((a % 360) + 360) % 360;
  },
  apply() {
    const phone = isPhone();
    const lock = phone && innerWidth / innerHeight > LANDSCAPE_RATIO;
    if (lock !== this.locked) { this.locked = lock; this.dismissed = false; }
    if (!lock) {
      // 直式（或電腦）：照視窗排版，並記住直式的尺寸
      rootEl.style.cssText = '';
      if (phone) this.portrait = { w: innerWidth, h: innerHeight };
      setSize(innerWidth, innerHeight);
    } else {
      // 手機橫式：維持直式尺寸，轉 90° 鋪滿螢幕（像 App 鎖定直式一樣）
      const p = this.portrait || { w: innerHeight, h: innerWidth };
      const rot = this.angle() === 270 ? 90 : -90;
      const s = Math.max(innerWidth / p.h, innerHeight / p.w);
      rootEl.style.cssText = `inset:auto;left:50%;top:50%;width:${p.w}px;height:${p.h}px;transform:translate(-50%,-50%) rotate(${rot}deg) scale(${s.toFixed(4)})`;
      setSize(p.w, p.h);
    }
    this.el.classList.toggle('show', lock && !this.dismissed);
  },
};
function setSize(w, h) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (w === shared.width && h === shared.height && dpr === shared.dpr) return;
  shared.width = w; shared.height = h; shared.dpr = dpr;
  for (const { c, opt } of canvases) sizeCanvas(c, opt);
  for (const r of allRecs) call(r, 'resize');
}

/* ---------- 開場畫面：預設是開發用的黑畫面，組裝模式換成 scenes/loading.js ---------- */
const devScreen = {
  mount(el, info) {
    el.classList.add('qq-dev');
    el.innerHTML = '<div class="t"></div><div class="s"></div><div class="b"><i></i></div><div class="m">載入中…</div><button hidden>點擊開始</button>';
    el.querySelector('.t').textContent = info.title || '';
    el.querySelector('.s').textContent = info.sub || '';
    this.el = el; this.bar = el.querySelector('.b i'); this.msg = el.querySelector('.m'); this.btn = el.querySelector('button');
  },
  progress(p) { this.bar.style.width = (p * 100).toFixed(1) + '%'; this.msg.textContent = `載入中 ${Math.round(p * 100)}%`; },
  ready(go) {
    this.bar.style.width = '100%'; this.msg.textContent = ''; this.btn.hidden = false;
    this.el.classList.add('ready');
    this.el.addEventListener('click', e => { e.preventDefault(); go(); });
  },
  message(s) { this.msg.textContent = s; },
  starting() { this.btn.hidden = true; },
  cameraDenied() { this.msg.textContent = '請同意相機權限'; this.btn.hidden = false; },
  hide() { this.el.classList.add('gone'); return wait(400); },
};

let stageEl = null, devMode = false, startScreen = devScreen, overlayEl = null;
const ui = {
  base() {
    if (this._base) return;
    this._base = true;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    for (const href of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
      const l = document.createElement('link'); l.rel = 'preconnect'; l.href = href; if (href.includes('gstatic')) l.crossOrigin = ''; document.head.appendChild(l);
    }
    for (const href of FONTS) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
    // 所有畫面都放在 #qq-root 裡：手機橫式時整個 root 轉 90°，裡面的排版不動
    rootEl = document.createElement('div'); rootEl.id = 'qq-root'; document.body.appendChild(rootEl);
    stageEl = document.createElement('div'); stageEl.id = 'qq-stage'; rootEl.appendChild(stageEl);
    this.err = document.createElement('div'); this.err.id = 'qq-err'; document.body.appendChild(this.err);
    layout.mount();
  },
  mount(info) {
    this.base();
    overlayEl = document.createElement('div'); overlayEl.className = 'qq-start';
    rootEl.appendChild(overlayEl);
    try { startScreen.mount(overlayEl, info); }
    catch (err) { report(null, '載入畫面', err); startScreen = devScreen; overlayEl.innerHTML = ''; startScreen.mount(overlayEl, info); }
    this.progress();
  },
  progress() { if (overlayEl && !this.isReady) call0(startScreen, 'progress', progress.value()); },
  ready(go) {
    this.isReady = true;
    call0(startScreen, 'progress', 1);
    // 可以按很多次（例如相機權限被拒之後再按一次）；開始之後才拿掉鍵盤的監聽
    this.key = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    addEventListener('keydown', this.key);
    call0(startScreen, 'ready', go);
  },
  message(s) { call0(startScreen, 'message', s); },
  starting() { call0(startScreen, 'starting'); },
  cameraDenied() {
    if (startScreen.cameraDenied) call0(startScreen, 'cameraDenied');
    else call0(startScreen, 'message', '請同意相機權限');
  },
  started() { if (this.key) removeEventListener('keydown', this.key); },
  async hide() {
    try { await startScreen.hide(); } catch (e) {}
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  },
  error(s) {
    if (!this.err || !devMode) return;
    const line = document.createElement('div'); line.textContent = s;
    this.err.appendChild(line); this.err.classList.add('show');
  },
};
function call0(obj, fn, ...args) {
  if (!obj || !obj[fn]) return;
  try { return obj[fn](...args); } catch (err) { report(null, `載入畫面 ${fn}`, err); }
}
function report(rec, where, err) {
  const name = rec ? (rec.scene.name || rec.url.split('/').pop()) : '';
  const s = `${name ? name + ' · ' : ''}${where}：${(err && err.message) || err}`;
  console.error(s, err);
  ui.error(s);
}
addEventListener('error', e => ui.error(`錯誤：${e.message}`));
addEventListener('unhandledrejection', e => ui.error(`錯誤：${(e.reason && e.reason.message) || e.reason}`));

/* ---------- 每個互動拿到的 stage ---------- */
const canvases = [];
const allRecs = [];
function sizeCanvas(c, opt) {
  const d = (opt.dpr || shared.dpr) * (opt.scale || 1);
  c.width = Math.max(1, Math.round(shared.width * d));
  c.height = Math.max(1, Math.round(shared.height * d));
}
function makeRec(scene, url) {
  const root = document.createElement('div');
  root.className = 'qq-scene';
  root.dataset.scene = scene.name || '';
  stageEl.appendChild(root);
  const st = Object.create(shared);
  const rec = { scene, url, st, active: false, errors: 0 };
  st.root = root;
  st.name = scene.name || '';
  // 素材路徑：相對於互動自己的 .js 檔
  st.asset = p => new URL(p, url).href;
  // 建一個滿版 canvas（會自動跟著視窗調整大小）。opt.scale: 0.5 = 半解析度；opt.dpr: 指定像素密度
  st.canvas = (opt = {}) => {
    const c = document.createElement('canvas');
    c.className = 'qq-canvas';
    root.appendChild(c);
    canvases.push({ c, opt });
    sizeCanvas(c, opt);
    return c;
  };
  st.image = p => progress.track(new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => res(im));
    im.onerror = () => rej(new Error(`載不到圖片 ${p}`));
    im.src = st.asset(p);
  }));
  // 影片整個下載到記憶體，播放時不會等網路。上場前約 1 秒先 v.play()，用 f.local 對時間
  st.video = p => progress.track((async () => {
    const r = await fetch(st.asset(p));
    if (!r.ok) throw new Error(`載不到影片 ${p}`);
    const blob = await r.blob();
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
    v.src = URL.createObjectURL(blob);
    await new Promise(res => { v.onloadeddata = res; v.onloadedmetadata = () => setTimeout(res, 300); setTimeout(res, 5000); v.load(); });
    return v;
  })(), 3);
  st.json = p => progress.track(fetch(st.asset(p)).then(r => { if (!r.ok) throw new Error(`載不到 ${p}`); return r.json(); }));
  // 等字型載好：await stage.font('40px "BIZ UDPMincho"', '要用到的字')（字也要加進 stage.js 的 FONT_TEXT）
  st.font = (css, text) => progress.track(fontReady(css, text));
  // 把任何要等的事情算進載入進度：await stage.track(promise)
  st.track = (p, w = 1) => progress.track(p, w);
  st.file = p => progress.track(fetch(st.asset(p)).then(r => { if (!r.ok) throw new Error(`載不到 ${p}`); return r.arrayBuffer(); }));
  allRecs.push(rec);
  return rec;
}
function call(rec, hook, ...args) {
  const fn = rec.scene[hook];
  if (!fn) return;
  try { return fn.apply(rec.scene, [rec.st, ...args]); }
  catch (err) { if (rec.errors++ < 3) report(rec, hook, err); }
}

/* ---------- 相機、陀螺儀 ---------- */
// 成功回傳 true；被拒絕或沒有相機回傳 false
async function openCamera() {
  let v = null;
  try {
    v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.autoplay = true;
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(v);
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    v.srcObject = stream;
    await v.play().catch(() => {});
    if (!v.videoWidth) await new Promise(r => { v.onloadeddata = r; setTimeout(r, 3000); });
    shared.camera = v; shared.cameraStream = stream;
    return true;
  } catch (err) {
    console.warn('相機沒有開啟：', err);
    if (v) v.remove();
    return false;
  }
}
function listenMotion() {
  const m = shared.motion;
  addEventListener('deviceorientation', e => {
    if (e.beta == null) return;
    m.alpha = e.alpha || 0; m.beta = e.beta || 0; m.gamma = e.gamma || 0; m.available = true;
  });
  addEventListener('devicemotion', e => {
    const a = e.accelerationIncludingGravity;
    if (a) { m.ax = a.x || 0; m.ay = a.y || 0; m.az = a.z || 0; }
  });
}
let motionAsked = false;
function requestMotion() {
  // iOS 需要在點擊當下要權限；兩個請求同時發出。只要一次
  if (motionAsked) return Promise.resolve();
  motionAsked = true;
  const jobs = [];
  try { if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) jobs.push(DeviceOrientationEvent.requestPermission()); } catch (e) {}
  try { if (window.DeviceMotionEvent && DeviceMotionEvent.requestPermission) jobs.push(DeviceMotionEvent.requestPermission()); } catch (e) {}
  return Promise.allSettled(jobs).then(listenMotion);
}

/* ---------- 導演：依音樂時間決定誰上場 ---------- */
const director = {
  entries: [], cur: -1, fading: [], solo: false, loop: false, home: 0,
  indexAt(t) {
    let i = this.solo ? 0 : -1;
    for (let k = 0; k < this.entries.length; k++) if (t >= this.entries[k].at - 1e-4) i = k;
    return i;
  },
  frameFor(e, t, base) {
    const end = e.end != null ? e.end : audio.duration;
    return Object.assign({}, base, { local: t - e.at, progress: end > e.at ? clamp01((t - e.at) / (end - e.at)) : 0, entry: e.name });
  },
  doEnter(e, t, base) {
    const r = e.rec, root = r.st.root;
    root.classList.add('on'); root.style.opacity = ''; root.style.zIndex = '1';
    if (!r.active) { r.active = true; call(r, 'enter', this.frameFor(e, t, base)); }
  },
  doExit(e) {
    const r = e.rec, root = r.st.root;
    root.classList.remove('on'); root.style.opacity = ''; root.style.zIndex = ''; root.style.pointerEvents = '';
    if (r.active) { r.active = false; call(r, 'exit'); }
  },
  exitAll() {
    for (const fd of this.fading) this.doExit(fd.e);
    this.fading = [];
    if (this.entries[this.cur]) this.doExit(this.entries[this.cur]);
    this.cur = -1;
  },
  restart() { this.exitAll(); audio.seek(this.home); if (!audio.playing) audio.play(); },
  tick(t) {
    // 單獨開發：到了 to 就回到 from 重新進場
    if (this.solo && this.loop) {
      const e = this.entries[0];
      if (e && e.end != null && t >= e.end) { this.exitAll(); audio.seek(e.at); }
    }
  },
  update(t, dt, base) {
    const i = this.indexAt(t);
    if (i !== this.cur) {
      const prev = this.entries[this.cur], next = this.entries[i];
      const sequential = prev && next && i === this.cur + 1 && t - next.at < 1;   // 1 秒內算是正常播到這裡（中間卡一下也照樣轉場）
      if (!sequential) { this.exitAll(); if (next) this.doEnter(next, t, base); }
      else if (prev.rec !== next.rec) {
        if (next.dur > 0 && next.transition !== 'cut') {
          this.doEnter(next, t, base);
          this.fading.push({ e: prev, start: next.at, dur: next.dur, type: next.transition });
          prev.rec.st.root.style.zIndex = next.transition === 'over' ? '0' : '2';   // over：下一段疊在上面
          prev.rec.st.root.style.pointerEvents = 'none';   // 轉場中的上一段不擋住下一段的互動
        } else {
          this.doExit(prev);
          this.doEnter(next, t, base);
        }
      }
      this.cur = i;
    }
    // 轉場中的上一段：照音樂時間計算，暫停或跳轉都不會亂
    this.fading = this.fading.filter(fd => {
      const u = t - fd.start;
      if (u < 0 || u >= fd.dur) { this.doExit(fd.e); return false; }
      if (fd.type !== 'over') fd.e.rec.st.root.style.opacity = String(1 - u / fd.dur);   // over：上一段保持原樣，由下一段自己蓋過去
      return true;
    });
    for (const fd of this.fading) call(fd.e.rec, 'update', this.frameFor(fd.e, t, base));
    const e = this.entries[this.cur];
    if (e) call(e.rec, 'update', this.frameFor(e, t, base));
  },
};

/* ---------- 開發資訊 HUD ---------- */
const hud = {
  enabled: false, visible: true, el: null, f: {},
  mount() {
    if (!this.enabled) return;
    const h = document.createElement('div'); h.id = 'qq-hud';
    h.innerHTML =
      '<div class="row ms"><span data-k="ms">0</span> <span class="dim">ms</span></div>' +
      '<div class="row"><span data-k="clock"></span> <span class="dim">·</span> <span data-k="bb"></span></div>' +
      '<div class="row" data-k="scene"></div>' +
      '<div class="row dim" data-k="range"></div>' +
      '<div class="row dim"><span data-k="fps"></span> fps · update <span data-k="up"></span> ms</div>' +
      '<div class="btns"><button data-a="play">▶</button><button data-a="restart" title="從頭 (R)">⟲</button>' +
      (director.solo ? '<button data-a="loop" title="循環 (L)">loop</button>' : '') +
      '<button data-a="hud" title="隱藏 (H)">–</button></div>';
    document.body.appendChild(h);
    this.el = h;
    h.querySelectorAll('[data-k]').forEach(n => { this.f[n.dataset.k] = n; });
    h.querySelector('.btns').addEventListener('click', e => {
      const a = e.target.dataset.a;
      if (a === 'play') togglePlay(); else if (a === 'restart') director.restart();
      else if (a === 'loop') toggleLoop(); else if (a === 'hud') this.toggle();
      e.target.blur();
    });
    this.syncButtons();
  },
  toggle() { this.visible = !this.visible; this.el.classList.toggle('min', !this.visible); this.el.querySelector('[data-a=hud]').textContent = this.visible ? '–' : 'HUD'; },
  syncButtons() {
    if (!this.el) return;
    this.el.querySelector('[data-a=play]').textContent = audio.playing ? '❚❚' : '▶';
    const l = this.el.querySelector('[data-a=loop]'); if (l) l.classList.toggle('on', director.loop);
    const e = director.entries[0];
    if (director.solo && e) this.f.range.textContent = `範圍 ${Math.round(e.at * 1000)}–${e.end != null ? Math.round(e.end * 1000) : '結尾'} ms${director.loop ? ' · 循環' : ''}`;
    else this.f.range.textContent = '';
  },
  update(t, b, fps, up) {
    if (!this.el || !this.visible) return;
    this.f.ms.textContent = Math.round(t * 1000);
    this.f.clock.textContent = fmt(t);
    this.f.bb.textContent = b.bar >= 0 ? `小節 ${b.bar}.${b.beat}` : '第一拍前';
    const cur = director.entries[director.cur];
    const fadeNames = director.fading.map(fd => fd.e.name);
    this.f.scene.textContent = (cur ? cur.name : '—') + (fadeNames.length ? `  ← 轉場中 ${fadeNames.join(', ')}` : '');
    this.f.fps.textContent = Math.round(fps);
    this.f.up.textContent = up.toFixed(1);
    const playTxt = audio.playing ? '❚❚' : '▶';
    const pb = this.el.querySelector('[data-a=play]'); if (pb.textContent !== playTxt) pb.textContent = playTxt;
  },
};
function togglePlay() { audio.playing ? audio.pause() : audio.play(); hud.syncButtons(); }
function toggleLoop() { director.loop = !director.loop; hud.syncButtons(); }
addEventListener('keydown', e => {
  if (!hud.enabled || !started) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey) return;
  const P = 4 * 60 / GRID.bpm, d0 = GRID.downbeat / 1000, t = audio.now();
  switch (e.key) {
    case ' ': togglePlay(); break;
    case 'r': case 'R': director.restart(); break;
    case 'l': case 'L': if (director.solo) toggleLoop(); break;
    case 'h': case 'H': hud.toggle(); break;
    case 'ArrowLeft': audio.seek(t - 1); break;
    case 'ArrowRight': audio.seek(t + 1); break;
    case '[': audio.seek(Math.max(0, d0 + (Math.ceil((t - (audio.playing ? 0.25 : 0.001) - d0) / P) - 1) * P)); break;
    case ']': audio.seek(d0 + (Math.floor((t + 0.001 - d0) / P) + 1) * P); break;
    default: return;
  }
  e.preventDefault();
});

/* ---------- 每一幀 ---------- */
let started = false, needCamera = false, needMotion = false;
let lastNow = performance.now(), lastBi = null, fps = 60, upMs = 0;
function beatInfo(t, dt) {
  const P = 60 / GRID.bpm, d0 = GRID.downbeat / 1000;
  const beatPos = (t - d0) / P;
  const bi = Math.floor(beatPos + 1e-6);
  const onBeat = audio.playing && lastBi != null && bi > lastBi && bi - lastBi <= 2 && bi >= 0;
  lastBi = bi;
  return {
    t, ms: Math.round(t * 1000), dt, playing: audio.playing,
    beatPos, beatPhase: beatPos - Math.floor(beatPos),
    bar: bi >= 0 ? Math.floor(bi / 4) : -1, beat: bi >= 0 ? (bi % 4) + 1 : 0,
    onBeat, onBar: onBeat && bi % 4 === 0,
    level: shared.level,
  };
}
function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  if (started) {
    director.tick(audio.now());
    const t = audio.now();
    analysis.update(t);
    const base = beatInfo(t, dt);
    const u0 = performance.now();
    director.update(t, dt, base);
    upMs += (performance.now() - u0 - upMs) * 0.1;
    hud.update(t, base, fps, upMs);
  }
  requestAnimationFrame(frame);
}

/* ---------- 預載 → 點擊開始 ---------- */
async function prepare(recs) {
  const songP = loadSong();
  await Promise.all(recs.map(r => progress.track(
    Promise.resolve().then(() => call(r, 'preload')).catch(err => report(r, 'preload', err))
  )));
  try { await songP; }
  catch (err) { devMode = true; report(null, '載入歌曲', err); ui.message('歌曲載入失敗'); return; }
  needCamera = recs.some(r => r.scene.needs && r.scene.needs.camera);
  needMotion = recs.some(r => r.scene.needs && r.scene.needs.motion);
  ui.ready(start);
}
let launching = false;
async function start() {
  if (started || launching) return;
  launching = true;
  // 以下幾件事都要在點擊的當下（還沒 await 之前）發出，iPhone 才會允許
  audio.unlock();
  const jobs = [];
  if (needMotion) jobs.push(requestMotion());
  if (needCamera && !shared.camera) { ui.message('開啟相機…'); jobs.push(openCamera()); }
  ui.starting();
  await Promise.all(jobs);
  // 需要相機卻沒拿到權限：不播放，提示觀眾，按 PLAY 時再要一次
  if (needCamera && !shared.camera) {
    launching = false;
    ui.cameraDenied();
    return;
  }
  ui.started();
  for (const r of allRecs) { try { await call(r, 'ready'); } catch (err) { report(r, 'ready', err); } }
  director.exitAll();
  audio.seek(director.home);
  audio.play();
  started = true;
  hud.syncButtons();
  ui.hide();
}

async function importModule(url) {
  try {
    const mod = await import(url);
    if (!mod.default) throw new Error('沒有 export default');
    return mod.default;
  } catch (err) {
    report(null, `載入 ${url.split('/').slice(-2).join('/')}`, err);
    return null;
  }
}
const placeholder = url => ({ name: url.split('/').pop().replace(/\.js$/, '') + '（載入失敗）' });

/* ==========================================================================
   solo()：單獨開發一個互動
   scenes/xxx.html 呼叫它，會載入 scenes/xxx.js
   如果那個檔是載入畫面（type: 'loading'），就改成預覽載入畫面
   ========================================================================== */
export async function solo(opts = {}) {
  devMode = true;
  const url = opts.url || location.href.split(/[?#]/)[0].replace(/\.html?$/i, '.js');
  ui.base();
  const scene = (await importModule(url)) || placeholder(url);
  if (scene.type === 'loading') return previewLoading(scene, url);
  loadSong();   // 先開始下載歌曲
  const dv = scene.dev || {};
  const from = num('from') ?? dv.from ?? 0;
  const to = num('to') ?? dv.to ?? null;
  document.title = scene.name || document.title;
  ui.mount({ title: scene.name || '互動', sub: `單獨開發 · ${from}–${to ?? '結尾'} ms` });
  director.solo = true;
  director.loop = to != null && params.get('loop') !== '0';
  director.home = from / 1000;
  const rec = makeRec(scene, url);
  director.entries = [{ at: from / 1000, end: to != null ? to / 1000 : null, rec, fade: 0, name: scene.name || '互動' }];
  hud.enabled = params.get('hud') !== '0';
  hud.mount();
  requestAnimationFrame(frame);
  await prepare([rec]);
}

/* 預覽載入畫面：模擬載入 → PLAY → 淡出 → 重來 */
function previewLoading(mod, url) {
  document.title = mod.name || '載入畫面';
  const sim = num('sim') ?? 5000;
  const note = document.createElement('div'); note.className = 'qq-note';
  note.textContent = `載入畫面預覽 · 模擬載入 ${sim} ms（網址加 ?sim=毫秒 可調）· 按 PLAY 會淡出再重來`;
  document.body.appendChild(note);
  const run = () => {
    const el = document.createElement('div'); el.className = 'qq-start';
    rootEl.appendChild(el);
    mod.mount(el, { title: MV_TITLE, asset: p => new URL(p, url).href });
    const t0 = performance.now();
    let p = 0;
    const step = () => {
      const k = (performance.now() - t0) / sim;
      p = Math.min(1, Math.max(p, k + 0.05 * Math.sin(k * 11)));   // 模擬時快時慢
      mod.progress(p);
      if (k < 1) { requestAnimationFrame(step); return; }
      mod.progress(1);
      mod.ready(async () => {
        if (mod.starting) mod.starting();
        await mod.hide();
        el.remove();
        setTimeout(run, 1000);
      });
    };
    step();
  };
  run();
}

/* ==========================================================================
   mv(timeline)：組裝整支 MV
   timeline: [{ at: 毫秒, scene: 'scenes/ 裡的檔名（不含 .js）', transition: 'fade' | 'over', dur: 轉場毫秒 }, ...]
   ・fade：上一段淡出（舊寫法 fade: 900 也可以）
   ・over：下一段疊在上一段上面，自己做進場（例如 divide 的格子一格一格淡入）；上一段保持原樣，dur 毫秒之後才消失
   ・不寫就是直接切換
   opts.loading: 載入畫面的檔名（預設 'loading'，也就是 scenes/loading.js）
   ========================================================================== */
export async function mv(timeline, opts = {}) {
  devMode = params.has('dev');
  ui.base();
  loadSong();   // 一打開就開始下載歌曲，和其他載入同時進行
  const ls = await importModule(new URL(`scenes/${opts.loading || 'loading'}.js`, location.href).href);
  if (ls && ls.mount) startScreen = ls;
  const loadingUrl = new URL(`scenes/${opts.loading || 'loading'}.js`, location.href).href;
  ui.mount({ title: opts.title || MV_TITLE, sub: opts.sub || '', asset: p => new URL(p, loadingUrl).href });
  const sorted = timeline.slice().sort((a, b) => a.at - b.at);
  const names = [...new Set(sorted.map(e => e.scene))];
  const recs = {};
  await Promise.all(names.map(async n => {
    const url = new URL(`scenes/${n}.js`, location.href).href;
    const scene = (await progress.track(importModule(url))) || placeholder(url);
    recs[n] = makeRec(scene, url);
  }));
  director.entries = sorted.map((e, i) => ({
    at: e.at / 1000,
    end: i + 1 < sorted.length ? sorted[i + 1].at / 1000 : null,
    rec: recs[e.scene], name: e.scene,
    // 轉場：fade（上一段淡出，舊寫法 fade: 毫秒也可以）、over（下一段疊在上面自己做進場）、cut（直接切）
    transition: e.transition || (e.fade ? 'fade' : 'cut'),
    dur: (e.dur ?? e.fade ?? 0) / 1000,
  }));
  director.home = (num('from') ?? 0) / 1000;
  hud.enabled = devMode;
  hud.mount();
  requestAnimationFrame(frame);
  await prepare(Object.values(recs));
}

// 除錯用：在瀏覽器 console 打 qq 可以看到目前狀態
window.qq = { audio, shared, director, GRID, progress, layout };
