/* =========================================================================
   Editor Hinos — 16:9 (tablatura + violão) e 9:16 (vertical) — PWA 100% local
   Cada formato tem suas pré-edições (PRESETS); o seletor no topo troca tudo.
   ========================================================================= */
'use strict';

/* ---------- Bibliotecas (reaproveita ../vendor) ---------- */
const FFMPEG_VERSION = '0.12.10', UTIL_VERSION = '0.12.1', CORE_VERSION = '0.12.6', WORKER_FILE = '814.ffmpeg.js';
const SOURCES = [
  { name: 'local', ffmpeg: '../vendor/ffmpeg.js', util: '../vendor/util.js', worker: `../vendor/${WORKER_FILE}`,
    core: '../vendor/ffmpeg-core.js', wasm: '../vendor/ffmpeg-core.wasm' },
  { name: 'unpkg',
    ffmpeg: `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/umd/ffmpeg.js`,
    util: `https://unpkg.com/@ffmpeg/util@${UTIL_VERSION}/dist/umd/index.js`,
    worker: `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/umd/${WORKER_FILE}`,
    coreEsm: `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm/ffmpeg-core.js`,
    wasmEsm: `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm/ffmpeg-core.wasm` },
];
const FPS = 30;
const PW = 360, PH = 640; // canvas da prévia 9:16

/* ---------- Pré-edições de cada formato ---------- */
const PRESETS = {
  '16:9': {
    res: '1280x720', crf: '23', round: true, top: 50, bottom: 50,
    title: false, titleY: 10, titleStart: 0.5, titleDur: 5,
    final: '', finalDur: 4, ctaY: 90,
    ctas: [
      { text: 'Inscreva-se no canal', part: 1, start: 3, dur: 4 },
      { text: 'Compartilhe com um amigo', part: 2, start: 1.5, dur: 4 },
      { text: 'Curta o vídeo', part: 2, start: 10, dur: 4 },
    ],
  },
  '9:16': {
    res: '720x1280', crf: '23', round: true, top: 50, bottom: 50,
    title: true, titleY: 36, titleStart: 0.5, titleDur: 5,
    final: 'Quer tocar este hino? Baixe o aplicativo no link da Bio!', finalDur: 4, ctaY: 50,
    ctas: [
      { text: 'Inscreva-se no canal', part: 1, start: 8, dur: 4 },
      { text: 'Curta o vídeo', part: 1, start: 20, dur: 4 },
      { text: 'Compartilhe com um amigo', part: 1, start: 35, dur: 4 },
    ],
  },
};
const RES_OPTIONS = {
  '16:9': [['1280x720', '1280×720 (rápido, recomendado no celular)'], ['1920x1080', '1920×1080 (Full HD, mais lento)']],
  '9:16': [['720x1280', '720×1280 (rápido, recomendado no celular)'], ['1080x1920', '1080×1920 (Full HD, bem mais lento)']],
};

/* ---------- Estado e utilidades ---------- */
const $ = (s) => document.querySelector(s);
const state = {
  mode: '9:16', modeStore: {}, ctas: [],
  file: null, objectUrl: null, vw: 0, vh: 0, duration: 0,
  ffmpeg: null, busy: false, cancelled: false, phaseBase: 0, phaseSpan: 0,
};
const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
const clone = (o) => JSON.parse(JSON.stringify(o));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB');
const log = (m) => { const el = $('#logBox'); el.textContent += m + '\n'; el.scrollTop = el.scrollHeight; };
const errText = (e) => (e && (e.message || (typeof e === 'string' ? e : JSON.stringify(e)))) || String(e);
const abs = (u) => new URL(u, location.href).href;
function setProgress(phase, pct) {
  $('#progressBox').hidden = false;
  if (phase) $('#phase').textContent = phase;
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  $('#pct').textContent = p + '%';
  $('#barFill').style.width = p + '%';
}
const store = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

const rngTime = $('#rngTime'), rngTitleY = $('#rngTitleY'), rngCtaY = $('#rngCtaY');
const rngTop = $('#rngTop'), rngBottom = $('#rngBottom');
const cvFrame = $('#cvFrame'), cvTab = $('#cvTab'), cvGuitar = $('#cvGuitar'), cvPrev = $('#cvPrev');
cvPrev.width = PW; cvPrev.height = PH;

/* =========================================================================
   PWA
   ========================================================================= */
let deferredPrompt = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW:', e)));
}
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; if (!isStandalone()) $('#btnInstall').hidden = false; });
$('#btnInstall').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice;
  deferredPrompt = null; $('#btnInstall').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#btnInstall').hidden = true; deferredPrompt = null; });
if (isIOS() && !isStandalone()) $('#iosHint').hidden = false;

/* =========================================================================
   Modos e configurações (pré-edições)
   ========================================================================= */
