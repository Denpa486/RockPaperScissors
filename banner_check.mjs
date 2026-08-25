import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8782;
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.json':'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(__dirname, p);
  if (!fp.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); res.end(data); });
});
await new Promise(r => server.listen(PORT, r));

const results = { passed: [], failed: [] };
function check(name, cond, detail='') { const ok=!!cond; (ok?results.passed:results.failed).push({name}); console.log(`${ok?'✅':'❌'} ${name}${detail?'  ['+detail+']':''}`); }

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => { if (!navigator.mediaDevices) navigator.mediaDevices = {}; navigator.mediaDevices.getUserMedia = () => Promise.reject(); window.__pageErrors=[]; window.addEventListener('error',e=>window.__pageErrors.push(String(e.message||e.error))); window.addEventListener('unhandledrejection',e=>window.__pageErrors.push('unhandledrejection: '+(e.reason&&e.reason.message||e.reason))); });
await page.goto(`http://localhost:${PORT}/index.html?demo`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__play && window.__game && document.querySelector('#charge-fill'), { timeout: 20000 });
await page.waitForTimeout(1000);

// 触发 EXECUTE 看 banner
await page.evaluate(() => {
  window.__play.setParams({ selectMs: 300, chargeMs: 300, slotMs: 300, roundEndMs: 300 });
  window.__play.setDemo(false);
  window.__play.startGame();
  window.__play.setBossMoves([0,0,0,0,0]);
  window.__play.forceSelect(0);
});
await page.waitForTimeout(700);
const info = await page.evaluate(() => {
  const b = document.getElementById('phase-banner');
  const m = document.getElementById('message-box');
  const br = b.getBoundingClientRect();
  const mr = m.getBoundingClientRect();
  return { vp:{w:innerWidth,h:innerHeight}, banner:{left:br.left,top:br.top,bottom:br.bottom,right:br.right}, msg:{left:mr.left,top:mr.top,bottom:mr.bottom,right:mr.right}, bannerText:(b.querySelector('.b-top')||{}).textContent, errs:[...window.__pageErrors] };
});
console.log('banner rect', JSON.stringify(info.banner), 'text=', info.bannerText);
console.log('message rect', JSON.stringify(info.msg));
check('banner 在左半区', info.banner.left < info.vp.w*0.5, `left=${info.banner.left}`);
check('banner 在下半区', info.banner.bottom > info.vp.h*0.5, `bottom=${info.banner.bottom}`);
check('banner 未遮挡中央', !(info.banner.left < info.vp.w*0.4 && info.banner.top < info.vp.h*0.4), `left=${info.banner.left} top=${info.banner.top}`);
check('banner 与 message-box 不重叠', !(info.banner.left < info.msg.right && info.banner.right > info.msg.left && info.banner.top < info.msg.bottom && info.banner.bottom > info.msg.top), `bannerTop=${info.banner.top} msgBottom=${info.msg.bottom}`);
check('无 JS 错误', info.errs.length===0, info.errs.join('; '));
console.log(`通过: ${results.passed.length} | 失败: ${results.failed.length}`);

await page.screenshot({ path: path.join(__dirname, 'banner_check.png') });
await browser.close();
server.close();
process.exit(results.failed.length?1:0);
