import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { explainError, outputs } from '../src/ai';
import { gridPrompt, hordePrompt, hordeSheetPrompt, lookToEn, looksRealistic, stillPrompt, videoPrompt } from '../src/prompts';
import { HORDE_MODELS, hordeSize } from '../src/horde';
import { buildPlan, shotVideoJob } from '../src/render-plan';
import { SAMPLE_CAST, SAMPLE_STORY } from '../src/sample';
import { applyLocalShot, extractJson, guessCharacters, localShotPrompt, localShotSchema, parseStoryboard, ruleStoryboard, splitLong, estimateSec, varyShotTypes, MAX_LINE_SEC } from '../src/storyboard';
import { aiVideoSeconds, buildSrt, buildTimeline, chunkText, fmtSrtTime, shotDuration } from '../src/timeline';
import { type Character, newCharacter, newProject, newShot, normalizeProject } from '../src/types';
import { ageBand, edgeVoiceFor, geminiVoiceFor, spaceFor, voiceDesignPrompt } from '../src/voices';

const require = createRequire(import.meta.url);
const FF: string = require('ffmpeg-static');

function cast(): Character[] {
  return SAMPLE_CAST.map((c, i) => ({ ...newCharacter(i + 1), name: c.name, gender: c.gender, age: c.age, look: c.look, voiceNote: c.voiceNote }));
}

describe('分鏡', () => {
  it('從範例故事找出角色', () => {
    const names = guessCharacters(SAMPLE_STORY).map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['阿海伯', '小葵', '美玲']));
  });

  it('規則式分鏡：旁白與台詞分開、說話的人在畫面裡', () => {
    const cs = cast();
    const shots = ruleStoryboard(SAMPLE_STORY, cs);
    expect(shots.length).toBeGreaterThan(4);
    expect(shots[0].shotType).toBe('遠景');
    const all = shots.flatMap((s) => s.lines);
    const kui = cs.find((c) => c.name === '小葵')!;
    const line = all.find((l) => l.text.includes('今天有抓到大魚嗎'));
    expect(line?.speaker).toBe(kui.id);
    expect(all.some((l) => l.speaker === 'narrator' && l.text.includes('清晨五點'))).toBe(true);
    for (const s of shots) for (const l of s.lines) expect(estimateSec(l.text)).toBeLessThanOrEqual(MAX_LINE_SEC + 0.5);
    // 有說話的鏡頭，說話者要在出場角色裡
    const withKui = shots.find((s) => s.lines.includes(line!));
    expect(withKui?.characters).toContain(kui.id);
  });

  it('長句切段', () => {
    const t = '這是一段非常非常長的旁白，'.repeat(12);
    const parts = splitLong(t);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(t);
  });

  it('解析 AI 分鏡 JSON（容錯）', () => {
    const cs = cast();
    const text = '好的，以下是分鏡：\n```json\n{"shots":[{"scene":"漁港","shotType":"大遠景","characters":["阿海伯"],"kelvin":"3200","lines":[{"speaker":"小葵","text":"阿公！","emotion":"開心"},{"speaker":"旁白","text":"天亮了。"}]}]}\n```';
    const shots = parseStoryboard(extractJson(text), cs);
    expect(shots).toHaveLength(1);
    expect(shots[0].shotType).toBe('中景'); // 不認得的鏡頭改成中景
    expect(shots[0].kelvin).toBe(3200);
    expect(shots[0].characters).toEqual([cs[0].id, cs[1].id]); // 用名字對應 id，說話的人自動加入
    expect(shots[0].lines[1].speaker).toBe('narrator');
  });
});

