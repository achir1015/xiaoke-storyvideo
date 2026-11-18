// 沒有 Apple 開發者憑證時，替 Mac 版做 ad-hoc 簽章（Apple 晶片的 Mac 不能執行完全沒簽章的程式）
// 內附的 FFmpeg 放在 Contents/Resources/bin，--deep 不會簽到，要先單獨簽。
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = fs.readdirSync(context.appOutDir).find((f) => f.endsWith('.app'));
  if (!app) return;
  const target = path.join(context.appOutDir, app);
  const ent = path.join(__dirname, 'entitlements.mac.plist');
  const ff = path.join(target, 'Contents', 'Resources', 'bin', 'ffmpeg');
  if (fs.existsSync(ff)) {
    fs.chmodSync(ff, 0o755);
    execFileSync('codesign', ['--force', '--sign', '-', '--options', 'runtime', ff], { stdio: 'inherit' });
    execFileSync('lipo', ['-info', ff], { stdio: 'inherit' });
  } else throw new Error('找不到內附的 FFmpeg：' + ff);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--options', 'runtime', '--entitlements', ent, target], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', target], { stdio: 'inherit' });
  console.log('  • ad-hoc 簽章完成', target);
};