function snapshot() {
  return {
    res: $('#selRes').value, crf: $('#selCrf').value, round: $('#chkRound').checked,
    top: +rngTop.value, bottom: +rngBottom.value,
    title: $('#chkTitle').checked, titleY: +rngTitleY.value,
    titleStart: parseFloat($('#inpTitleStart').value) || 0.5, titleDur: parseFloat($('#inpTitleDur').value) || 5,
    final: $('#inpFinal').value, finalDur: parseFloat($('#inpFinalDur').value) || 4,
    ctaY: +rngCtaY.value, ctas: clone(state.ctas),
  };
}
function populateRes(mode) {
  const sel = $('#selRes'); sel.innerHTML = '';
  RES_OPTIONS[mode].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
}
function updateLabels() {
  $('#lblTop').textContent = rngTop.value + '%'; $('#lblBottom').textContent = rngBottom.value + '%';
  $('#lblTitleY').textContent = rngTitleY.value + '%'; $('#lblCtaY').textContent = rngCtaY.value + '%';
}
let lastTop = 50;
function applySettings(s) {
  populateRes(state.mode);
  $('#selRes').value = RES_OPTIONS[state.mode].some(([v]) => v === s.res) ? s.res : RES_OPTIONS[state.mode][0][0];
  $('#selCrf').value = s.crf; $('#chkRound').checked = !!s.round;
  rngTop.value = s.top; rngBottom.value = s.bottom; lastTop = +s.top;
  $('#chkTitle').checked = !!s.title; rngTitleY.value = s.titleY;
  $('#inpTitleStart').value = s.titleStart; $('#inpTitleDur').value = s.titleDur;
  $('#inpFinal').value = s.final; $('#inpFinalDur').value = s.finalDur;
  rngCtaY.value = s.ctaY;
  state.ctas = clone(s.ctas); renderCtas(); updateLabels(); drawPreview();
}
function saveModes() {
  state.modeStore[state.mode] = snapshot();
  store.set('unico-modes', JSON.stringify(state.modeStore));
}
function setMode(mode, first = false) {
  if (!first) state.modeStore[state.mode] = snapshot();
  state.mode = mode;
  document.querySelectorAll('.mode-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  document.querySelectorAll('[data-only]').forEach((el) => (el.hidden = el.dataset.only !== mode));
  $('#ctaList').className = 'cta-list ' + (mode === '16:9' ? 'm169' : 'm916');
  $('#roundHint').textContent = mode === '16:9' ? '(aplica ao violão)' : '(aplica ao vídeo central)';
  $('#outVideo').style.maxWidth = mode === '9:16' ? '360px' : '100%';
  const saved = state.modeStore[mode];
  applySettings(saved && Array.isArray(saved.ctas) ? { ...PRESETS[mode], ...saved } : PRESETS[mode]);
  store.set('unico-mode', mode);
  saveModes();
}
document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => { if (b.dataset.mode !== state.mode && !state.busy) setMode(b.dataset.mode); }));
$('#btnReset').addEventListener('click', () => { applySettings(PRESETS[state.mode]); saveModes(); });
let saveTimer = null;
const debounceSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveModes, 400); };
document.addEventListener('input', debounceSave);
document.addEventListener('change', debounceSave);

/* =========================================================================
   Upload + campos de título
   ========================================================================= */
const dz = $('#dropzone'), fileInput = $('#fileInput');
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

$('#inpInstr').value = store.get('instr');
$('#inpHino').addEventListener('input', drawPreview);
$('#inpInstr').addEventListener('input', () => { store.set('instr', $('#inpInstr').value); drawPreview(); });

function handleFile(file) {
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|mkv|webm|m4v)$/i.test(file.name)) { alert('Escolha um arquivo de vídeo.'); return; }
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.file = file; state.objectUrl = URL.createObjectURL(file);
  $('#fileInfo').textContent = `✔ ${file.name} · ${fmtSize(file.size)}`;
  if (file.size > 1.5e9) alert('Atenção: arquivos acima de ~1,5 GB podem estourar a memória do navegador.');
  const m = file.name.match(/(\d{1,3})/);
  if (m && !$('#inpHino').value) $('#inpHino').value = m[1];

  const v = $('#srcVideo');
  v.preload = 'auto'; v.src = state.objectUrl; v.load();
  v.onloadedmetadata = () => {
    state.vw = v.videoWidth; state.vh = v.videoHeight; state.duration = v.duration;
    $('#fileInfo').textContent += ` · ${state.vw}×${state.vh} · ${fmtTime(state.duration)}`;
    ['#stepPreview', '#stepOptions', '#stepRun'].forEach((s) => ($(s).hidden = false));
    $('#stepResult').hidden = true;
    rngTime.value = 100;
    v.play().then(() => v.pause()).catch(() => {}).finally(seekPreview);
  };
  v.onloadeddata = drawWhenReady;
  v.onerror = () => alert('Não foi possível ler este vídeo no navegador (codec não suportado?). Tente converter para MP4/H.264.');
}

/* =========================================================================
   Desenhos (canvas → PNG): título, CTA, cantos
   ========================================================================= */
function roundRectPath(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r); c.closePath();
}
const toPng = async (cv) => new Uint8Array(await (await new Promise((r) => cv.toBlob(r, 'image/png'))).arrayBuffer());