describe('本機小模型分鏡', () => {
  const chars = cast();
  const p = { ...newProject('t'), story: SAMPLE_STORY, characters: chars };
  const shots = ruleStoryboard(SAMPLE_STORY, chars);
  it('每鏡提示含台詞、人物與前一鏡；每鏡格式相同', () => {
    const t = localShotPrompt(p, shots, 1);
    expect(t).toContain('第 2／');
    expect(t).toContain('上一個鏡頭');
    expect(t).toContain(shots[1].lines[0].text);
    // 每鏡同一份格式（WebLLM 換格式會出錯）
    expect(JSON.stringify(localShotSchema(1))).toBe(JSON.stringify(localShotSchema(3)));
  });
  it('套用回答：合理的值採用、不合理的保留原值、台詞不變', () => {
    const s0 = shots[2];
    const out = applyLocalShot(s0, { shotType: '近景', scene: '碼頭', timeOfDay: '清晨', kelvin: 4800, lens: 50, move: '緩慢推近', visual: '老人拉網', prompt: 'photorealistic cinematic still of an old fisherman', emotions: ['開心', '溫柔', '急促'] });
    expect(out.shotType).toBe('近景');
    expect(out.kelvin).toBe(4800);
    expect(out.lines.map((l) => l.text)).toEqual(s0.lines.map((l) => l.text));
    const bad = applyLocalShot(s0, { shotType: '大特寫', kelvin: 99999, lens: 3, prompt: '中文提示', move: '亂動' });
    expect(bad.shotType).toBe(s0.shotType);
    expect(bad.kelvin).toBe(s0.kelvin);
    expect(bad.move).toBe(s0.move);
    expect(bad.prompt ?? '').toBe(s0.prompt ?? '');
    expect(bad.lens).toBeGreaterThanOrEqual(12);
    expect(applyLocalShot(s0, null).lines.length).toBe(s0.lines.length);
  });
  it('不會連續三個相同鏡頭', () => {
    const same = [0, 1, 2, 3].map(() => ({ ...newShot(), shotType: '中景' as const }));
    const v = varyShotTypes(same);
    for (let i = 2; i < v.length; i++) expect(v[i].shotType === v[i - 1].shotType && v[i].shotType === v[i - 2].shotType).toBe(false);
  });
});

describe('免費雲端畫面（AI Horde）', () => {
  it('尺寸是 64 的倍數、不超過像素上限、比例接近', () => {
    for (const a of ['16:9', '9:16', '1:1']) {
      const { width, height } = hordeSize(a, 512 * 512);
      expect(width % 64).toBe(0);
      expect(height % 64).toBe(0);
      expect(width * height).toBeLessThanOrEqual(512 * 512);
      const [x, y] = a.split(':').map(Number);
      expect(Math.abs(width / height - x / y)).toBeLessThan(0.15);
    }
  });
  it('提示詞：英文寫實關鍵字＋人物；Z-Image 另附中文畫面', () => {
    const chars = cast();
    const p = { ...newProject('t'), characters: chars };
    const shot = { ...newShot(), shotType: '特寫' as const, timeOfDay: '清晨', visual: '小葵蹲在漁網旁', characters: [chars[1].id] };
    const en = hordePrompt(p, shot, [chars[1]], false);
    expect(en).toMatch(/photorealistic/);
    expect(en).toMatch(/8-year-old Taiwanese little girl/);
    expect(en).not.toMatch(/[\u4e00-\u9fff]/);
    const zh = hordePrompt(p, shot, [chars[1]], true);
    expect(zh).toContain('小葵蹲在漁網旁');
    expect(HORDE_MODELS.every((m) => m.params.steps > 0)).toBe(true);
  });
});

