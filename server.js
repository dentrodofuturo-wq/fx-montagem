// FX · Serviço de Montagem ML Clips — v3 (leve, cabe em 512MB)
// 2 clipes (Veo) + locução + legendas → MP4 vertical 720x1280 15s.
// Otimizado p/ Render Free: 720p + ultrafast + 1 thread (pico de RAM baixo).

const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '64mb' }));

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const W = 720, H = 1280; // resolução de trabalho (vertical) — leve p/ 512MB

function wrap(txt, maxChars = 22) {
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

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 256 }, (err, stdout, stderr) => {
      if (err) {
        const s = String(stderr || err.message || '');
        const tail = s.split('\n').map(l => l.trim()).filter(Boolean).slice(-6).join('  |  ');
        return reject(new Error(tail || s.slice(-600)));
      }
      resolve(stdout);
    });
  });
}

app.get('/', (_req, res) => res.json({ ok: true, service: 'fx-montagem', v: 3, res: `${W}x${H}` }));

app.post('/montar', async (req, res) => {
  const id = crypto.randomBytes(5).toString('hex');
  const dir = path.join(os.tmpdir(), 'fx_' + id);
  fs.mkdirSync(dir, { recursive: true });
  const p = f => path.join(dir, f);
  try {
    const { clip1_b64, clip2_b64, locucao_b64, legendas = {} } = req.body;
    if (!clip1_b64 || !clip2_b64) throw new Error('clip1_b64 e clip2_b64 sao obrigatorios');

    fs.writeFileSync(p('c1.mp4'), Buffer.from(clip1_b64, 'base64'));
    fs.writeFileSync(p('c2.mp4'), Buffer.from(clip2_b64, 'base64'));
    const temAudio = !!locucao_b64;
    if (temAudio) fs.writeFileSync(p('voz.wav'), Buffer.from(locucao_b64, 'base64'));

    fs.writeFileSync(p('b1.txt'), safeLegenda(legendas.b1));
    fs.writeFileSync(p('b2.txt'), safeLegenda(legendas.b2));
    fs.writeFileSync(p('b3.txt'), safeLegenda(legendas.b3));
    fs.writeFileSync(p('b4.txt'), safeLegenda(legendas.b4));

    // tamanhos proporcionais a 720x1280
    const DT = `fontfile=${FONT}:fontcolor=white:fontsize=36:line_spacing=10:` +
      `box=1:boxcolor=0x000000@0.55:boxborderw=18:x=(w-text_w)/2:y=h-390`;

    const norm = `setpts=PTS-STARTPTS,fps=24,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
    const vchain =
      `[0:v]trim=0:8,${norm}[v0];` +
      `[1:v]trim=0:7,${norm}[v1];` +
      `[v0][v1]concat=n=2:v=1:a=0[vc];` +
      `[vc]drawtext=${DT}:textfile=${p('b1.txt')}:enable='between(t,0,3)',` +
      `drawtext=${DT}:textfile=${p('b2.txt')}:enable='between(t,3,8)',` +
      `drawtext=${DT}:textfile=${p('b3.txt')}:enable='between(t,8,12)',` +
      `drawtext=${DT}:textfile=${p('b4.txt')}:enable='between(t,12,15)',` +
      `drawtext=fontfile=${FONT}:text=FX:fontcolor=0xC8A96E:fontsize=30:x=w-text_w-34:y=48:alpha=0.9[vout]`;

    const args = ['-y', '-i', p('c1.mp4'), '-i', p('c2.mp4')];
    if (temAudio) args.push('-i', p('voz.wav'));
    args.push('-filter_complex', vchain, '-map', '[vout]');
    if (temAudio) args.push('-map', '2:a', '-c:a', 'aac', '-b:a', '128k', '-shortest');
    args.push(
      '-t', '15', '-r', '24',
      '-threads', '1',                 // Render Free = 1 vCPU; multithread so incha RAM
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24',
      '-max_muxing_queue_size', '256',
      '-movflags', '+faststart', p('out.mp4')
    );

    await run('ffmpeg', args);
    const mp4 = fs.readFileSync(p('out.mp4'));
    res.json({ ok: true, mp4_base64: mp4.toString('base64'), bytes: mp4.length });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('fx-montagem v3 na porta ' + PORT));
