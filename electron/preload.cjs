'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (fn) => {
  const h = (e, d) => fn(d);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.off(ch, h);
};

contextBridge.exposeInMainWorld('xk', {
  info: inv('app:info'),
  settings: { get: inv('settings:get'), set: inv('settings:set') },
  net: { request: inv('net:request'), download: inv('net:download') },
  proj: {
    root: inv('proj:root'),
    list: inv('proj:list'),
    create: inv('proj:create'),
    load: inv('proj:load'),
    save: inv('proj:save'),
    rename: inv('proj:rename'),
    write: inv('proj:write'),
    writeText: inv('proj:writeText'),
    read: inv('proj:read'),
    exists: inv('proj:exists'),
    remove: inv('proj:remove'),
    import: inv('proj:import'),
    abs: inv('proj:abs'),
  },
  dlg: { images: inv('dlg:images'), story: inv('dlg:story'), project: inv('dlg:project') },
  allow: inv('file:allow'),
  pathOf: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  tts: { edge: inv('tts:edge') },
  ff: { probe: inv('ff:probe'), render: inv('ff:render'), cancel: inv('ff:cancel'), onProgress: on('ff:progress') },
  shell: { reveal: inv('shell:reveal'), open: inv('shell:open'), external: inv('shell:external') },
  update: { check: inv('update:check'), download: inv('update:download'), install: inv('update:install'), openPage: inv('update:openPage'), onProgress: on('update:progress') },
  platform: process.platform,
});
