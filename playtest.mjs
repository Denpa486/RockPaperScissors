// 自动化 playtest：针对「统一闪避系统」+「架势条新规则」+「Boss防守反击」的规则验证 + 完整对局回归
// MOVE 枚举：STONE=0 SCISSORS=1 DRAGON=2 DODGE=3
// 架势条新规则：
//   - 剪刀打到石头（被石头防御）→ 石头方架势 +1
//   - 闪避（躲剪刀/升龙）不累积架势；有架势→消耗1格100%躲开；无架势→30%
//   - 攻击招（剪刀/升龙）命中 → 消耗全部架势 +1/格
//   - 玩家升龙被 Boss 闪避躲开 → Boss 防守反击窗口（玩家做闪避/石头化解，否则受2点）
// 运行：node playtest.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8765;
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
const page = await browser.newPage();
await page.addInitScript(() => { if (!navigator.mediaDevices) navigator.mediaDevices = {}; navigator.mediaDevices.getUserMedia = () => Promise.reject(); window.__pageErrors = []; window.addEventListener('error', e => window.__pageErrors.push(String(e.message||e.error))); window.addEventListener('unhandledrejection', e => window.__pageErrors.push('unhandledrejection: ' + (e.reason&&e.reason.message||e.reason))); });

await page.goto(`http://localhost:${PORT}/index.html?demo`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__play && window.__game && document.querySelector('#charge-fill'), { timeout: 20000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { window.__play.setParams({ selectMs: 400, chargeMs: 400, slotMs: 350, roundEndMs: 350 }); window.__play.setDemo(false); });

// 单段场景：判定完成后由闪避分支注入 window.__lastJudge，直接读取（无轮询时序依赖）
async function single(pMove, bossMoves, { p = 0, b = 0, randVal = null } = {}) {
  await page.evaluate(({ p, b, pMove, bossMoves, randVal }) => {
    window.__play.startGame();
    window.__play.setCharges({ p, b });
    if (randVal !== null) window.__play.setRandom(function () { return randVal; });
    window.__play.setBossMoves(bossMoves);
    window.__play.forceSelectLen(pMove, 1);
  }, { p, b, pMove, bossMoves, randVal });
  let j = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    j = await page.evaluate(() => { const c = window.__play.getCharges(); const g = window.__game(); return { ...window.__lastJudge, phase: g.phase, hp: g.player ? g.player.hp : 0, bhp: g.bossHp, p: c.p, b: c.b, pMod: c.pMod, bMod: c.bMod }; });
    if (j.scene) break;   // 判定已完成
  }
  await page.evaluate(() => window.__play.setRandom(null));
  return j;
}

const D=3, R=0, S=1, C=2; // 闪避/石头/剪刀/升龙
const MAX = 10;           // 架势条上限

console.log('\n========== 一、闪避 vs 升龙（核心） ==========');
{
  let j = await single(D, [C], { p: 2, b: 0, randVal: 0.9 }); // 有架势必成
  check('闪避vs升龙(有架势)：消耗1架势(2→1)', j.pCharge === 1, `pCharge=${j.pCharge}`);
  check('闪避vs升龙(有架势)：攻击+1', j.pMod === 1, `pMod=${j.pMod}`);
  check('闪避vs升龙(有架势)：玩家不掉血', j.pHp === 10, `pHp=${j.pHp}`);
  check('闪避vs升龙(有架势)：进入反击窗口', j.phase === 7 || j.phase === 8, `phase=${j.phase}`);
}
{
  let j = await single(D, [C], { p: 0, b: 0, randVal: 0.9 }); // 无架势→失败(30%)
  check('闪避vs升龙(无架势,失败)：攻击-1', j.pMod === -1, `pMod=${j.pMod}`);
  check('闪避vs升龙(无架势,失败)：玩家受升龙伤害(10→8)', j.pHp === 8, `pHp=${j.pHp}`);
  check('闪避vs升龙(无架势,失败)：架势不增不减(仍0)', j.pCharge === 0, `pCharge=${j.pCharge}`);
}
{
  let j = await single(D, [C], { p: 0, b: 0, randVal: 0.1 }); // 无架势→成功(30%)
  check('闪避vs升龙(无架势,成功)：不增长架势(仍0)', j.pCharge === 0, `pCharge=${j.pCharge}`);
  check('闪避vs升龙(无架势,成功)：攻击+1', j.pMod === 1, `pMod=${j.pMod}`);
  check('闪避vs升龙(无架势,成功)：不掉血', j.pHp === 10, `pHp=${j.pHp}`);
}

