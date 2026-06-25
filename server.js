// FX · Serviço de Montagem ML Clips (Cloud Run)
// Recebe 2 clipes (Veo) + locução + legendas → devolve MP4 1080x1920 15s.
// Receita validada localmente: concat 8s+7s, legenda queimada em janelas, marca FX.

const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '64mb' }));

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

// quebra texto em linhas de ~maxChars pra caber na vertical
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

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 256 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

app.get('/', (_req, res) => res.json({ ok: true, service: 'fx-montagem', v: 1 }));

// POST /montar
// body: { clip1_b64, clip2_b64, locucao_b64, legendas: { b1,b2,b3,b4 } }
app.post('/montar', async (req, res) => {
  const id = crypto.randomBytes(5).toString('hex');
  const dir = path.join(os.tmpdir(), 'fx_' + id);
  fs.mkdirSync(dir, { recursive: true });
  const p = f => path.join(dir, f);
  try {
    const { clip1_b64, clip2_b64, locucao_b64, legendas = {} } = req.body;
    if (!clip1_b64 || !clip2_b64) throw new Error('clip1_b64 e clip2_b64 são obrigatórios');

    fs.writeFileSync(p('c1.mp4'), Buffer.from(clip1_b64, 'base64'));
    fs.writeFileSync(p('c2.mp4'), Buffer.from(clip2_b64, 'base64'));
    const temAudio = !!locucao_b64;
    if (temAudio) fs.writeFileSync(p('voz.wav'), Buffer.from(locucao_b64, 'base64'));

    fs.writeFileSync(p('b1.txt'), wrap(legendas.b1));
    fs.writeFileSync(p('b2.txt'), wrap(legendas.b2));
    fs.writeFileSync(p('b3.txt'), wrap(legendas.b3));
    fs.writeFileSync(p('b4.txt'), wrap(legendas.b4));

    const DT = `fontfile=${FONT}:fontcolor=white:fontsize=52:line_spacing=14:` +
      `box=1:boxcolor=0x000000@0.55:boxborderw=26:x=(w-text_w)/2:y=h-580:text_align=C`;

    const vchain =
      `[0:v]trim=0:8,setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v0];` +
      `[1:v]trim=0:7,setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v1];` +
      `[v0][v1]concat=n=2:v=1:a=0[vc];` +
      `[vc]drawtext=${DT}:textfile=${p('b1.txt')}:enable='between(t,0,3)',` +
      `drawtext=${DT}:textfile=${p('b2.txt')}:enable='between(t,3,8)',` +
      `drawtext=${DT}:textfile=${p('b3.txt')}:enable='between(t,8,12)',` +
      `drawtext=${DT}:textfile=${p('b4.txt')}:enable='between(t,12,15)',` +
      `drawtext=fontfile=${FONT}:text='FX':fontcolor=0xC8A96E:fontsize=44:x=w-text_w-50:y=70:alpha=0.9[vout]`;

    const args = ['-y', '-i', p('c1.mp4'), '-i', p('c2.mp4')];
    if (temAudio) args.push('-i', p('voz.wav'));
    args.push('-filter_complex', vchain, '-map', '[vout]');
    if (temAudio) args.push('-map', '2:a', '-c:a', 'aac', '-b:a', '128k');
    args.push('-t', '15', '-r', '30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264',
      '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', p('out.mp4'));

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
app.listen(PORT, () => console.log('fx-montagem na porta ' + PORT));
