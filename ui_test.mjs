// UI + 近身肉搏位移验证脚本
// 运行：node ui_test.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8766;
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.json':'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(__dirname, p);
  if (!fp.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); res.end(data); });
});
await new Promise(r => server.listen(PORT, r));

const results = { passed: [], failed: [] };
function check(name, cond, detail = '') { const ok = !!cond; (ok ? results.passed : results.failed).push({ name, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  [' + detail + ']' : ''}`); return ok; }
function observe(name, val) { console.log(`  👀 观察: ${name} = ${val}`); }

let browser;
try { browser = await chromium.launch({ headless: true }); }
catch (e) { console.error('无法启动 chromium：' + e.message); server.close(); process.exit(1); }
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => { if (!navigator.mediaDevices) navigator.mediaDevices = {}; navigator.mediaDevices.getUserMedia = () => Promise.reject(); window.__pageErrors = []; window.addEventListener('error', e => window.__pageErrors.push(String(e.message||e.error))); window.addEventListener('unhandledrejection', e => window.__pageErrors.push('unhandledrejection: ' + (e.reason&&e.reason.message||e.reason))); });

await page.goto(`http://localhost:${PORT}/index.html?demo`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__play && window.__game && document.querySelector('#charge-fill'), { timeout: 20000 });
await page.waitForTimeout(1000);

console.log('\n========== 一、#message-box 左下角定位 ==========');
{
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const box = await page.evaluate(() => {
    const el = document.getElementById('message-box');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, bottom: r.bottom, right: r.right };
  });
  observe('视口', `${vp.w}x${vp.h}`);
  observe('message-box rect', JSON.stringify(box));
  check('message-box 存在', !!box);
  check('message-box 在左半区', box.left < vp.w * 0.5, `left=${box.left} (视口宽${vp.w})`);
  check('message-box 在下半区(靠下)', box.bottom > vp.h * 0.55, `bottom=${box.bottom} (视口高${vp.h})`);
  check('message-box 未居中遮挡', !(box.left < vp.w*0.4 && box.top < vp.h*0.4), `left=${box.left} top=${box.top}`);
}

console.log('\n========== 二、玩家血条上方架势条 UI ==========');
{
  const ok = await page.evaluate(() => {
    const pcf = document.getElementById('player-charge-fill');
    const pct = document.getElementById('player-charge-text');
    const ct = document.getElementById('charge-text');
    return {
      fillExists: !!pcf,
      textExists: !!pct,
      text: pct ? pct.textContent : null,
      bottomText: ct ? ct.textContent : null,
      chargeMax: window.__play.getCharges ? null : null,
    };
  });
  observe('player-charge-fill 存在', ok.fillExists);
  observe('player-charge-text', ok.text);
  observe('底部 charge-text', ok.bottomText);
  check('玩家血条上方架势条 fill 存在', ok.fillExists);
  check('玩家血条上方架势条 text 存在', ok.textExists);
  check('架势上限=10 (文本 0/10)', ok.text === '0/10', `text=${ok.text}`);
  check('底部架势条同步=10', ok.bottomText === '0/10', `bottomText=${ok.bottomText}`);
}

console.log('\n========== 三、PREEMPT 近身肉搏位移 ==========');
{
  // 触发 PREEMPT：玩家剪刀 vs Boss 剪刀
  await page.evaluate(() => {
    window.__play.setParams({ selectMs: 300, chargeMs: 300, slotMs: 300, roundEndMs: 300 });
    window.__play.setDemo(false);
    window.__play.startGame();
    window.__play.setCharges({ p: 0, b: 0 });
    window.__play.setBossMoves([1,1,1,1,1]);
    window.__play.forceSelect(1); // SCISSORS
  });
  let sawPreempt = false, minGap = 99, sawPreemptPlayerZ = 0, sawPreemptBossZ = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    const g = await page.evaluate(() => { const g = window.__game(); return { phase: g.phase, pz: g.player ? g.player.posZ : 0, bz: g.boss ? g.boss.posZ : 0, pCharge: g.player ? g.player.clashZ : 0, bCharge: g.boss ? g.boss.clashZ : 0 }; });
    if (g.phase === 6 || g.phase === 5) break; // PREEMPT=6? 需确认
    if (g.phase === 8) { sawPreempt = true; }
    // 记录玩家与Boss间距
    const gap = Math.abs(g.pz - g.bz);
    if (gap < minGap) { minGap = gap; }
    if (i < 5) observe(`t${i} phase=${g.phase} pz=${g.pz.toFixed(2)} bz=${g.bz.toFixed(2)}`);
  }
  observe('最小对峙间距 minGap', minGap.toFixed(2));
  check('PREEMPT/COUNTER 阶段玩家与Boss接近（间距 < 2）', minGap < 2, `minGap=${minGap.toFixed(2)}`);
}

console.log('\n========== 四、非战斗阶段复位站位 ==========');
{
  // 进入 CHARGE(2) 或 EXECUTE(3)，应回各自站位
  await page.evaluate(() => { window.__play.startGame(); window.__play.setDemo(true); });
  await page.waitForTimeout(1200);
  const g = await page.evaluate(() => { const g = window.__game(); return { phase: g.phase, pz: g.player ? g.player.posZ : 0, bz: g.boss ? g.boss.posZ : 0 }; });
  observe('非PREEMPT阶段', `phase=${g.phase} pz=${g.pz.toFixed(2)} bz=${g.bz.toFixed(2)}`);
  check('玩家站位复位(≈6.2)', Math.abs(g.pz - 6.2) < 0.3, `pz=${g.pz.toFixed(2)}`);
  check('Boss站位复位(≈15.8)', Math.abs(g.bz - 15.8) < 0.3, `bz=${g.bz.toFixed(2)}`);
}

console.log('\n========== 五、截图 + 完整对局回归 ==========');
{
  const errsBefore = await page.evaluate(() => window.__pageErrors.splice(0));
  const loopErrs = [];
  for (let r = 1; r <= 3; r++) {
    await page.evaluate(() => { window.__play.startGame(); window.__play.setDemo(false); });
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const st = await page.evaluate(() => { const g = window.__game(); return { phase: g.phase, playerHp: g.player ? g.player.hp : 0, bossHp: g.bossHp }; });
      if (st.phase === 1) { await page.evaluate(() => window.__play.forceSelect(Math.floor(Math.random() * 4))); await page.waitForTimeout(250); }
      if (st.phase === 6 || st.phase === 5) break;
      await page.waitForTimeout(180);
      if (st.playerHp < 0 || st.bossHp < 0 || isNaN(st.playerHp) || isNaN(st.bossHp)) { loopErrs.push(`round${r}: 血量异常 p=${st.playerHp} b=${st.bossHp}`); break; }
    }
    const errs = await page.evaluate(() => window.__pageErrors.splice(0));
    if (errs.length) loopErrs.push(`round${r}: JS错误 → ${errs.join('; ')}`);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, 'ui_check.png') });
  observe('已截图 ui_check.png');
  check('完整对局：无 JS 异常 / 血量异常', loopErrs.length === 0, loopErrs.join(' | '));
}

console.log('\n========== UI TEST 汇总 ==========');
console.log(`通过: ${results.passed.length}  |  失败: ${results.failed.length}`);
await browser.close();
server.close();
process.exit(results.failed.length ? 1 : 0);
