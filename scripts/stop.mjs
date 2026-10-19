import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.KOTOBA_DATA_DIR || resolve(root, 'data');
let url = 'http://127.0.0.1:' + Number(process.env.PORT || 4173);
try { url = JSON.parse(readFileSync(resolve(dataDir, 'local-server.json'), 'utf8')).url; } catch {}
const parsed = new URL(url);
if (parsed.hostname !== '127.0.0.1' || parsed.protocol !== 'http:') throw new Error('服务地址无效，未停止任何进程。');
try {
  const health = await (await fetch(url + '/api/health', { signal: AbortSignal.timeout(2000) })).json();
  if (health.app !== 'kotoba' || health.projectRoot !== root) throw new Error('此端口不是本目录的 Kotoba，未停止其他程序。');
  const { token } = await (await fetch(url + '/api/state')).json();
  const response = await fetch(url + '/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kotoba-Token': token }, body: '{}' });
  if (!response.ok) throw new Error('停止未完成，请稍后重试。');
  console.log('Kotoba 后台服务已停止。已保存的课程、笔记和阅读进度已保留。');
} catch (e) {
  if (e.message === 'fetch failed') console.log('没有检测到运行中的 Kotoba 服务。');
  else throw e;
}