/** Título: colchete vermelho arredondado + rótulos brancos com texto preto em negrito */
function buildTitleCanvas(rows, OW, OH) {
  let fs = Math.round(Math.min(OW * 0.072, OH * 0.075));
  for (let pass = 0; pass < 2; pass++) {
    const font = `800 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
    const m = document.createElement('canvas').getContext('2d'); m.font = font;
    const padX = Math.round(fs * 0.28), padY = Math.round(fs * 0.08);
    const lineH = Math.round(fs * 1.12) + padY * 2, gap = Math.round(fs * 0.08);
    const widths = rows.map((r) => Math.ceil(m.measureText(r).width) + padX * 2);
    const lw = Math.round(fs * 0.26), vm = Math.round(fs * 0.6), left = Math.round(fs * 0.5);
    const boxX = lw + left;
    const W = boxX + Math.max(...widths) + Math.round(fs * 0.1);
    const H = rows.length * lineH + (rows.length - 1) * gap + vm * 2 + lw;
    if (W > OW * 0.86 && pass === 0) { fs = Math.floor(fs * (OW * 0.86) / W); continue; }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const x0 = lw / 2, y0 = lw / 2, y1 = H - lw / 2, r = Math.round(fs * 0.4);
    const armEnd = Math.min(W - lw, boxX + Math.round(fs * 1.4));
    c.lineWidth = lw; c.strokeStyle = '#ff1414'; c.lineJoin = 'round'; c.lineCap = 'butt';
    c.beginPath(); c.moveTo(armEnd, y0); c.lineTo(x0 + r, y0); c.arcTo(x0, y0, x0, y0 + r, r);
    c.lineTo(x0, y1 - r); c.arcTo(x0, y1, x0 + r, y1, r); c.lineTo(armEnd, y1); c.stroke();
    c.font = font; c.textBaseline = 'middle'; c.textAlign = 'left';
    rows.forEach((txt, i) => {
      const y = lw + vm + i * (lineH + gap);
      c.fillStyle = '#ffffff'; c.fillRect(boxX, y, widths[i], lineH);
      c.fillStyle = '#000000'; c.fillText(txt, boxX + padX, y + lineH / 2 + fs * 0.03);
    });
    return cv;
  }
}

function wrapLines(text, ctx, maxW) {
  if (ctx.measureText(text).width <= maxW) return [text];
  const words = text.split(/\s+/);
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(' '), l2 = words.slice(i).join(' ');
    const w = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width);
    if (!best || w < best.w) best = { w, lines: [l1, l2] };
  }
  return best ? best.lines : [text];
}

/** CTA / texto final: pílula escura translúcida; largura máx. 70% (fora dos botões do TikTok) */
function buildCtaCanvas(text, OW, OH, big = false) {
  let fs = Math.round(Math.min(OW * (big ? 0.056 : 0.048), OH * (big ? 0.052 : 0.045)));
  const maxW = OW * 0.70;
  let lines, font, padX, padY, tw;
  for (let pass = 0; pass < 8; pass++) {
    font = `700 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const m = document.createElement('canvas').getContext('2d'); m.font = font;
    padX = Math.round(fs * 0.9); padY = Math.round(fs * 0.5);
    lines = wrapLines(text, m, maxW - padX * 2);
    tw = Math.ceil(Math.max(...lines.map((l) => m.measureText(l).width)));
    if (tw + padX * 2 > maxW && pass < 7) { fs = Math.floor(fs * 0.92); continue; }
    break;
  }
  const lineH = Math.round(fs * 1.25);
  const w = tw + padX * 2, h = lines.length * lineH + padY * 2 - Math.round(fs * 0.25);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  roundRectPath(c, 0, 0, w, h, Math.min(h / 2, fs * 1.0));
  c.fillStyle = big ? 'rgba(10,12,18,0.72)' : 'rgba(10,12,18,0.62)'; c.fill();
  c.lineWidth = Math.max(2, fs * (big ? 0.07 : 0.05));
  c.strokeStyle = big ? 'rgba(34,211,238,0.85)' : 'rgba(255,255,255,0.22)'; c.stroke();
  c.font = font; c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.textAlign = 'center';
  c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = fs * 0.15;
  lines.forEach((l, i) => c.fillText(l, w / 2, padY + (i + 0.5) * lineH - fs * 0.125 + fs * 0.04));
  return cv;
}

/** Máscara de canto (R×R) para o 9:16: opaca FORA do arco (cinza) — devolve o fundo desfocado nos cantos */
function buildCornerCanvas(R, corner) {
  const cv = document.createElement('canvas'); cv.width = R; cv.height = R;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, R, R);
  const cx = corner === 'tl' || corner === 'bl' ? R : 0, cy = corner === 'tl' || corner === 'tr' ? R : 0;
  c.fillStyle = '#000'; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
  return cv;
}
/** Canto preto (R×R, RGBA) para o 16:9: preto FORA do arco, transparente dentro — sobreposto direto */
function buildBlackCornerCanvas(R, corner) {
  const cv = document.createElement('canvas'); cv.width = R; cv.height = R;
  const c = cv.getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, R, R);
  const cx = corner === 'tl' || corner === 'bl' ? R : 0, cy = corner === 'tl' || corner === 'tr' ? R : 0;
  c.globalCompositeOperation = 'destination-out';
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
  return cv;
}

