/* ==========================================================================
   replay — 結尾
   --------------------------------------------------------------------------
   82822 ms   歌曲開始淡出：5 秒內音量漸小到無聲（87822 ms），然後停住，不再往下播。
   84822 ms   （淡出的第 2 秒）結尾畫面花 1 秒淡入，蓋在上一個互動上面（Figma rePlay）：
              ・背景和載入畫面一樣：五個顏色緩慢交融（loading.js 的 colorBlend，同一次打開時樣子也一樣）
              ・中間是「end of BETA version」和 re-PLAY 按鈕
   按 re-PLAY：從頭開始播（音量回到原本的大小）。

   index.html 用 transition: 'over' 接在 block 後面：block 照常跑，這一段自己淡入蓋過去。
   ========================================================================== */

import { colorBlend, COLORS } from './loading.js';

/* ---------- 可以調整的數字 ---------- */
const FADE_FROM = 82822;                 // 歌曲從這裡開始淡出（毫秒）
const FADE_DUR = 5000;                   // 淡出到無聲要多久（毫秒）；結束後歌曲停住
const FADE_CURVE = 2;                    // 音量曲線：1 = 直線；2 = 前面降得快、後面慢慢收（聽起來比較平均）
const UI_AT = FADE_FROM + 2000;          // 結尾畫面從這裡開始淡入（淡出的第 2 秒）
const UI_FADE = 1000;                    // 結尾畫面淡入要多久（毫秒）
const NOTE = 'end of BETA version';
const BUTTON = 're-PLAY';

// 版面依 Figma（rePlay，388 × 743 的畫面），依螢幕大小等比縮放（和載入畫面一樣）
const CSS = `
.rp{position:absolute;inset:0;overflow:hidden;opacity:0;pointer-events:none}
.rp.live{pointer-events:auto}
.rp-bg{position:absolute;inset:0;width:100%;height:100%;display:block}
.rp.nogl{background:linear-gradient(160deg,#f8efce 0%,#ffc2b4 30%,#d2d6d3 55%,#ccebc8 78%,#ff8f8f 100%)}
.rp.nogl .rp-bg{display:none}
.rp-card{position:absolute;left:50%;top:50%;width:388px;height:743px;transform:translate(-50%,-50%) scale(var(--s,1))}
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
    this.a = -1;
  },

  enter() { this.show(0); },

  // 離開（按 re-PLAY、或開發時往回拖）：音量回到原本的大小
  exit(stage) { stage.volume(1); this.show(0); },

  show(a) {
    if (a === this.a) return;
    this.a = a;
    this.el.style.opacity = a.toFixed(3);
    this.live = a > 0.5;                 // 淡入一半之後才按得到
    this.el.classList.toggle('live', this.live);
  },

  update(stage, f) {
    const ms = f.t * 1000;
    // 歌曲淡出，結束後停住
    const u = clamp01((ms - FADE_FROM) / FADE_DUR);
    stage.volume(Math.pow(1 - u, FADE_CURVE));
    if (ms >= FADE_FROM + FADE_DUR) stage.stopMusic();
    // 結尾畫面淡入（照音樂時間；歌停了之後時間也停住，畫面就留著）
    this.show(clamp01((ms - UI_AT) / UI_FADE));
    if (this.a <= 0) return;
    const s = Math.max(0.82, Math.min(1.45, Math.min(stage.width / 388, stage.height / 743)));
    if (s !== this.s) { this.s = s; this.card.style.setProperty('--s', s.toFixed(4)); }
    if (this.bg) this.bg.draw(performance.now() / 1000);   // 背景一直流動（歌停了也是）
  },
};
