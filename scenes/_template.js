/* ==========================================================================
   互動範本
   --------------------------------------------------------------------------
   做一個新的互動：把 _template.html 和 _template.js 一起複製、改成同一個名字
   （例如 rain.html + rain.js），然後只改 .js 這個檔。.html 不用動。

   用本機伺服器打開 scenes/rain.html 就能單獨開發：
   會從 dev.from 開始播歌，播到 dev.to 自動回到 dev.from 重來。

   之後組裝時，index.html 的時間軸寫 { at: 29882, scene: 'rain' } 就會用到這個檔。

   每個階段做什麼：
     preload(stage)      點擊開始之前。載素材、建 canvas、編譯 shader、先畫一幀暖機。
     ready(stage)        點擊開始之後、音樂開始之前。相機和陀螺儀到這裡才能用。（可省略）
     enter(stage, f)     輪到這個互動上場的那一刻。只做輕的事：重設狀態。
     update(stage, f)    每一幀。f 裡有音樂時間和拍點，見下面。
     exit(stage)         下場。停掉所有東西（影片 pause、清掉計時）。
     resize(stage)       視窗大小改變。canvas 已經自動調整好尺寸，WebGL 記得更新 viewport。（可省略）

   f（每一幀的資訊）：
     f.t          歌曲時間（秒）——所有跟音樂有關的動作都用這個
     f.ms         歌曲時間（毫秒，整數）
     f.local      這個互動上場後經過幾秒
     f.progress   這一段走了多少（0–1）
     f.dt         距離上一幀幾秒（物理模擬用這個；暫停時歌曲時間不動，但 dt 照走）
     f.playing    音樂是否在播
     f.bar        第幾小節（從 0 起算，和 timecode.html 一致）
     f.beat       第幾拍（1–4）
     f.beatPhase  拍子內的位置 0→1（剛打下去是 0）
     f.beatPos    從第一個重拍算起的連續拍數（小數）
     f.onBeat     這一幀剛好打到新的一拍
     f.onBar      這一幀剛好打到新的小節
     f.level      音量 0–1

   stage（共用資源）：
     stage.root        這個互動自己的 <div>，要聽點擊、觸控就加在這上面
     stage.canvas()    建一個滿版 canvas（自動跟視窗調整）。stage.canvas({ scale: 0.5 }) = 半解析度
     stage.width / height / dpr   畫面尺寸（CSS 像素）和像素密度
                       ※ 請用這個，不要用 window.innerWidth：手機轉橫式時畫面會鎖在直式尺寸
     stage.camera      前鏡頭 <video>（needs.camera: true 時；被拒絕時是 null）
     stage.motion      { beta, gamma, alpha, ax, ay, az, available }（needs.motion: true 時）
     stage.spectrum    頻譜（Uint8Array 1024，0–255，低頻在前）
     stage.waveform    波形（Uint8Array 2048，128 是靜音）
     await stage.image('img/a.png')   載圖片（路徑相對於這個 .js）
     await stage.video('vid/a.mp4')   載影片（整個下載到記憶體）
     await stage.json('data.json')    載 JSON
   ========================================================================== */

export default {
  name: '範本',

  // 需要的權限：會在「點擊開始」時統一要一次
  needs: { camera: false, motion: false },

  // 單獨開發時播放的範圍（毫秒）。網址也可以覆蓋：_template.html?from=40628&to=62121
  dev: { from: 29882, to: 40628 },

  async preload(stage) {
    // 1. 載素材（範例）
    // this.img = await stage.image('img/paper.png');

    // 2. 建 canvas
    this.canvas = stage.canvas();
    this.g = this.canvas.getContext('2d');

    // 3. 互動：聽 stage.root 上的事件
    this.pointer = null;
    stage.root.addEventListener('pointermove', e => { this.pointer = { x: e.clientX, y: e.clientY }; });
    stage.root.addEventListener('pointerdown', e => { this.pointer = { x: e.clientX, y: e.clientY }; this.flash = 1; });
    stage.root.addEventListener('pointerleave', () => { this.pointer = null; });

    // 4. 暖機：先畫一幀，第一次上場就不會卡
    this.flash = 0;
    this.draw(stage, { local: 0, beatPhase: 0, level: 0, bar: -1, beat: 0, progress: 0 });
  },

  enter(stage, f) {
    this.flash = 0;
  },

  update(stage, f) {
    if (f.onBar) this.flash = 1;
    this.flash *= Math.pow(0.03, f.dt);   // 用 dt 衰減，幀率不同也一樣快
    this.draw(stage, f);
  },

  exit(stage) {},

  /* ---------- 以下是範本的畫面，換成你的互動 ---------- */
  draw(stage, f) {
    const g = this.g, w = this.canvas.width, h = this.canvas.height, d = stage.dpr;
    g.fillStyle = '#f8efce';
    g.fillRect(0, 0, w, h);

    // 相機（needs.camera 改成 true 就會出現；前鏡頭左右鏡像）
    const cam = stage.camera;
    if (cam && cam.videoWidth) {
      const s = Math.max(w / cam.videoWidth, h / cam.videoHeight);
      const cw = cam.videoWidth * s, ch = cam.videoHeight * s;
      g.save();
      g.globalAlpha = 0.5;
      g.translate(w, 0); g.scale(-1, 1);
      g.drawImage(cam, (w - cw) / 2, (h - ch) / 2, cw, ch);
      g.restore();
    }

    // 跟著拍子跳的圓：每拍放大，小節第一拍閃一下
    const base = Math.min(w, h) * 0.14;
    const pulse = 1 + 0.22 * Math.pow(1 - f.beatPhase, 3);
    g.beginPath();
    g.arc(w / 2, h / 2, base * pulse, 0, Math.PI * 2);
    g.fillStyle = `rgba(255,143,143,${0.45 + 0.55 * this.flash})`;
    g.fill();

    // 這一段的進度
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.fillRect(0, h - 3 * d, w, 3 * d);
    g.fillStyle = '#748180';
    g.fillRect(0, h - 3 * d, w * f.progress, 3 * d);

    // 音量
    g.fillRect(w / 2 - 60 * d, h / 2 + base * 1.5, 120 * d * f.level, 2 * d);

    // 手指／滑鼠
    if (this.pointer) {
      g.beginPath();
      g.arc(this.pointer.x * d, this.pointer.y * d, 18 * d, 0, Math.PI * 2);
      g.strokeStyle = '#748180'; g.lineWidth = 1.5 * d; g.stroke();
    }

    // 文字
    g.fillStyle = '#748180';
    g.textAlign = 'center';
    g.font = `${15 * d}px -apple-system, "PingFang TC", sans-serif`;
    g.fillText('這是範本，換成你的互動', w / 2, h / 2 + base * 1.5 + 28 * d);
    g.fillStyle = 'rgba(116,129,128,.6)';
    g.font = `${12 * d}px ui-monospace, Menlo, monospace`;
    const info = f.bar >= 0 ? `小節 ${f.bar} · 拍 ${f.beat} · 上場 ${f.local.toFixed(2)} s` : '';
    g.fillText(info, w / 2, h / 2 + base * 1.5 + 50 * d);
    if (stage.motion.available) {
      g.fillText(`傾斜 β ${stage.motion.beta.toFixed(0)}° γ ${stage.motion.gamma.toFixed(0)}°`, w / 2, h / 2 + base * 1.5 + 70 * d);
    }
  },
};
