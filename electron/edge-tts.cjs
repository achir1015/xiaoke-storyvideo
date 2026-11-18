'use strict';
// 微軟免費神經語音（Edge 朗讀的線上語音）：不需要金鑰的備用語音
const path = require('path');
const fs = require('fs');
const os = require('os');

async function synth(text, voice, pitch, rate, dest) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xksv-edge-'));
  try {
    const r = await Promise.race([
      tts.toFile(tmp, text, { pitch: pitch || '+0%', rate: rate || '+0%' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('微軟語音逾時')), 60000)),
    ]);
    const st = fs.statSync(r.audioFilePath);
    if (!st.size) throw new Error('微軟語音沒有產生聲音');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(r.audioFilePath, dest);
    return dest;
  } finally {
    try {
      tts.close();
    } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { synth };
