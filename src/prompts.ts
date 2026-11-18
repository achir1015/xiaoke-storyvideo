// 給影像／影片 AI 的提示詞：寫實攝影、正確光源與色溫、鏡頭焦段（純函式）
import { type Character, GRID_VIEWS, type Project, type Shot } from './types';
import { ageBand } from './voices';

const SHOT_EN: Record<Shot['shotType'], string> = {
  遠景: 'extreme wide establishing shot, characters small in the environment, full scenery visible',
  中景: 'medium shot framing characters from the waist up, environment visible behind them',
  近景: 'medium close-up framing head and shoulders, shallow depth of field',
  特寫: 'close-up on the face showing detailed expression and skin texture, very shallow depth of field, creamy bokeh',
};

const MOVE_EN: Record<string, string> = {
  固定: 'static locked-off camera on a tripod',
  緩慢推近: 'slow smooth dolly-in toward the subject',
  輕微推近: 'very subtle slow push-in',
  拉遠: 'slow dolly-out revealing more of the scene',
  緩慢橫搖: 'slow smooth horizontal pan across the scene',
  橫搖: 'slow horizontal pan',
  跟拍: 'handheld tracking shot following the subject, gentle natural camera shake',
};

export function kelvinWords(k: number) {
  if (k <= 2800) return `very warm ${k}K candle/tungsten light`;
  if (k <= 3600) return `warm ${k}K tungsten or golden-hour light`;
  if (k <= 4800) return `neutral-warm ${k}K light`;
  if (k <= 6000) return `neutral daylight ${k}K`;
  return `cool ${k}K overcast or shade light`;
}

export const REALISM =
  'Photorealistic live-action cinematic photograph, shot on a full-frame cinema camera, natural skin texture with pores, realistic proportions, physically accurate lighting and shadows, true-to-life colors, subtle film grain. Not a cartoon, not anime, not an illustration, not 3D render, no text, no watermark, no subtitles.';

function describeChar(c: Character) {
  const band = ageBand(c.age);
  const who = band === 'child' ? (c.gender === 'female' ? 'girl' : 'boy') : c.gender === 'female' ? 'woman' : 'man';
  return `${c.name} (a ${c.age}-year-old Taiwanese ${who}${c.look ? `; ${c.look}` : ''})`;
}

/** 九宮格角色參考圖（AI 幫手） */
export function gridPrompt(c: Character, hasPhoto: boolean): string {
  const cells = GRID_VIEWS.map((v, i) => `${i + 1}. ${v}`).join('；');
  return `${hasPhoto ? 'Using the attached photo(s) as the exact identity reference of this person (same face, hairstyle, body type and clothing), create' : 'Create'} a single photorealistic character reference sheet arranged as a clean 3x3 grid of nine equal square photos with thin white gutters, same person and same outfit in every cell, plain neutral light-grey studio backdrop, soft even studio lighting at 5600K.
Subject: ${describeChar(c)}.
Cells left-to-right, top-to-bottom: 1 front view full body; 2 left side profile full body; 3 right side profile full body; 4 three-quarter view upper body; 5 back view full body; 6 wide shot full body standing small in frame; 7 medium shot waist up; 8 close shot chest up; 9 extreme close-up of the face.
（中文格位：${cells}）
${REALISM} No labels or numbers inside the image.`;
}

/** 單一鏡頭的關鍵畫面（之後交給影片 AI 當第一格） */
export function stillPrompt(p: Project, shot: Shot, chars: Character[]): string {
  const cast = chars.length ? `Characters (match the attached reference sheets exactly — same faces, hair, clothes): ${chars.map(describeChar).join('; ')}.` : 'No people in frame unless described.';
  return `${REALISM}
Aspect ratio ${p.aspect}. ${SHOT_EN[shot.shotType]}, ${shot.lens}mm lens.
Scene: ${shot.scene ? `${shot.scene}. ` : ''}${shot.visual}
${shot.prompt ? `Details: ${shot.prompt}` : ''}
Time of day: ${shot.timeOfDay}. Lighting: ${shot.light}, ${kelvinWords(shot.kelvin)}; light direction and shadows must be consistent and physically plausible; correct white balance for the light source.
${cast}
${p.style ? `Overall setting/style: ${p.style}.` : 'Setting: contemporary Taiwan unless the story says otherwise.'}`;
}

/** 影片 AI：以關鍵畫面為第一格，演出這個鏡頭（對白由本工具另外配音，所以影片不要說話） */
export function videoPrompt(p: Project, shot: Shot, chars: Character[], seconds: number): string {
  const acting = shot.lines
    .filter((l) => l.speaker !== 'narrator')
    .map((l) => {
      const c = chars.find((x) => x.id === l.speaker);
      return c ? `${c.name} speaks${l.emotion ? ` (${l.emotion})` : ''}, natural lip and facial movement` : '';
    })
    .filter(Boolean)
    .join('; ');
  return `Turn this frame into realistic live-action film footage, ${seconds} seconds, continuous single shot. ${SHOT_EN[shot.shotType]}. Camera: ${MOVE_EN[shot.move] ?? shot.move}.
Action: ${shot.visual}${acting ? `. ${acting}` : ''}.
Keep the exact same people, faces, clothing, lighting (${shot.timeOfDay}, ${shot.light}, ${kelvinWords(shot.kelvin)}) and location as the first frame. Natural human motion, realistic physics, no morphing.
Audio: only natural ambient sound of the location${shot.ambience ? ` (${shot.ambience})` : ''}; no music, no narration, no speech, no singing.
${REALISM}`;
}

/** 測試用：提示詞不可提到卡通 */
export function looksRealistic(prompt: string) {
  return /Photorealistic/i.test(prompt) && /Not a cartoon/i.test(prompt);
}
