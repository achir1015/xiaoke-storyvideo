'use strict';
// 內建 FFmpeg：讀媒體長度、依合成計畫產生影片（含進度與取消）
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

function ffmpegPath() {
  const cands = [];
  if (app.isPackaged) cands.push(path.join(process.resourcesPath, 'bin', EXE));
  cands.push(path.join(__dirname, '..', 'node_modules', 'ffmpeg-static', EXE));
  for (const c of cands) if (fs.existsSync(c)) return c;
  return EXE;
}

const running = new Map();

function run(args, { cwd, timeout = 0, onTime, id } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], { cwd, windowsHide: true });
    if (id) running.set(id, child);
    let err = '';
    let out = '';
    let timer = null;
    if (timeout) timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (d) => {
      if (out.length < 100000) out += d.toString();
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      if (err.length > 400000) err = err.slice(-200000);
      if (onTime) {
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
        if (m) onTime(+m[1] * 3600 + +m[2] * 60 + +m[3]);
      }
    });
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      if (id) running.delete(id);
      reject(e);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (id) running.delete(id);
      resolve({ code, signal, stderr: err, stdout: out });
    });
  });
}

/** 媒體長度（秒）與是否有聲音 */
async function probe(file) {
  const r = await run(['-i', file], { timeout: 30000 });
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr);
  const dur = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
  return { dur, hasAudio: /Stream #.*Audio:/.test(r.stderr), hasVideo: /Stream #.*Video:/.test(r.stderr) };
}

async function version() {
  const r = await run(['-version'], { timeout: 10000 });
  return (/ffmpeg version (\S+)/.exec(r.stdout + r.stderr) || [])[1] || '';
}

let cancelled = false;

/**
 * 依計畫合成：jobs 依序執行（每個鏡頭的畫面與聲音），最後串接與輸出。
 * onProgress(0~1, 說明)
 */
async function render(workDir, plan, onProgress) {
  cancelled = false;
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'videos.txt'), plan.videoList);
  fs.writeFileSync(path.join(workDir, 'audios.txt'), plan.audioList);
  fs.writeFileSync(path.join(workDir, plan.srtName), '﻿' + plan.srt);
  const jobs = [...plan.jobs, plan.final];
  // 權重：畫面編碼最花時間
  const weight = (j) => (/畫面|輸出/.test(j.label) ? 3 : 1) * Math.max(1, j.dur);
  const total = jobs.reduce((a, j) => a + weight(j), 0);
  let done = 0;
  for (const job of jobs) {
    if (cancelled) throw new Error('已取消');
    onProgress(done / total, job.label);
    const r = await run(job.args, {
      cwd: workDir,
      id: 'render',
      onTime: (t) => onProgress((done + weight(job) * Math.min(1, t / Math.max(0.1, job.dur))) / total, job.label),
    });
    if (cancelled) throw new Error('已取消');
    if (r.code !== 0) {
      const tail = r.stderr.trim().split(/\r?\n/).slice(-6).join('\n');
      throw new Error(`${job.label}失敗：\n${tail}`);
    }
    done += weight(job);
  }
  onProgress(1, '完成');
}

function cancel() {
  cancelled = true;
  for (const c of running.values()) c.kill('SIGKILL');
}

module.exports = { probe, render, cancel, version, run, ffmpegPath };
