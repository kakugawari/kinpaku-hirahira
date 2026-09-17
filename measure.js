/* 実機相当(iPhone 16 Plus)で「上手に蒔いたときのこぼれ」を測る。
   型を足したら、この値を core.js の REACHED に入れること。

   打ち方は自動で何通りも試し、「埋まり 70% 以上(= 名人の条件)を
   満たしたうちで、いちばんこぼれが少なかった回」を採る。
   下手な打ち方(型の上を端から端まで振る)も一緒に流して、
   上手な方との差が出ていることを確かめる。 */
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const PORT = Number(process.env.PORT || 8126);
const URL = 'http://localhost:' + PORT + '/';
const CHROME = process.env.CHROMIUM_PATH || '';   // 手元の Chromium を使いたいとき
const 回数 = Number(process.env.ROUNDS || 2);

/* なぞる打ち方の組み合わせ(振り幅 x 型の上どれだけから) */
const なぞり = [];
for (const 振り of [0.2, 0.35, 0.5]) for (const 上 of [10, 40, 80]) なぞり.push({ 振り, 上 });

async function 落ち切るまで(p) {
  await p.waitForFunction(() => window.__app.flakes.length === 0, null, { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(900);
}

async function 手順を組む(p, 打ち方) {
  return p.evaluate(({ 打ち方 }) => {
    const A = window.__app, o = A.odai, b = o.bounds;
    const MIN = A.SETTLE_MIN, SPAN = A.SETTLE_SPAN;
    const 幅 = b.right - b.left;
    const out = [];

    if (打ち方.種 === '下手') {
      const y = b.top - MIN - SPAN * 0.5;
      for (let k = 0; k < 24; k++) {
        const t = k / 23;
        out.push({ x: b.left + 幅 * (k % 2 ? 1 - t : t), y, 重み: 1 });
      }
      return out;
    }

    if (打ち方.種 === 'なぞり') {
      const y = b.top - 打ち方.上;
      const cx = (b.left + b.right) / 2, 振り = 幅 * 打ち方.振り;
      for (let k = 0; k < 24; k++) {
        const t = k / 23;
        out.push({ x: cx + 振り * (k % 2 ? 1 - 2 * t : 2 * t - 1), y, 重み: 1 });
      }
      return out;
    }

    /* 狙い置き:候補を格子に並べ、そこから落ちた箔が内側に入る割合を数えて、
       見込みの高い所だけに置く。横の散らばりは片側およそ 42px */
    const 散り = 42;
    const 見込み = (sx, sy) => {
      let 中 = 0, 計 = 0;
      for (let j = 0; j < 20; j++) {
        const d = MIN + SPAN * ((j + 0.5) / 20);
        for (let k = 0; k < 9; k++) {
          const u = (k + 0.5) / 9 * 2 - 1;
          const w = 1 - Math.abs(u);
          計 += w;
          if (A.isInsideShape(sx + u * 散り, sy + d)) 中 += w;
        }
      }
      return 中 / 計;
    };
    const 刻み = Math.max(10, 幅 / 22);
    const 候補 = [];
    for (let x = b.left - 散り; x <= b.right + 散り; x += 刻み) {
      for (let y = b.top - MIN - SPAN; y <= b.bottom - MIN; y += 刻み) {
        const v = 見込み(x, y);
        if (v > 0.05) 候補.push({ x, y, v });
      }
    }
    if (!候補.length) return [{ x: (b.left + b.right) / 2, y: b.top - MIN - SPAN * 0.5, 重み: 1 }];
    const 最良 = Math.max(...候補.map((c) => c.v));
    const 選 = 候補.filter((c) => c.v >= 最良 * 打ち方.しきい).sort((a, c) => a.x - c.x || a.y - c.y);
    /* どこも同じだけ置く。見込みで重みを付けると良い所に集まりすぎて、
       こぼれは減るが埋まりが伸びない */
    return 選.map((c) => ({ x: c.x, y: c.y, 重み: 1 }));
  }, { 打ち方 });
}

async function 測る(p, i, 打ち方) {
  await p.evaluate((k) => window.__app.startShape(k), i);
  await p.waitForTimeout(200);
  const g = await p.evaluate(() => ({ budget: window.__app.odai.budgetMax }));
  const 手順 = await 手順を組む(p, 打ち方);
  const 全体ms = (g.budget / 180) * 1000 * 1.3;
  const ms = Math.max(20, Math.round(全体ms / 手順.length));
  for (let k = 0; k < 手順.length; k++) {
    await p.mouse.move(手順[k].x, 手順[k].y);
    await p.mouse.down();
    await p.waitForTimeout(ms);
    await p.mouse.up();
    if (k % 4 === 3 && (await p.evaluate(() => window.__app.odai.budget)) <= 0) break;
  }
  await 落ち切るまで(p);
  return p.evaluate(() => {
    const o = window.__app.odai, 計 = o.inW + o.outW;
    return { spill: 計 > 0 ? o.outW / 計 : 1,
             fill: o.zoneSet.size ? o.zoneHit.size / o.zoneSet.size : 0 };
  });
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(PORT)], { stdio: 'ignore' });
  process.on('exit', () => server.kill());
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const ctx = await b.newContext({ ...(devices['iPhone 16 Plus'] || devices['iPhone 15 Plus']) });
  const p = await ctx.newPage();
  await p.goto(URL);
  await p.waitForSelector('#title-screen');
  await p.click('#title-screen');
  await p.waitForTimeout(500);
  await p.bringToFront();

  const 型 = await p.evaluate(() => window.__app.SHAPES.map((s) => ({ name: s.name, spillMax: s.spillMax })));
  const 表 = {};
  for (let i = 0; i < 型.length; i++) {
    const 上手 = [], 下手 = [];
    for (let r = 0; r < 回数; r++) {
      下手.push(await 測る(p, i, { 種: '下手' }));
      for (const n of なぞり) 上手.push(await 測る(p, i, { 種: 'なぞり', ...n }));
      for (const しきい of [0.8, 0.92]) 上手.push(await 測る(p, i, { 種: '狙い置き', しきい }));
    }
    const 名人候補 = 上手.filter((x) => x.fill >= 0.70);
    const 使う = 名人候補.length ? 名人候補 : 上手;
    const spills = 使う.map((x) => x.spill * 100).sort((a, c) => a - c);
    const 最良 = spills[0];
    表[型[i].name] = Math.round(最良);
    console.log(
      `${型[i].name}\t最良 ${Math.round(最良)}%  (2番目 ${Math.round(spills[1])}% / 3番目 ${Math.round(spills[2])}%)` +
      `\t許し ${Math.round(型[i].spillMax * 100)}%\t下手 ${下手.map((x) => Math.round(x.spill * 100)).join('/')}%` +
      `\t埋70到達 ${名人候補.length}/${上手.length}`);
  }
  console.log('\nREACHED = ' + JSON.stringify(表));
  await b.close();
  server.kill();
})();