/* =========================================================================
   Layout + renderização (blocos puros, testáveis)
   ========================================================================= */
/** 16:9 — recorte dentro do quadro; com cantos arredondados deixa margem de 4% */
function fitDims(cw, ch, OW, OH, rounded) {
  const m = rounded ? Math.round(OH * 0.04) : 0;
  const k = Math.min((OW - 2 * m) / cw, (OH - 2 * m) / ch);
  return { sw: even(Math.floor(cw * k)), sh: even(Math.floor(ch * k)), radius: even(Math.round(OH * 0.045)) };
}
/** 9:16 — vídeo central: 94% da largura, no máx. 84% da altura */
function layoutVert(OW, OH) {
  const k = Math.min((OW * 0.94) / state.vw, (OH * 0.84) / state.vh);
  return { fw: even(Math.floor(state.vw * k)), fh: even(Math.floor(state.vh * k)), radius: even(Math.round(OW * 0.045)) };
}
function cropRegions() {
  const W = even(state.vw), H = state.vh;
  const topH = even(H * rngTop.value / 100);
  const botY = even(H * rngBottom.value / 100);
  return { W, topH, botY, botH: even(H - botY) };
}
function titleRows() {
  const num = $('#inpHino').value.trim(), ins = $('#inpInstr').value.trim();
  const rows = [];
  if (num) rows.push(/^\d/.test(num) ? `Hino ${num}` : num);
  if (ins) rows.push(ins);
  return rows;
}

/** Lê a tela e monta título / CTAs / texto final de uma parte (16:9: parte 1 ou 2; 9:16: parte única) */
function collectOverlays(part, OH, dur) {
  const is169 = state.mode === '16:9';
  const rows = titleRows();
  const title = ($('#chkTitle').checked && rows.length && (!is169 || part === 1))
    ? { rows, start: Math.max(0, parseFloat($('#inpTitleStart').value) || 0.5), dur: Math.max(1, parseFloat($('#inpTitleDur').value) || 5), y: +rngTitleY.value } : null;
  const finalText = $('#inpFinal').value.trim();
  const final = (finalText && (!is169 || part === 2))
    ? { text: finalText, dur: Math.min(dur, Math.max(2, parseFloat($('#inpFinalDur').value) || 4)) } : null;
  const ctas = state.ctas
    .filter((c) => c.text.trim() && c.start < dur && (!is169 || c.part === part))
    .map((c) => ({ text: c.text.trim(), start: c.start, dur: c.dur }));
  return { title, final, ctas, centerY: OH * rngCtaY.value / 100 };
}

/** Monta a lista de entradas/filtros do FFmpeg de uma saída */
function makeBuilder(ff, inputName, dur) {
  const B = { ff, args: ['-i', inputName], chains: [], idx: 1, files: [], cur: 0, dur };
  B.addImg = async (name, canvas) => {
    await ff.writeFile(name, await toPng(canvas)); B.files.push(name);
    B.args.push('-loop', '1', '-framerate', String(FPS), '-t', dur.toFixed(3), '-i', name);
    return B.idx++;
  };
  B.overlayAt = (label, x, y, enable) => {
    B.chains.push(`[b${B.cur}][${label}]overlay=x=${x}:y=${y}:format=auto${enable ? `:enable='${enable}'` : ''}[b${B.cur + 1}]`);
    B.cur++;
  };
  return B;
}

async function addTextOverlays(B, o) {
  const { OW, OH, tag, dur } = o;
  if (o.title && o.title.start < dur) {
    const ti = await B.addImg(`${tag}_title.png`, buildTitleCanvas(o.title.rows, OW, OH));
    const ts = o.title.start, te = Math.min(dur, ts + o.title.dur), fd = Math.min(0.4, (te - ts) / 3);
    B.chains.push(`[${ti}:v]format=rgba,fade=t=in:st=${ts}:d=${fd}:alpha=1,fade=t=out:st=${(te - fd).toFixed(3)}:d=${fd}:alpha=1[${tag}tt]`);
    B.overlayAt(`${tag}tt`, Math.round(OW * 0.07), Math.round(OH * o.title.y / 100), `between(t,${ts},${te.toFixed(3)})`);
  }
  const finalStart = o.final ? Math.max(0, dur - o.final.dur) : dur;
  for (let i = 0; i < o.ctas.length; i++) {
    const c = o.ctas[i];
    const s = c.start, e = Math.min(c.start + c.dur, o.final ? finalStart - 0.3 : dur);
    if (e - s < 1) { log(`CTA "${c.text}" ignorado (sem espaço antes do texto final)`); continue; }
    const cc = buildCtaCanvas(c.text, OW, OH);
    const ci = await B.addImg(`${tag}_cta_${i}.png`, cc);
    const fd = Math.min(0.4, (e - s) / 3);
    B.chains.push(`[${ci}:v]format=rgba,fade=t=in:st=${s}:d=${fd}:alpha=1,fade=t=out:st=${(e - fd).toFixed(3)}:d=${fd}:alpha=1[${tag}c${i}]`);
    B.overlayAt(`${tag}c${i}`, '(W-w)/2', Math.round(o.centerY - cc.height / 2), `between(t,${s},${e.toFixed(3)})`);
  }
  if (o.final) {
    const cc = buildCtaCanvas(o.final.text, OW, OH, true);
    const fi = await B.addImg(`${tag}_final.png`, cc);
    B.chains.push(`[${fi}:v]format=rgba,fade=t=in:st=${finalStart.toFixed(3)}:d=0.4:alpha=1[${tag}ff]`);
    B.overlayAt(`${tag}ff`, '(W-w)/2', Math.round(o.centerY - cc.height / 2), `gte(t,${finalStart.toFixed(3)})`);
  }
}

