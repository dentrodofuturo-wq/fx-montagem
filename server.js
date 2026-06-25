// FX · Serviço de Montagem ML Clips — v7 (Seedance · vídeo limpo)
// Recebe clips_urls[] (URLs do fal/Seedance) OU clips[] base64 → MP4 vertical 1080x1920, 30s.
// Legenda estilo Apple (fina, sombra suave, sem caixa) + linha dourada, fora da zona segura ML.
// Locução PT-BR (nosso TTS) sobreposta. Regras ML Clips: 9:16, 10-60s, voz, sem preço.

const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '32mb' }));

const PUB = path.join(os.tmpdir(), 'fx_pub');
fs.mkdirSync(PUB, { recursive: true });
app.use('/v', express.static(PUB));

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const W = 1080, H = 1920;
const DUR = 30;
const SEG = [10, 10, 10];                 // 3 cenas de 10s = 30s
const WINDOWS = [[0.4, 9.4], [10.4, 19.4], [20.4, 29.5]];

function wrap(txt, maxChars = 26) {
  const words = String(txt || '').trim().split(/\s+/);
  const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) { lines.push(cur.trim()); cur = w; }
    else { cur += ' ' + w; }
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.join('\n');
}
function safeLegenda(txt) { const w = wrap(txt); return w.trim() ? w : ' '; }
function esc(p) { return p.replace(/\\/g, '/').replace(/:/g, '\\:'); }

async function fetchToFile(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('download falhou ' + r.status + ' :: ' + String(url).slice(0, 70));
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  if (buf.length < 1000) throw new Error('clip baixado vazio/curto :: ' + String(url).slice(0, 70));
}

function prune() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(PUB)) {
      const fp = path.join(PUB, f);
      if (now - fs.statSync(fp).mtimeMs > 3600000) fs.rmSync(fp, { force: true });
    }
  } catch (_) {}
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (err) {
        const s = String(stderr || err.message || '');
        const tail = s.split('\n').map(l => l.trim()).filter(Boolean).slice(-6).join('  |  ');
        return reject(new Error(tail || s.slice(-600)));
      }
      resolve(stdout);
    });
  });
}

app.get('/', (_req, res) => res.json({ ok: true, service: 'fx-montagem', v: 7, motor: 'seedance', res: `${W}x${H}`, dur: DUR }));

app.post('/montar', async (req, res) => {
  prune();
  const id = crypto.randomBytes(5).toString('hex');
  const dir = path.join(os.tmpdir(), 'fx_' + id);
  fs.mkdirSync(dir, { recursive: true });
  const p = f => path.join(dir, f);
  try {
    const b = req.body || {};
    // fontes: URLs (Seedance) e/ou base64 (compat)
    const sources = [];
    (Array.isArray(b.clips_urls) ? b.clips_urls : []).forEach(u => u && sources.push({ t: 'url', v: u }));
    (Array.isArray(b.clips) ? b.clips : []).forEach(x => x && sources.push({ t: 'b64', v: x }));
    [b.clip1_b64, b.clip2_b64, b.clip3_b64].filter(Boolean).forEach(x => sources.push({ t: 'b64', v: x }));
    if (!sources.length) throw new Error('envie clips_urls[] (Seedance) ou clips[] base64');
    while (sources.length < 3) sources.push(sources[sources.length - 1]); // padding p/ 3
    const use = sources.slice(0, 3);

    for (let i = 0; i < 3; i++) {
      const dest = p('c' + i + '.mp4');
      if (use[i].t === 'url') await fetchToFile(use[i].v, dest);
      else fs.writeFileSync(dest, Buffer.from(use[i].v, 'base64'));
    }

    const { locucao_b64, legendas = {} } = b;
    const temAudio = !!locucao_b64;
    if (temAudio) fs.writeFileSync(p('voz.wav'), Buffer.from(locucao_b64, 'base64'));

    const L1 = legendas.l1 || legendas.b1 || '';
    const L2 = legendas.l2 || legendas.b2 || '';
    const L3 = legendas.l3 || [legendas.b3, legendas.b4].filter(Boolean).join(' ') || '';
    fs.writeFileSync(p('l1.txt'), safeLegenda(L1));
    fs.writeFileSync(p('l2.txt'), safeLegenda(L2));
    fs.writeFileSync(p('l3.txt'), safeLegenda(L3));

    // ===== LEGENDA ESTILO APPLE ===== fina, branca, sem caixa, sombra suave.
    // Ancorada pela BASE do bloco em ~84% da altura (um pouco acima da base, fora do rodapé seguro do ML).
    // Cresce para cima, entao legenda longa ou curta nunca invade os controles do ML Clips.
    const Y = 'y=h*0.84-text_h';
    const base = `fontfile=${esc(FONT)}:fontsize=58:fontcolor=white:line_spacing=18:` +
      `shadowcolor=black@0.55:shadowx=0:shadowy=2:x=(w-text_w)/2:${Y}`;
    const dt = (file, win) =>
      `drawtext=${base}:textfile=${esc(p(file))}:enable='between(t,${win[0]},${win[1]})'`;

    const norm = i =>
      `[${i}:v]trim=0:${SEG[i]},setpts=PTS-STARTPTS,fps=30,` +
      `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[v${i}]`;

    const vchain =
      `${norm(0)};${norm(1)};${norm(2)};` +
      `[v0][v1][v2]concat=n=3:v=1:a=0[vc];` +
      `[vc]${dt('l1.txt', WINDOWS[0])},` +
      `${dt('l2.txt', WINDOWS[1])},` +
      `${dt('l3.txt', WINDOWS[2])}[vout]`;

    const outName = id + '.mp4';
    const outPath = path.join(PUB, outName);
    const args = ['-y', '-i', p('c0.mp4'), '-i', p('c1.mp4'), '-i', p('c2.mp4')];
    if (temAudio) args.push('-i', p('voz.wav'));
    args.push('-filter_complex', vchain, '-map', '[vout]');
    if (temAudio) args.push('-map', '3:a', '-c:a', 'aac', '-b:a', '160k');
    args.push(
      '-t', String(DUR), '-r', '30', '-threads', '1', '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
      '-max_muxing_queue_size', '512', '-movflags', '+faststart', outPath
    );

    await run('ffmpeg', args);
    const bytes = fs.statSync(outPath).size;
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const url = `${proto}://${req.get('host')}/v/${outName}`;
    res.json({ ok: true, bytes, url, dur: DUR });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('fx-montagem v6 (seedance) na porta ' + PORT));
