/**
 * 首次打开 babyworld.ltd 时，把安装包内加密种子写入页面 localStorage。
 */
const fs = require('fs');
const path = require('path');
const { decryptSeed } = require('./seedCrypto');

const FLAG = 'trade_scout_desktop_seed_v1';

function resolveSeedPath() {
  // 打包后：resources/seed.bin；开发：desktop/resources/seed.bin
  const candidates = [
    path.join(process.resourcesPath || '', 'seed.bin'),
    path.join(__dirname, '..', 'resources', 'seed.bin'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function loadSeedPayload() {
  const p = resolveSeedPath();
  if (!p) return null;
  try {
    return decryptSeed(fs.readFileSync(p));
  } catch (e) {
    console.error('[seed] decrypt failed', e);
    return null;
  }
}

/**
 * @param {import('electron').WebContents} webContents
 */
async function injectSeedIntoPage(webContents) {
  const payload = loadSeedPayload();
  if (!payload?.localStorage) {
    await webContents.executeJavaScript(
      `window.__BW_SEED_DONE=true;window.dispatchEvent(new Event('bw-seed-done'));`,
      true
    );
    return { ok: false, reason: 'no-seed' };
  }

  const script = `
(function(){
  try {
    var FLAG=${JSON.stringify(FLAG)};
    var seed=${JSON.stringify(payload.localStorage)};
    var force = false;
    try { force = localStorage.getItem('trade_scout_desktop_seed_force') === '1'; } catch(e) {}
    var already = false;
    try { already = localStorage.getItem(FLAG) === '1'; } catch(e) {}
    if (!already || force) {
      var keys = Object.keys(seed || {});
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = seed[k];
        if (v == null) continue;
        try {
          if (force || localStorage.getItem(k) == null || localStorage.getItem(k) === '') {
            localStorage.setItem(k, String(v));
          }
        } catch (e) {}
      }
      try { localStorage.setItem(FLAG, '1'); localStorage.removeItem('trade_scout_desktop_seed_force'); } catch(e) {}
    }
  } catch (e) {}
  window.__BW_SEED_DONE = true;
  window.dispatchEvent(new Event('bw-seed-done'));
})();`;

  await webContents.executeJavaScript(script, true);
  return { ok: true, keys: Object.keys(payload.localStorage).length };
}

module.exports = { injectSeedIntoPage, resolveSeedPath, FLAG };