async function execBuilder(B, out, crf, dur) {
  B.args.push(
    '-filter_complex', B.chains.join(';'),
    '-map', `[b${B.cur}]`, '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
    '-t', dur.toFixed(3), '-movflags', '+faststart', out
  );
  log('> ffmpeg ' + B.args.join(' '));
  const code = await B.ff.exec(B.args);
  if (code !== 0 || state.cancelled) throw new Error(state.cancelled ? 'cancelado' : `FFmpeg retornou código ${code} (${out})`);
  await Promise.all(B.files.map((n) => B.ff.deleteFile(n).catch(() => {})));
}

/** 16:9 — uma parte (1 = tablatura, 2 = violão) */
async function renderSplitPart(ff, o) {
  const { inputName, tag, y, h, W, OW, OH, crf, dur, rounded, part, out } = o;
  const B = makeBuilder(ff, inputName, dur);
  if (rounded) {
    // violão: vídeo centralizado sobre preto; os 4 cantos recebem uma sobreposição preta com arco transparente
    const f = fitDims(W, h, OW, OH, true), R = f.radius;
    const X0 = ((OW - f.sw) >> 1) & ~1, Y0 = ((OH - f.sh) >> 1) & ~1;
    const X1 = X0 + f.sw - R, Y1 = Y0 + f.sh - R;
    B.chains.push(
      `[0:v]fps=${FPS},crop=${W}:${h}:0:${y},scale=${f.sw}:${f.sh},setsar=1,format=yuv420p[fg]`,
      `color=c=black:s=${OW}x${OH}:r=${FPS}:d=${dur.toFixed(3)},format=yuv420p[bg]`,
      `[bg][fg]overlay=x=${X0}:y=${Y0}[sq]`
    );
    const pos = { tl: [X0, Y0], tr: [X1, Y0], bl: [X0, Y1], br: [X1, Y1] };
    let prev = 'sq', k = 1;
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const ci = await B.addImg(`${tag}_corner_${corner}.png`, buildBlackCornerCanvas(R, corner));
      const [px, py] = pos[corner];
      B.chains.push(`[${prev}][${ci}:v]overlay=x=${px}:y=${py}:format=auto[k${k}]`);
      prev = `k${k}`; k++;
    }
    B.chains.push(`[${prev}]format=yuv420p[b0]`);
  } else {
    B.chains.push(
      `[0:v]fps=${FPS},crop=${W}:${h}:0:${y},scale=${OW}:${OH}:force_original_aspect_ratio=decrease,` +
      `pad=${OW}:${OH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[b0]`
    );
  }
  await addTextOverlays(B, { ...collectOverlays(part, OH, dur), OW, OH, tag, dur });
  await execBuilder(B, out, crf, dur);
}

/** 9:16 — passe único: fundo desfocado + vídeo central arredondado + título + CTAs + texto final */
async function renderVertical(ff, o) {
  const { inputName, OW, OH, crf, dur } = o;
  const B = makeBuilder(ff, inputName, dur);
  const rounded = $('#chkRound').checked;
  const f = layoutVert(OW, OH), R = f.radius;
  const X0 = ((OW - f.fw) >> 1) & ~1, Y0 = ((OH - f.fh) >> 1) & ~1;
  const X1 = X0 + f.fw - R, Y1 = Y0 + f.fh - R;

  // fundo: miniatura → blur → cor/brilho (tudo em 72×128, barato) → ampliada
  B.chains.push(
    `[0:v]fps=${FPS},split=2[s1][s2]`,
    `[s2]scale=72:128:force_original_aspect_ratio=increase:flags=bilinear,crop=72:128,boxblur=3:2,` +
      `eq=brightness=-0.08:saturation=1.2,scale=${OW}:${OH}:flags=bilinear,format=yuv420p` +
      (rounded ? ',split=5[bg][p1][p2][p3][p4]' : '[bg]'),
    `[s1]scale=${f.fw}:${f.fh},setsar=1,format=yuv420p[fg]`
  );
  if (rounded) {
    B.chains.push(`[bg][fg]overlay=x=${X0}:y=${Y0}[sq]`);
    const pos = { tl: [X0, Y0], tr: [X1, Y0], bl: [X0, Y1], br: [X1, Y1] };
    let prev = 'sq', k = 1;
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const mi = await B.addImg(`corner_${corner}.png`, buildCornerCanvas(R, corner));
      const [px, py] = pos[corner];
      B.chains.push(
        `[p${k}]crop=${R}:${R}:${px}:${py}[q${k}]`,
        `[${mi}:v]format=gray[m${k}]`,
        `[q${k}][m${k}]alphamerge[a${k}]`,
        `[${prev}][a${k}]overlay=x=${px}:y=${py}:format=auto[o${k}]`
      );
      prev = `o${k}`; k++;
    }
    B.chains.push(`[${prev}]format=yuv420p[b0]`);
  } else {
    B.chains.push(`[bg][fg]overlay=x=${X0}:y=${Y0}[b0]`);
  }
  await addTextOverlays(B, { ...collectOverlays(1, OH, dur), OW, OH, tag: 'v', dur });
  await execBuilder(B, 'final.mp4', crf, dur);
}