console.log('\n========== 二、闪避 vs 剪刀（核心） ==========');
{
  let j = await single(D, [S], { p: 3, b: 0 }); // 有架势必成
  check('闪避vs剪刀(有架势)：消耗1架势(3→2)', j.pCharge === 2, `pCharge=${j.pCharge}`);
  check('闪避vs剪刀(有架势)：攻击+1', j.pMod === 1, `pMod=${j.pMod}`);
  check('闪避vs剪刀(有架势)：不掉血', j.pHp === 10, `pHp=${j.pHp}`);
}
{
  let j = await single(D, [S], { p: 0, b: 0, randVal: 0.9 }); // 无架势→失败(30%)
  check('闪避vs剪刀(无架势,失败)：受剪刀伤害(10→9)', j.pHp === 9, `pHp=${j.pHp}`);
  check('闪避vs剪刀(无架势,失败)：攻击-1', j.pMod === -1, `pMod=${j.pMod}`);
  check('闪避vs剪刀(无架势,失败)：架势不增不减(仍0)', j.pCharge === 0, `pCharge=${j.pCharge}`);
}
{
  let j = await single(D, [S], { p: MAX, b: 0 }); // 架势已满
  check('闪避vs剪刀(架势已满)：消耗1架势(MAX→MAX-1)', j.pCharge === MAX - 1, `pCharge=${j.pCharge}`);
}

console.log('\n========== 三、Boss 闪避 vs 玩家剪刀（对称） ==========');
{
  let j = await single(S, [D], { p: 0, b: 2 }); // Boss有架势必成
  check('Boss闪避(有架势)：Boss消耗1架势(2→1)', j.bCharge === 1, `bCharge=${j.bCharge}`);
  check('Boss闪避(有架势)：Boss攻击+1', j.bMod === 1, `bMod=${j.bMod}`);
  check('Boss闪避成功：Boss不掉血', j.bHp === 20, `bHp=${j.bHp}`);
}
{
  let j = await single(S, [D], { p: 0, b: 0, randVal: 0.9 }); // Boss无架势→失败(30%)
  check('Boss闪避(无架势,失败)：Boss攻击-1', j.bMod === -1, `bMod=${j.bMod}`);
  check('Boss闪避(无架势,失败)：Boss受剪刀伤害(20→19)', j.bHp === 19, `bHp=${j.bHp}`);
  check('Boss闪避(无架势,失败)：Boss架势不增不减(仍0)', j.bCharge === 0, `bCharge=${j.bCharge}`);
}

console.log('\n========== 三B、玩家升龙 vs Boss 闪避（Boss 防守反击） ==========');
{
  let j = await single(C, [D], { p: 0, b: 2 }); // Boss有架势必躲 → 消耗1格 + 进入防守反击
  check('升龙vsBoss闪避(有架势)：Boss消耗1架势(2→1)', j.bCharge === 1, `bCharge=${j.bCharge}`);
  check('升龙vsBoss闪避(有架势)：判定为挥空(dodged)', j.dodged === true, `dodged=${j.dodged}`);
  check('升龙vsBoss闪避(有架势)：进入Boss防守反击窗口(phase=9)', j.phase === 9, `phase=${j.phase}`);
}
{
  let j = await single(C, [D], { p: 0, b: 0, randVal: 0.1 }); // Boss无架势→30%躲(0.1<0.3躲开)
  check('升龙vsBoss闪避(无架势,躲开)：判定为挥空(dodged)', j.dodged === true, `dodged=${j.dodged}`);
  check('升龙vsBoss闪避(无架势,躲开)：Boss不消耗架势(仍0)', j.bCharge === 0, `bCharge=${j.bCharge}`);
  check('升龙vsBoss闪避(无架势,躲开)：进入防守反击窗口', j.phase === 9, `phase=${j.phase}`);
}
{
  let j = await single(C, [D], { p: 0, b: 0, randVal: 0.9 }); // Boss无架势→30%躲(0.9>0.3未躲) → 玩家升龙命中
  check('升龙vsBoss闪避(无架势,未躲)：玩家升龙命中Boss', j.dodged === false, `dodged=${j.dodged}`);
  check('升龙vsBoss闪避(无架势,未躲)：Boss受升龙伤害(20→18)', j.bhp === 18, `bhp=${j.bhp}`);
}
{
  // Boss 防守反击窗口内：玩家按空格/1(石头)/4(闪避)化解 → 无伤
  await page.evaluate(() => {
    window.__play.startGame();
    window.__play.setCharges({ p: 0, b: 1 });
    window.__play.setRandom(function () { return 0.9; });
    window.__play.setBossMoves([3]);
    window.__play.forceSelectLen(2, 1);
  });
  await page.waitForFunction(() => window.__game().phase === 9, { timeout: 5000 });
  await page.keyboard.press(' ');   // 空格 = 化解（等价于做闪避/石头防御）
  let blocked = false, pHpFinal = -1;
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    const st = await page.evaluate(() => { const g = window.__game(); return { phase: g.phase, hp: g.player ? g.player.hp : 0, last: window.__lastJudge || {} }; });
    if (st.last && st.last.retaliate === 'blocked') blocked = true;
    if (st.phase !== 9) { pHpFinal = st.hp; break; }
    await page.waitForTimeout(120);
  }
  check('Boss防守反击：玩家化解成功 → 无伤', blocked === true && pHpFinal === 10, `blocked=${blocked} pHpFinal=${pHpFinal}`);
  await page.evaluate(() => window.__play.setRandom(null));
}
{
  // Boss 防守反击窗口内：玩家不做化解 → 超时被 Boss 反击命中 -2 血（实时模式、无手势输入）
  await page.evaluate(() => {
    window.__play.startGame();
    window.__play.setCharges({ p: 0, b: 1 });
    window.__play.setRandom(function () { return 0.9; });
    window.__play.setBossMoves([3]);
    window.__play.setDemo(false); // 实时模式：玩家无手势 → 不会化解 → 超时被命中
    window.__play.forceSelectLen(2, 1);
  });
  await page.waitForFunction(() => window.__game().phase === 9, { timeout: 5000 });
  let hit = false, pHpFinal2 = -1;
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    const st = await page.evaluate(() => { const g = window.__game(); return { phase: g.phase, hp: g.player ? g.player.hp : 0, last: window.__lastJudge || {} }; });
    if (st.last && st.last.retaliate === 'hit') hit = true;
    if (st.phase !== 9) { pHpFinal2 = st.hp; break; }
    await page.waitForTimeout(120);
  }
  check('Boss防守反击(未化解)：被反击命中 → 玩家 -2 血(10→8)', hit === true && pHpFinal2 === 8, `hit=${hit} pHpFinal=${pHpFinal2}`);
  await page.evaluate(() => window.__play.setRandom(null));
  await page.evaluate(() => window.__play.setDemo(false));
}