describe('外觀文字轉英文', () => {
  it('顏色對應衣物、依距離只放看得到的部分', () => {
    const look = '皮膚黝黑、滿臉皺紋與花白短髮，穿深藍色防水連身漁夫褲、灰色長袖棉衫、黑色雨鞋';
    const full = lookToEn(look, 'full');
    expect(full).toContain('navy blue waterproof fishing bib overalls');
    expect(full).toContain('grey long-sleeve cotton shirt');
    expect(full).toContain('black rain boots');
    expect(full).toContain('tanned skin');
    const chest = lookToEn(look, 'chest');
    expect(chest).toContain('grey long-sleeve cotton shirt');
    expect(chest).not.toContain('rain boots');
    expect(chest).not.toContain('overalls');
    const face = lookToEn(look, 'face');
    expect(face).toContain('grey hair');
    expect(face).not.toContain('shirt');
    expect(lookToEn('綁兩條麻花辮的小女孩，穿黃色雨鞋、紅色防風外套、牛仔褲')).toContain('yellow rain boots');
  });
  it('九宮格特寫格不提鞋子', () => {
    const c = { ...cast()[0] };
    const p9 = hordeSheetPrompt(c, 8, '');
    expect(p9).toMatch(/^\(close-up portrait of the face/);
    expect(p9).not.toMatch(/boots/);
  });
});

describe('提示詞', () => {
  it('寫實、不要卡通，含光線與焦段', () => {
    const p = newProject();
    const cs = cast();
    const s = { ...newShot(), shotType: '特寫' as const, kelvin: 3200, lens: 85, visual: '小葵看著魚', characters: [cs[1].id] };
    const sp = stillPrompt(p, s, [cs[1]]);
    expect(looksRealistic(sp)).toBe(true);
    expect(sp).toMatch(/85mm/);
    expect(sp).toMatch(/3200K/);
    expect(sp).toMatch(/8-year-old Taiwanese girl/);
    expect(videoPrompt(p, s, [cs[1]], 6)).toMatch(/no speech/);
    expect(gridPrompt(cs[0], true)).toMatch(/3x3 grid/);
  });
});

describe('聲音', () => {
  it('依性別年齡分聲音', () => {
    expect(ageBand(8)).toBe('child');
    expect(ageBand(70)).toBe('senior');
    const [a, k, m] = cast();
    expect(geminiVoiceFor(a)).not.toBe(geminiVoiceFor(k));
    expect(edgeVoiceFor(k).voice).toMatch(/Xiaoyi/);
    expect(edgeVoiceFor(a).voice).toMatch(/Yunjian/);
    expect(edgeVoiceFor(m).voice).toMatch(/zh-TW/);
    // 同一層的第二位聲音要不同
    expect(edgeVoiceFor(m, 1).pitch).not.toBe(edgeVoiceFor(m, 0).pitch);
    expect(voiceDesignPrompt(k)).toMatch(/little girl/);
    expect(voiceDesignPrompt(a)).toMatch(/70s/);
  });

  it('遠景小聲有殘響、特寫乾淨', () => {
    const far = spaceFor('遠景', false);
    const close = spaceFor('特寫', false);
    expect(far.gain).toBeLessThan(close.gain);
    expect(far.echo).not.toBe('');
    expect(close.echo).toBe('');
  });
});

describe('時間軸與 SRT', () => {
  it('SRT 時間格式與切行', () => {
    expect(fmtSrtTime(3723.456)).toBe('01:02:03,456');
    expect(chunkText('短句')).toEqual(['短句']);
    const parts = chunkText('今天天氣很好，我們一起到海邊去散步，順便看看漁船回來了沒有。', 18);
    expect(parts.length).toBeGreaterThan(1);
    for (const x of parts) expect([...x].length).toBeLessThanOrEqual(18);
  });

  it('台詞時間依語音長度排列、SRT 不重疊', () => {
    const p = newProject();
    p.characters = cast();
    p.shots = ruleStoryboard(SAMPLE_STORY, p.characters);
    p.shots[0].lines[0].dur = 5;
    const tl = buildTimeline(p);
    expect(tl.shots[0].dur).toBeGreaterThanOrEqual(5);
    expect(tl.total).toBeCloseTo(p.shots.reduce((a, s) => a + shotDuration(s), 0), 5);
    const srt = buildSrt(p, tl);
    const times = [...srt.matchAll(/(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})/g)].map((m) => [m[1], m[2]]);
    expect(times.length).toBeGreaterThan(p.shots.length);
    for (let i = 1; i < times.length; i++) expect(times[i][0] >= times[i - 1][1]).toBe(true);
    for (const s of p.shots) expect(aiVideoSeconds(s)).toBeLessThanOrEqual(15);
  });

  it('舊專案補預設值', () => {
    const p = normalizeProject({ title: 'x', characters: [{ id: 'a', name: '甲' }], shots: [{ id: 's', lines: [{ speaker: 'narrator', text: '嗨' }] }] });
    expect(p.characters[0].voice.engine).toBe('auto');
    expect(p.shots[0].lines[0].emotion).toBe('');
    expect(p.output.ambience).toBe(35);
  });
});