/* =========================================================================
   Prévias
   ========================================================================= */
function seekPreview() {
  const v = $('#srcVideo');
  const t = (rngTime.value / 1000) * Math.max(0, state.duration - 0.1);
  $('#lblTime').textContent = fmtTime(t);
  v.currentTime = t;
}
function drawWhenReady() {
  const v = $('#srcVideo');
  drawPreview();
  if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(() => drawPreview());
  setTimeout(drawPreview, 200); setTimeout(drawPreview, 600);
}
$('#srcVideo').addEventListener('seeked', drawWhenReady);
rngTime.addEventListener('input', seekPreview);
[rngTitleY, rngCtaY, rngBottom].forEach((r) => r.addEventListener('input', () => { updateLabels(); drawPreview(); }));
rngTop.addEventListener('input', () => {
  // mantém as duas linhas juntas enquanto estiverem iguais
  if (Math.abs(rngBottom.value - lastTop) < 0.01) rngBottom.value = rngTop.value;
  lastTop = parseFloat(rngTop.value);
  updateLabels(); drawPreview();
});
$('#chkRound').addEventListener('change', drawPreview);
['#chkTitle', '#inpFinal'].forEach((s) => $(s).addEventListener('input', drawPreview));
$('#chkTitle').addEventListener('change', drawPreview);

function drawPreview() {
  if (!state.vw) return;
  if (state.mode === '16:9') drawSplitPreview(); else drawVertPreview();
}

function drawFit(ctx, cv, src, sx, sy, sw, sh, rounded) {
  const OW = 640, OH = 360;
  cv.width = OW; cv.height = OH;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, OW, OH);
  const f = fitDims(sw, sh, OW, OH, rounded);
  const dx = (OW - f.sw) / 2, dy = (OH - f.sh) / 2;
  ctx.save();
  if (rounded) { roundRectPath(ctx, dx, dy, f.sw, f.sh, f.radius); ctx.clip(); }
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, f.sw, f.sh);
  ctx.restore();
}

/** Exemplo de título/texto na altura escolhida (prévia) */
function drawSamples(c, OW, OH, part) {
  const rows = titleRows();
  if (rows.length && $('#chkTitle').checked && (state.mode === '9:16' || part === 1)) {
    c.drawImage(buildTitleCanvas(rows, OW, OH), Math.round(OW * 0.07), Math.round(OH * rngTitleY.value / 100));
  }
  const finalText = $('#inpFinal').value.trim();
  const useFinal = finalText && (state.mode === '9:16' || part === 2);
  const first = state.ctas.find((t) => t.text.trim() && (state.mode === '9:16' || t.part === part));
  const sample = useFinal ? finalText : first && first.text;
  if (sample) {
    const cc = buildCtaCanvas(sample.trim(), OW, OH, !!useFinal);
    c.drawImage(cc, Math.round((OW - cc.width) / 2), Math.round(OH * rngCtaY.value / 100 - cc.height / 2));
  }
}

function drawSplitPreview() {
  const v = $('#srcVideo');
  const { W, topH, botY, botH } = cropRegions();
  const k = Math.min(1, 560 / state.vw);
  cvFrame.width = Math.round(state.vw * k); cvFrame.height = Math.round(state.vh * k);
  const c = cvFrame.getContext('2d');
  c.drawImage(v, 0, 0, cvFrame.width, cvFrame.height);
  const yT = topH * k, yB = botY * k;
  c.fillStyle = 'rgba(0,0,0,.55)';
  if (yB > yT) c.fillRect(0, yT, cvFrame.width, yB - yT);
  if (yB < yT) { c.fillStyle = 'rgba(244,114,182,.25)'; c.fillRect(0, yB, cvFrame.width, yT - yB); }
  c.lineWidth = 3;
  c.strokeStyle = '#22d3ee'; c.beginPath(); c.moveTo(0, yT); c.lineTo(cvFrame.width, yT); c.stroke();
  c.strokeStyle = '#f472b6'; c.beginPath(); c.moveTo(0, yB); c.lineTo(cvFrame.width, yB); c.stroke();
  drawFit(cvTab.getContext('2d'), cvTab, v, 0, 0, W, topH, false);
  drawSamples(cvTab.getContext('2d'), cvTab.width, cvTab.height, 1);
  drawFit(cvGuitar.getContext('2d'), cvGuitar, v, 0, botY, W, botH, $('#chkRound').checked);
  drawSamples(cvGuitar.getContext('2d'), cvGuitar.width, cvGuitar.height, 2);
}

