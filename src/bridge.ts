// Electron preload 提供的桌面功能（線上版沒有）
import type { Net } from './ai';

export interface UpdateInfo {
  current: string;
  latest: string;
  newer: boolean;
  notes: string;
  page: string;
  canInstall: boolean;
  flavor: string;
}

export interface ProjectEntry {
  dir: string;
  title: string;
  updated: string;
  shots: number;
  characters: number;
}

export interface RenderPlanWire {
  jobs: { label: string; args: string[]; dur: number }[];
  final: { label: string; args: string[]; dur: number };
  videoList: string;
  audioList: string;
  srtName: string;
  srt: string;
  outName: string;
}

export interface DesktopBridge {
  info(): Promise<{ version: string; platform: string; arch: string; ffmpeg: string; projectsRoot: string }>;
  settings: { get(): Promise<Record<string, unknown>>; set(s: Record<string, unknown>): Promise<boolean> };
  net: Net & { download(url: string, headers: Record<string, string>, dir: string, rel: string): Promise<number> };
  proj: {
    root(): Promise<string>;
    list(): Promise<ProjectEntry[]>;
    create(title: string): Promise<string>;
    load(dir: string): Promise<unknown>;
    save(dir: string, data: unknown): Promise<boolean>;
    rename(dir: string, title: string): Promise<string>;
    write(dir: string, rel: string, b64: string): Promise<string>;
    writeText(dir: string, rel: string, text: string): Promise<string>;
    read(dir: string, rel: string): Promise<string>;
    exists(dir: string, rel: string): Promise<boolean>;
    remove(dir: string, rel: string): Promise<boolean>;
    import(dir: string, src: string, relDir: string, base: string): Promise<string>;
    abs(dir: string, rel: string): Promise<string>;
  };
  dlg: { images(multi: boolean): Promise<string[]>; story(): Promise<{ name: string; b64: string } | null>; project(): Promise<string | null> };
  allow(p: string): Promise<boolean>;
  pathOf(f: File): string;
  tts: { edge(text: string, voice: string, pitch: string, rate: string, dir: string, rel: string): Promise<string> };
  ff: {
    probe(file: string): Promise<{ dur: number; hasAudio: boolean; hasVideo: boolean }>;
    render(dir: string, plan: RenderPlanWire, outRel: string): Promise<{ video: string; srt: string; size: number }>;
    cancel(): Promise<void>;
    onProgress(fn: (d: { p: number; label: string }) => void): () => void;
  };
  shell: { reveal(p: string): Promise<void>; open(p: string): Promise<string>; external(url: string): Promise<void> };
  update: {
    check(): Promise<UpdateInfo>;
    download(): Promise<string>;
    install(file: string): Promise<{ quitting?: boolean; manual?: boolean; path?: string }>;
    openPage(): Promise<void>;
    onProgress(fn: (d: { got: number; total: number }) => void): () => void;
  };
  platform: string;
  /** 線上版（瀏覽器）才有 */
  web?: boolean;
  /** 線上版：專案檔案的 Blob 網址 */
  media?(abs: string, bust: string): Promise<string>;
}

declare global {
  interface Window {
    xk?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined => window.xk;

/** 專案內檔案的網址（xkmedia:// 支援 Range，可播放影片） */
export function mediaUrl(abs: string, bust = '') {
  return `xkmedia://f/?p=${encodeURIComponent(abs)}${bust ? `&v=${encodeURIComponent(bust)}` : ''}`;
}
