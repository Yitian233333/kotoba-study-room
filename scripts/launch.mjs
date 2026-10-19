import { spawn } from 'node:child_process';
import { openSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173), url = 'http://127.0.0.1:' + port;
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('请先安装 Node.js 24 或更新版本，再打开学习室。');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 需为 1024—65535 的整数。');
async function running() {
  try { const r = await fetch(url + '/api/health', { signal: AbortSignal.timeout(1500) }); const health = await r.json(); if (health.app === 'kotoba' && health.version === '0.2.1' && health.projectRoot === root) return true; throw new Error('此端口正在运行其他程序或旧版 Kotoba。请先停止对应服务，或设置 PORT 使用其他端口。'); }
  catch (e) { if (e.message.startsWith('此端口')) throw e; return false; }
}
const dataDir = process.env.KOTOBA_DATA_DIR || resolve(root, 'data');
mkdirSync(dataDir, { recursive: true });
if (!await running()) {
  const out = openSync(resolve(dataDir, 'server.log'), 'a'), err = openSync(resolve(dataDir, 'server-error.log'), 'a');
  const child = spawn(process.execPath, [resolve(root, 'src/server.mjs')], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, err], env: process.env });
  child.on('error', e => console.error('启动失败：' + e.message)); child.unref(); closeSync(out); closeSync(err);
  let ok = false;
  for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 250)); if (await running()) { ok = true; break; } }
  if (!ok) throw new Error('服务未启动，请查看 data/server-error.log。');
}
writeFileSync(resolve(dataDir, 'local-server.json'), JSON.stringify({ url }, null, 2));
console.log('Kotoba 学习室已启动：' + url + '\n课程、笔记和阅读进度自动保存到 data/kotoba.sqlite。使用“停止学习室.cmd”可以停止后台服务。');
const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
if (!process.argv.includes('--no-browser')) {
  const opener = spawn(command, args, { detached: true, windowsHide: true, stdio: 'ignore' }); opener.on('error', () => console.log('请在浏览器手动打开：' + url)); opener.unref();
}