function drawVertPreview() {
  const v = $('#srcVideo'), c = cvPrev.getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, PW, PH);
  const k = Math.max(PW / state.vw, PH / state.vh), bw = state.vw * k, bh = state.vh * k;
  c.save(); c.filter = 'blur(16px) brightness(0.92) saturate(1.2)';
  c.drawImage(v, (PW - bw) / 2 - 12, (PH - bh) / 2 - 12, bw + 24, bh + 24); c.restore();
  const f = layoutVert(PW, PH), x = (PW - f.fw) / 2, y = (PH - f.fh) / 2;
  c.save();
  if ($('#chkRound').checked) { roundRectPath(c, x, y, f.fw, f.fh, f.radius); c.clip(); }
  c.drawImage(v, x, y, f.fw, f.fh); c.restore();
  drawSamples(c, PW, PH, 1);
}

/* =========================================================================
   CTAs (editor de textos)
   ========================================================================= */
function renderCtas() {
  const box = $('#ctaList'); box.innerHTML = '';
  state.ctas.forEach((c, i) => {
    const row = document.createElement('div'); row.className = 'cta-item';
    row.innerHTML = `
      <input class="t-text" type="text" maxlength="60" aria-label="Texto" placeholder="Texto" />
      <select class="cta-part" aria-label="Parte"><option value="1">Parte 1 (tab)</option><option value="2">Parte 2 (violão)</option></select>
      <input type="number" min="0" step="0.5" aria-label="Início (s)" placeholder="início s" />
      <input type="number" min="1" step="0.5" aria-label="Duração (s)" placeholder="dur. s" />
      <button class="del" type="button" aria-label="Remover">✕</button>`;
    const [txt, sel, st, du, del] = row.querySelectorAll('input,select,button');
    txt.value = c.text; sel.value = c.part || 1; st.value = c.start; du.value = c.dur;
    txt.oninput = () => { c.text = txt.value; drawPreview(); };
    sel.onchange = () => { c.part = +sel.value; drawPreview(); };
    st.oninput = () => (c.start = Math.max(0, parseFloat(st.value) || 0));
    du.oninput = () => (c.dur = Math.max(1, parseFloat(du.value) || 3));
    del.onclick = () => { state.ctas.splice(i, 1); renderCtas(); saveModes(); };
    box.appendChild(row);
  });
}
$('#btnAddCta').addEventListener('click', () => { state.ctas.push({ text: 'Novo texto', part: 1, start: 5, dur: 3 }); renderCtas(); saveModes(); });

/* =========================================================================
   FFmpeg.wasm — carregamento (worker clássico + núcleo UMD local; ESM via CDN como reserva)
   ========================================================================= */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Falha ao carregar ' + src));
    document.head.appendChild(s);
  });
}
async function ensureEngine() {
  if (state.ffmpeg) return state.ffmpeg;
  const [local, cdn] = SOURCES;
  const attempts = [
    { label: 'local (worker clássico + núcleo UMD)', src: local, kind: 'umd' },
    { label: 'CDN (worker módulo + núcleo ESM)', src: cdn, kind: 'esm' },
  ];
  const errors = [];
  for (const at of attempts) {
    let ff = null;
    try {
      setProgress(`Carregando motor (${at.label})…`, 2);
      log(`== Tentativa: ${at.label}`);
      if (!window.FFmpegWASM) await loadScript(at.src.ffmpeg);
      if (!window.FFmpegUtil) await loadScript(at.src.util);
      const { FFmpeg } = window.FFmpegWASM, { toBlobURL } = window.FFmpegUtil;
      ff = new FFmpeg();
      ff.on('log', ({ message }) => log(message));
      ff.on('progress', ({ progress }) => {
        if (!state.phaseSpan) return;
        setProgress(null, state.phaseBase + Math.max(0, Math.min(1, progress)) * state.phaseSpan);
      });
      let urls;
      if (at.kind === 'umd') {
        urls = { coreURL: abs(at.src.core), wasmURL: abs(at.src.wasm) };
      } else {
        const [coreURL, wasmURL, classWorkerURL] = await Promise.all([
          toBlobURL(at.src.coreEsm, 'text/javascript'),
          toBlobURL(at.src.wasmEsm, 'application/wasm'),
          toBlobURL(at.src.worker, 'text/javascript'),
        ]);
        urls = { coreURL, wasmURL, classWorkerURL };
      }
      setProgress('Inicializando FFmpeg (≈31 MB, só na 1ª vez)…', 6);
      await ff.load(urls);
      state.ffmpeg = ff; log('FFmpeg carregado: ' + at.label);
      return ff;
    } catch (e) {
      const msg = `${at.label}: ${errText(e)}`;
      errors.push(msg); console.warn(msg, e); log('FALHOU → ' + msg);
      try { ff && ff.terminate(); } catch (_) {}
      delete window.FFmpegWASM; delete window.FFmpegUtil;
    }
  }
  document.querySelector('.log').open = true;
  throw new Error('Não foi possível carregar o FFmpeg.wasm.\n\n' + errors.join('\n'));
}