console.log('\n========== 四、架势累积（剪刀打到石头） ==========');
{
  let j = await single(S, [R]); // 玩家剪刀 vs Boss石头 → Boss 石头防御成功 → Boss架势+1
  check('Boss石头防御玩家剪刀：Boss架势+1(0→1)', j.b === 1 && j.p === 0, `p=${j.p} b=${j.b}`);
}
{
  let j = await single(R, [S]); // 玩家石头 vs Boss剪刀 → 玩家石头防御成功 → 玩家架势+1
  check('玩家石头防御Boss剪刀：玩家架势+1(0→1)', j.p === 1 && j.b === 0, `p=${j.p} b=${j.b}`);
}

console.log('\n========== 五、Boss 升龙命中消耗 Boss 架势（对称） ==========');
{
  let j = await single(R, [C], { p: 0, b: 2 }); // 玩家石头 vs Boss升龙 → Boss升龙命中
  check('Boss升龙命中：消耗全部Boss架势(2→0)', j.b === 0, `b=${j.b}`);
  check('Boss升龙命中：玩家受4伤害(2+2架势)', j.hp === 6, `hp=${j.hp}`);
}

console.log('\n========== 六、多段连招的架势累积节奏（不限速验证） ==========');
{
  // 5段剪刀 vs 5段石头：Boss 石头连续防御成功，验证「每段克制成功都 +1 架势」（新规则，不限速）
  await page.evaluate(() => {
    window.__play.startGame();
    window.__play.setCharges({ p: 0, b: 0 });
    window.__play.setBossMoves([0,0,0,0,0]);
    window.__play.forceSelect(1);
  });
  let lastB = -1;
  let timedOut = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    const c = await page.evaluate(() => window.__play.getCharges());
    if (c.b !== lastB) { observe(`Boss架势`, `${lastB}→${c.b}`); lastB = c.b; }
    if (lastB >= 5) break;
    await page.waitForTimeout(60);
  }
  if (lastB < 5) timedOut = true;
  check('多段连招：一套剪刀连招Boss架势累积 5 段 +1（0→5）', !timedOut && lastB === 5, `lastB=${lastB}`);
}

console.log('\n========== 七、10 轮完整对局回归（AI 自动对战） ==========');
{
  const loopErrs = [];
  for (let r = 1; r <= 10; r++) {
    await page.evaluate(() => { window.__play.startGame(); });
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
  check('10轮完整对局：无 JS 异常 / 血量异常', loopErrs.length === 0, loopErrs.join(' | '));
}

console.log('\n========== PLAYTEST 汇总 ==========');
console.log(`通过: ${results.passed.length}  |  失败: ${results.failed.length}`);
results.failed.forEach(f => console.log(`  ❌ ${f.name}  ${f.detail}`));
await browser.close(); server.close();
process.exit(results.failed.length ? 1 : 0);