describe('Gemini 回應解析', () => {
  it('取出 steps 裡的內容', () => {
    const r = { steps: [{ type: 'thought', content: [{ type: 'text', text: 'x' }] }, { type: 'model_output', content: [{ type: 'image', mime_type: 'image/png', data: 'AAA' }] }] };
    expect(outputs(r)).toEqual([{ type: 'image', mime_type: 'image/png', data: 'AAA' }]);
    expect(outputs({ foo: { bar: [{ type: 'video', uri: 'u' }] } })[0].uri).toBe('u');
  });
  it('錯誤訊息翻譯', () => {
    expect(explainError(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}').kind).toBe('key');
    expect(explainError(429, '{}').kind).toBe('quota');
    expect(explainError(404, '{}').kind).toBe('model');
  });
});

describe('FFmpeg 合成（實際執行）', () => {
  it('2.5D 立體動態照片：依深度圖做視差', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xksv-px-'));
    const run = (args: string[]) => {
      const r = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', ...args], { cwd: dir, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(r.stderr);
      return r;
    };
    run(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=800x450', '-frames:v', '1', join(dir, 'still.png')]);
    run(['-y', '-f', 'lavfi', '-i', 'gradients=s=800x450:c0=black:c1=white:x0=0:y0=0:x1=0:y1=450:d=1', '-frames:v', '1', join(dir, 'depth.png')]);
    const p = newProject('立體');
    p.resolution = '720p';
    for (const move of ['緩慢推近', '橫搖', '固定', '拉遠']) {
      const shot = { ...newShot(), id: 'a', shotType: '中景' as const, move };
      const job = shotVideoJob(p, shot, 0, 1.5, { video: {}, still: { a: join(dir, 'still.png') }, depth: { a: join(dir, 'depth.png') }, audio: {}, font: 'x' });
      expect(job.label).toContain('立體');
      run(job.args);
      const info = spawnSync(FF, ['-hide_banner', '-i', join(dir, 'v_000.mp4')], { encoding: 'utf8' }).stderr;
      expect(info).toMatch(/1280x720/);
      expect(info).toMatch(/Duration: 00:00:01\.[45]/);
    }
  });


  it('畫面、配音、遠近效果、字幕軌合成成功', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xksv-test-'));
    const run = (args: string[]) => {
      const r = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', ...args], { cwd: dir, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(r.stderr);
      return r;
    };
    run(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1024x1024', '-frames:v', '1', join(dir, 'still.png')]);
    run(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=220:d=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'clip.mp4')]);
    run(['-y', '-f', 'lavfi', '-i', 'sine=f=440:d=1.5', join(dir, 'l1.wav')]);
    run(['-y', '-f', 'lavfi', '-i', 'sine=f=660:d=1.2', join(dir, 'l2.mp3')]);

    const p = newProject('測試');
    p.characters = cast();
    const s1 = { ...newShot(), id: 'a', shotType: '遠景' as const, move: '緩慢橫搖', lines: [{ speaker: 'narrator', text: '清晨的漁港。', emotion: '', dur: 1.5 }] };
    const s2 = { ...newShot(), id: 'b', shotType: '特寫' as const, characters: [p.characters[1].id], lines: [{ speaker: p.characters[1].id, text: '阿公！今天有抓到大魚嗎？', emotion: '', dur: 1.2 }] };
    const s3 = { ...newShot(), id: 'c', shotType: '中景' as const, lines: [] };
    p.shots = [s1, s2, s3];
    const inp = {
      video: { b: { path: join(dir, 'clip.mp4'), dur: 2, hasAudio: true } },
      still: { a: join(dir, 'still.png') },
      audio: { 'a:0': join(dir, 'l1.wav'), 'b:0': join(dir, 'l2.mp3') },
      font: 'Microsoft JhengHei',
    };
    const plan = buildPlan(p, inp, 'final.mp4');
    writeFileSync(join(dir, 'videos.txt'), plan.videoList);
    writeFileSync(join(dir, 'audios.txt'), plan.audioList);
    writeFileSync(join(dir, plan.srtName), '\ufeff' + buildSrt(p, plan.timeline));
    for (const j of [...plan.jobs, plan.final]) run(j.args);
    const info = spawnSync(FF, ['-hide_banner', '-i', join(dir, 'final.mp4')], { encoding: 'utf8' }).stderr;
    expect(info).toMatch(/Video: h264/);
    expect(info).toMatch(/Audio: aac/);
    expect(info).toMatch(/Subtitle: mov_text/);
    expect(info).toMatch(/1280x720/);
    const m = /Duration: 00:00:(\d+\.\d+)/.exec(info)!;
    expect(Math.abs(+m[1] - plan.timeline.total)).toBeLessThan(0.3);
    expect(readFileSync(join(dir, plan.srtName), 'utf8')).toMatch(/阿公/);
  });
});