/* =========================================================================
   Execução
   ========================================================================= */
async function run() {
  if (state.busy || !state.file) return;
  state.busy = true; state.cancelled = false;
  $('#btnRun').hidden = true; $('#btnCancel').hidden = false;
  $('#stepResult').hidden = true; $('#logBox').textContent = '';
  const mode = state.mode;
  const t0 = performance.now();
  try {
    saveModes();
    const ff = await ensureEngine();
    const [OW, OH] = $('#selRes').value.split('x').map(Number);
    const crf = +$('#selCrf').value, dur = state.duration;
    const ext = (state.file.name.match(/\.(\w+)$/) || [, 'mp4'])[1].toLowerCase();
    const inputName = `input.${ext}`;

    setProgress('Lendo o vídeo para a memória…', 8);
    await ff.writeFile(inputName, await window.FFmpegUtil.fetchFile(state.file));

    if (mode === '9:16') {
      state.phaseBase = 12; state.phaseSpan = 84;
      setProgress('Fundo desfocado, cantos, título e CTAs…', 12);
      await renderVertical(ff, { inputName, OW, OH, crf, dur });
      await ff.deleteFile(inputName).catch(() => {});
      state.phaseSpan = 0;
    } else {
      const { W, topH, botY, botH } = cropRegions();
      state.phaseBase = 10; state.phaseSpan = 38;
      setProgress('Cortando tablatura…', 10);
      await renderSplitPart(ff, { inputName, tag: 'p1', y: 0, h: topH, W, OW, OH, crf, dur, rounded: false, part: 1, out: 'part1.mp4' });
      state.phaseBase = 48; state.phaseSpan = 38;
      setProgress('Cortando violão…', 48);
      await renderSplitPart(ff, { inputName, tag: 'p2', y: botY, h: botH, W, OW, OH, crf, dur, rounded: $('#chkRound').checked, part: 2, out: 'part2.mp4' });
      await ff.deleteFile(inputName).catch(() => {});
      state.phaseSpan = 0;
      setProgress('Unindo sequências…', 88);
      await ff.writeFile('list.txt', new TextEncoder().encode("file 'part1.mp4'\nfile 'part2.mp4'\n"));
      const code = await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', 'final.mp4']);
      if (code !== 0) throw new Error('Falha ao concatenar (código ' + code + ')');
      await Promise.all(['part1.mp4', 'part2.mp4', 'list.txt'].map((f) => ff.deleteFile(f).catch(() => {})));
    }

    setProgress('Finalizando…', 97);
    const data = await ff.readFile('final.mp4');
    await ff.deleteFile('final.mp4').catch(() => {});
    showResult(new Blob([data.buffer], { type: 'video/mp4' }), (performance.now() - t0) / 1000, mode);
    setProgress('Concluído!', 100);
  } catch (e) {
    console.error(e);
    if (state.cancelled) setProgress('Cancelado.', 0);
    else { setProgress('Erro: ' + e.message.split('\n')[0], 0); document.querySelector('.log').open = true; alert('Erro ao processar: ' + e.message); }
  } finally {
    state.busy = false; $('#btnRun').hidden = false; $('#btnCancel').hidden = true;
  }
}

function showResult(blob, secs, mode) {
  const url = URL.createObjectURL(blob);
  const rows = titleRows().join('-').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const suffix = mode === '9:16' ? '9x16' : '16x9';
  const name = `${rows || state.file.name.replace(/\.\w+$/, '')}-${suffix}.mp4`;
  $('#outVideo').src = url;
  const a = $('#btnDownload'); a.href = url; a.download = name;
  const total = mode === '16:9' ? state.duration * 2 : state.duration;
  $('#outInfo').textContent = `${fmtSize(blob.size)} · duração ${fmtTime(total)} · processado em ${Math.round(secs)} s`;
  $('#stepResult').hidden = false;
  $('#stepResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const share = $('#btnShare'), file = new File([blob], name, { type: 'video/mp4' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    share.hidden = false; share.onclick = () => navigator.share({ files: [file], title: name }).catch(() => {});
  }
}

$('#btnRun').addEventListener('click', run);
$('#btnCancel').addEventListener('click', () => {
  if (!state.busy || !state.ffmpeg) return;
  state.cancelled = true; state.ffmpeg.terminate(); state.ffmpeg = null;
});

/* ---------- Início ---------- */
try { state.modeStore = JSON.parse(store.get('unico-modes') || '{}') || {}; } catch (_) { state.modeStore = {}; }
setMode(store.get('unico-mode') === '16:9' ? '16:9' : '9:16', true);
