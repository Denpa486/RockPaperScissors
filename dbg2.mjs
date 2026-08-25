import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8771;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(__dirname, p), (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200); res.end(data); });
});
await new Promise(r => server.listen(PORT, r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.addInitScript(() => { if (!navigator.mediaDevices) navigator.mediaDevices = {}; navigator.mediaDevices.getUserMedia = () => Promise.reject(); });
await page.goto(`http://localhost:${PORT}/index.html?demo`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__play && window.__game, { timeout: 20000 });
await page.waitForTimeout(1000);
await page.evaluate(() => { window.__play.setParams({ selectMs: 500, chargeMs: 500, slotMs: 400, roundEndMs: 300 }); window.__play.setDemo(false); });

// 第四组：玩家闪避(5) vs Boss剪刀(5)，有架势3
await page.evaluate(() => {
  window.__play.startGame();
  window.__play.setCharges({ p: 3, b: 0 });
  window.__play.setBossMoves([1, 1, 1, 1, 1]);
  window.__play.forceSelect(3);
});
for (let t = 0; t < 6; t++) {
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => { const g = window.__game(); return { phase: g.phase, hp: g.player ? g.player.hp : 0, combo: g.player ? g.player.combo : [], bMoves: g.bossMoves, gesture: g.player ? g.player.gesture : null }; });
  const c = await page.evaluate(() => window.__play.getCharges());
  console.log(`t${t}: phase=${s.phase} hp=${s.hp} combo=[${s.combo}] bMoves=[${s.bMoves}] gesture=${s.gesture} chg p=${c.p} b=${c.b} pMod=${c.pMod} bMod=${c.bMod}`);
}
await browser.close(); server.close();
