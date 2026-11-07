/* ==========================================================================
   lut — .cube 調色檔（3D LUT），給各個互動的鏡頭畫面共用
   --------------------------------------------------------------------------
   用法（WebGL）：
     import { LUT_FILE, parseCube, LUT_GLSL, uploadLut } from './lut.js';
     shader 裡放 ${LUT_GLSL}，就可以用 lut(顏色) 調色
     const L = parseCube(await stage.file(LUT_FILE));
     gl.useProgram(program); uploadLut(gl, program, L, 貼圖單元);
   ========================================================================== */

// 調色檔（相對於 scenes/ 裡的檔案；GitHub 會分大小寫，要和檔名一模一樣）
export const LUT_FILE = '../lut/color.CUBE';

/* ---------- 讀 .cube（Photoshop、DaVinci、Premiere 匯出的 3D LUT） ---------- */
export function parseCube(buf) {
  const text = new TextDecoder().decode(buf);
  let size = 0, min = [0, 0, 0], max = [1, 1, 1], data = null, k = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'LUT_3D_SIZE') { size = parseInt(parts[1], 10); data = new Float32Array(size * size * size * 3); }
    else if (key === 'LUT_1D_SIZE') throw new Error('這是 1D LUT，請匯出 3D LUT');
    else if (key === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number);
    else if (key === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number);
    else if (data && /^[-+.\d]/.test(key) && k < data.length) {
      for (let j = 0; j < 3; j++) data[k++] = Math.min(1, Math.max(0, parseFloat(parts[j]) || 0));
    }
  }
  if (!size || k !== size * size * size * 3) throw new Error(`.cube 檔格式不對（讀到 ${k / 3} 個顏色）`);
  return { size, min, max, data };
}

/* ---------- shader：lut(c) ----------
   每一層藍色是一塊 N×N（橫軸紅、直軸綠），排成格狀放在一張 2D 圖裡；相鄰兩層之間再內插 */
export const LUT_GLSL = `
uniform sampler2D uLut;
uniform vec2 uLutTex;
uniform vec3 uDomMin, uDomMax;
uniform float uLutN, uLutCols;
vec2 lutPos(float b, vec2 rg){ return (vec2(mod(b, uLutCols), floor(b / uLutCols)) * uLutN + rg) / uLutTex; }
vec3 lut(vec3 c){
  c = clamp((c - uDomMin) / (uDomMax - uDomMin), 0.0, 1.0) * (uLutN - 1.0);
  float b0 = floor(c.b), b1 = min(b0 + 1.0, uLutN - 1.0);
  vec2 rg = c.rg + 0.5;
  return mix(texture2D(uLut, lutPos(b0, rg)).rgb, texture2D(uLut, lutPos(b1, rg)).rgb, c.b - b0);
}
`;

/* ---------- 把 parseCube() 的結果放進顯示卡 ----------
   program 要是目前使用中的（gl.useProgram）；unit 是要用的貼圖單元。回傳貼圖 */
export function uploadLut(gl, program, L, unit, tex) {
  const n = L.size, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const w = cols * n, h = rows * n;
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (w > max || h > max) throw new Error(`LUT 太大（${n}），這支手機放不下`);
  const px = new Uint8Array(w * h * 4);
  for (let b = 0, i = 0; b < n; b++) {
    const ox = (b % cols) * n, oy = Math.floor(b / cols) * n;
    for (let g = 0; g < n; g++) for (let r = 0; r < n; r++, i++) {
      const o = ((oy + g) * w + ox + r) * 4;
      px[o] = Math.round(L.data[i * 3] * 255);
      px[o + 1] = Math.round(L.data[i * 3 + 1] * 255);
      px[o + 2] = Math.round(L.data[i * 3 + 2] * 255);
      px[o + 3] = 255;
    }
  }
  gl.activeTexture(gl.TEXTURE0 + unit);
  tex = tex || gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const u = name => gl.getUniformLocation(program, name);
  gl.uniform1i(u('uLut'), unit);
  gl.uniform1f(u('uLutN'), n);
  gl.uniform1f(u('uLutCols'), cols);
  gl.uniform2f(u('uLutTex'), w, h);
  gl.uniform3fv(u('uDomMin'), L.min);
  gl.uniform3fv(u('uDomMax'), L.max);
  gl.activeTexture(gl.TEXTURE0);
  return tex;
}
