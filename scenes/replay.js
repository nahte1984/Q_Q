/* ==========================================================================
   replay — 結尾
   --------------------------------------------------------------------------
   82822 ms   歌曲開始淡出：5 秒內音量漸小到無聲（87822 ms），然後停住，不再往下播。
              淡出是直接做在音檔 theSong-beta.m4a 裡的（iPhone 不能用程式調音量）；這裡只負責在 87822 ms 停住。
              要改淡出的時間或長短，音檔要重新做（從 _bin/theSong.wav）。
   84822 ms   （淡出的第 2 秒）結尾畫面的背景花 3 秒淡入，蓋在上一個互動上面（Figma rePlay）；
              背景和載入畫面一樣：五個顏色緩慢交融（loading.js 的 colorBlend，同一次打開時樣子也一樣）
   87822 ms   歌曲完全播完：中間的「end of BETA version」和 re-PLAY 按鈕再花 1 秒淡入
   按 re-PLAY：從頭開始播。

   index.html 用 transition: 'over' 接在 block 後面：block 照常跑，這一段自己淡入蓋過去。
   ========================================================================== */

import { colorBlend, COLORS } from './loading.js';

/* ---------- 可以調整的數字 ---------- */
const FADE_FROM = 82822;                 // 歌曲從這裡開始淡出（毫秒；和音檔裡的淡出一致）
const STOP_AT = FADE_FROM + 5000;        // 淡出到無聲、歌曲停住的時間（毫秒）
const BG_AT = FADE_FROM + 2000;          // 背景從這裡開始淡入（淡出的第 2 秒）
const BG_FADE = 3000;                    // 背景淡入要多久（毫秒）
const TEXT_FADE = 1000;                  // 歌曲播完（停住）之後，字和按鈕淡入要多久（毫秒）
const NOTE = 'end of BETA version';
const BUTTON = 're-PLAY';

// 版面依 Figma（rePlay，388 × 743 的畫面），依螢幕大小等比縮放（和載入畫面一樣）
const CSS = `
.rp{position:absolute;inset:0;overflow:hidden;opacity:0;pointer-events:none}
.rp.live{pointer-events:auto}
.rp-bg{position:absolute;inset:0;width:100%;height:100%;display:block}
.rp.nogl{background:linear-gradient(160deg,#f8efce 0%,#ffc2b4 30%,#d2d6d3 55%,#ccebc8 78%,#ff8f8f 100%)}
.rp.nogl .rp-bg{display:none}
.rp-card{position:absolute;left:50%;top:50%;width:388px;height:743px;transform:translate(-50%,-50%) scale(var(--s,1));opacity:0}
.rp-note{position:absolute;left:0;top:325px;width:388px;text-align:center;font:20px/21.048px "Roboto Slab",Georgia,serif;color:#748180;white-space:nowrap}
.rp-btn{position:absolute;left:112px;top:371px;width:165px;height:47px;padding:0;border:0;border-radius:50px;background:#748180;color:#e5e5e5;font:28px/1 "Roboto Slab",Georgia,serif;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .3s ease;-webkit-tap-highlight-color:transparent;outline:none}
@media (hover:hover){.rp-btn:hover{background:#68736f}}
.rp-btn:active{background:#5f6a67}
`;

const clamp01 = x => Math.max(0, Math.min(1, x));

export default {
  name: 'replay',
  dev: { from: FADE_FROM },              // 單獨打開 replay.html：從淡出開始，停住之後按 re-PLAY 會回到這裡

  async preload(stage) {
    if (!document.getElementById('rp-css')) {
      const s = document.createElement('style'); s.id = 'rp-css'; s.textContent = CSS; document.head.appendChild(s);
    }
    const el = document.createElement('div');
    el.className = 'rp';
    el.innerHTML =
      '<canvas class="rp-bg"></canvas>' +
      '<div class="rp-card">' +
        `<div class="rp-note">${NOTE}</div>` +
        `<button class="rp-btn" type="button">${BUTTON}</button>` +
      '</div>';
    stage.root.appendChild(el);
    this.el = el;
    this.card = el.querySelector('.rp-card');
    this.bg = colorBlend(el.querySelector('.rp-bg'), COLORS);
    if (!this.bg) el.classList.add('nogl');
    el.querySelector('.rp-btn').addEventListener('click', () => { if (this.live) stage.restart(); });
    await stage.font('28px "Roboto Slab"', NOTE + BUTTON);
    this.a = this.b = -1;
    this.endAt = null;
  },

  enter() { this.endAt = null; this.show(0, 0); },

  exit() { this.endAt = null; this.show(0, 0); },

  // a：整個畫面（背景）的不透明度；b：字和按鈕的不透明度
  show(a, b) {
    if (a !== this.a) { this.a = a; this.el.style.opacity = a.toFixed(3); }
    if (b !== this.b) {
      this.b = b;
      this.card.style.opacity = b.toFixed(3);
      this.live = b > 0.5;               // 字和按鈕淡入一半之後才按得到
      this.el.classList.toggle('live', this.live);
    }
  },

  update(stage, f) {
    const ms = f.t * 1000;
    // 淡出完（音檔裡已經無聲）就停住，記下這一刻：字和按鈕從這時開始淡入
    // （歌停了之後音樂時間也停住，所以這 1 秒照實際經過的時間算）
    if (ms >= STOP_AT) {
      stage.stopMusic();
      if (this.endAt == null) this.endAt = performance.now();
    } else this.endAt = null;
    const bg = clamp01((ms - BG_AT) / BG_FADE);
    const text = this.endAt == null ? 0 : clamp01((performance.now() - this.endAt) / TEXT_FADE);
    this.show(bg, text);
    if (this.a <= 0) return;
    const s = Math.max(0.82, Math.min(1.45, Math.min(stage.width / 388, stage.height / 743)));
    if (s !== this.s) { this.s = s; this.card.style.setProperty('--s', s.toFixed(4)); }
    if (this.bg) this.bg.draw(performance.now() / 1000);   // 背景一直流動（歌停了也是）
  },
};
