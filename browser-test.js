/*
 * ブラウザで実際に動かして確かめるテスト。
 *
 *   npm i -D playwright && npm run test:ui
 *
 * 画面まわりの不具合はロジックのテストでは捕まらない。ここでは本物の
 * ブラウザを立ち上げ、指の操作をそのまま再現して確かめる。
 *
 * ★ 直した不具合には、かならず見張り役をここに置くこと。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const PORT = Number(process.env.PORT || 8124);
const URL = `http://localhost:${PORT}/`;
const ROOT = __dirname;
const CHROMIUM = process.env.CHROMIUM_PATH;   // 手元の Chromium を使いたいとき

let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + message);
  } else {
    failed++;
    console.log('  \x1b[31m✗ FAIL\x1b[0m ' + message);
  }
}

function section(name) {
  console.log('\n' + name);
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http.get(URL, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - started > 10000) reject(new Error('サーバーが起動しない'));
          else setTimeout(tick, 100);
        });
    };
    tick();
  });
}

/**
 * 画面の一部にある「箔の画素」を数える。
 * 漆黒の背景に対して、赤が強く青が弱い画素を箔とみなす。
 *
 * @param {object} box 論理座標 { x0, y0, x1, y1 }
 * @returns {Promise<number>}
 */
function countFlakes(page, box) {
  return page.evaluate((b) => {
    const cv = document.getElementById('cv');
    const c = cv.getContext('2d');
    const s = cv.width / window.innerWidth;           // 論理 → 実画素
    const x = Math.round(b.x0 * s);
    const y = Math.round(b.y0 * s);
    const w = Math.round((b.x1 - b.x0) * s);
    const h = Math.round((b.y1 - b.y0) * s);
    const d = c.getImageData(x, y, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 120 && d[i] > d[i + 2] + 30) n++;
    }
    return n;
  }, box);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  let chromium;
  let devices;
  try {
    ({ chromium, devices } = require('playwright'));
  } catch (e) {
    console.error('playwright が必要です:  npm i -D playwright');
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(PORT)], {
    stdio: 'ignore'
  });
  await waitForServer();

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  try {
    // ------------------------------------------------ まず開く
    section('スマホで開く');
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const phone = await context.newPage();
    phone.on('pageerror', (e) => errors.push('スマホ: ' + e.message));
    phone.on('console', (m) => { if (m.type() === 'error') errors.push('スマホ: ' + m.text()); });
    await phone.goto(URL);
    await phone.waitForTimeout(500);

    const size = await phone.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    ok(size.w > 0 && size.h > 0, `画面が立ち上がる (${size.w}x${size.h})`);

    // ------------------------------------------------ 蒔ける
    section('金箔を蒔く');
    await phone.mouse.move(size.w / 2, size.h * 0.35);
    await phone.mouse.down();
    await phone.waitForTimeout(150);
    await phone.mouse.up();
    await phone.waitForTimeout(1500);
    const sown = await countFlakes(phone, { x0: 0, y0: 0, x1: size.w, y1: size.h });
    ok(sown > 200, `触れると箔が積もる (${sown} 画素)`);
    ok(await phone.evaluate(() => document.getElementById('hint').classList.contains('hidden')),
      '触れると案内文が消える');

    /* ------------------------------------------------------------------
       見張り ①: 指が下部の操作帯に載っても、箔は指のところに撒かれる

       setPointerCapture で指を捕まえていないと、指が操作帯に載った瞬間に
       pointermove が canvas へ届かなくなり、pointer.down だけ true のまま
       「最後に canvas で見た位置」へ撒き続ける。お題モードではこれで
       ひと匙(300枚)が1秒で溶けて、勝手に採点まで進んでしまう。

       左下から操作帯へ入り、そのまま帯の上を右へなぞる。捕まえていれば
       箔は右へついてくる。捕まえていないと左に貼り付いたままになる。
       ------------------------------------------------------------------ */
    section('指が操作帯に載っても追ってくる (見張り①)');
    const ctx2 = await browser.newContext({ ...devices['iPhone 13'] });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => errors.push('見張り①: ' + e.message));
    await p2.goto(URL);
    await p2.waitForTimeout(500);

    const barY = size.h - 12;              // 操作帯のまんなかあたり
    await p2.mouse.move(size.w * 0.15, size.h - 120);
    await p2.mouse.down();
    await p2.waitForTimeout(80);
    await p2.mouse.move(size.w * 0.15, barY, { steps: 3 });   // 操作帯へ入る
    await p2.waitForTimeout(80);
    await p2.mouse.move(size.w * 0.85, barY, { steps: 12 });  // 帯の上を右へ
    await p2.waitForTimeout(400);
    await p2.mouse.up();
    await p2.waitForTimeout(1800);

    const band = { y0: size.h - 220, y1: size.h };
    const left  = await countFlakes(p2, { x0: 0,          y0: band.y0, x1: size.w / 2, y1: band.y1 });
    const right = await countFlakes(p2, { x0: size.w / 2, y0: band.y0, x1: size.w,     y1: band.y1 });
    ok(right > left * 0.25 && right > 300,
      `操作帯の上をなぞると箔が指を追う (左 ${left} 画素 / 右 ${right} 画素)`);

    // 捕まえても、操作帯のボタンはちゃんと押せる
    await p2.click('#btn-odai');
    await p2.waitForTimeout(300);
    ok(await p2.evaluate(() => document.getElementById('odai-hud').classList.contains('show')),
      '指を捕まえても「お題」ボタンは押せる');
    await p2.click('#sw-silver');
    ok(await p2.evaluate(() => document.getElementById('sw-silver').classList.contains('active')),
      '指を捕まえても色は選べる');
    await ctx2.close();

    // ------------------------------------------------ お題モード
    section('お題モード');
    await phone.click('#btn-odai');
    await phone.waitForTimeout(1800);
    const odai = await phone.evaluate(() => ({
      shown: document.getElementById('odai-hud').classList.contains('show'),
      name: document.getElementById('odai-name').textContent,
      btn: document.getElementById('btn-odai').textContent
    }));
    ok(odai.shown && /に蒔く$/.test(odai.name), `お題が出る (${odai.name})`);
    ok(odai.btn === '自由へ', 'ボタンの文字が「自由へ」に変わる');

    // ひと匙を使い切ると採点まで進む
    await phone.mouse.move(size.w / 2, size.h * 0.22);
    await phone.mouse.down();
    for (let i = 0; i < 60; i++) {
      await phone.mouse.move(size.w / 2 + Math.sin(i / 4) * 50, size.h * 0.22 + Math.cos(i / 5) * 30);
      await sleep(12);
    }
    await phone.mouse.up();
    let judged = false;
    for (let i = 0; i < 60; i++) {
      await phone.waitForTimeout(250);
      if (await phone.evaluate(() => document.getElementById('result').classList.contains('show'))) {
        judged = true;
        break;
      }
    }
    const detail = await phone.textContent('#result-detail');
    ok(judged, `ひと匙を使い切ると採点が出る (${detail})`);
    await phone.click('#btn-free');
    ok(await phone.evaluate(() => !document.getElementById('odai-hud').classList.contains('show')),
      '「自由に戻る」で抜けられる');

    /* ------------------------------------------------------------------
       見張り ③: 起動してすぐ「お題」を押しても、案内文が型に重ならない

       案内文はキャンバスに触れたときにしか消えなかったため、ボタンから
       お題に入ると『触れて蒔き はらいて風』が型の真ん中に乗っていた。
       ------------------------------------------------------------------ */
    section('案内文が型に重ならない (見張り③)');
    const ctx3 = await browser.newContext({ ...devices['iPhone 13'] });
    const p3 = await ctx3.newPage();
    p3.on('pageerror', (e) => errors.push('見張り③: ' + e.message));
    await p3.goto(URL);
    await p3.waitForTimeout(500);
    ok(!(await p3.evaluate(() => document.getElementById('hint').classList.contains('hidden'))),
      '起動直後は案内文が出ている');
    await p3.click('#btn-odai');           // キャンバスには一度も触れずにお題へ
    await p3.waitForTimeout(400);
    ok(await p3.evaluate(() => document.getElementById('hint').classList.contains('hidden')),
      'キャンバスに触れずにお題へ入っても案内文が消える');

    /* ------------------------------------------------------------------
       見張り ④: 結果パネルが画面幅の半分に潰れない

       position:fixed + left:50% だけだと、幅を決める余地が画面の右半分しか
       残らず、評価もボタンも縦に割れていた。
       ------------------------------------------------------------------ */
    section('結果パネルが潰れない (見張り④)');
    for (const [vw, vh, label] of [[390, 844, 'iPhone 13'], [320, 568, '小さい端末']]) {
      const ctxP = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2 });
      const pp = await ctxP.newPage();
      pp.on('pageerror', (e) => errors.push('見張り④: ' + e.message));
      await pp.goto(URL);
      await pp.waitForTimeout(400);
      const m = await pp.evaluate(() => {
        const el = document.getElementById('result');
        el.classList.add('show');
        document.getElementById('result-rank').textContent = '見習い';
        document.getElementById('result-detail').textContent = '埋まり 57% ・ こぼれ 53%';
        document.getElementById('result-word').textContent = '風を読み、少し上から漂わせてみましょう';
        const box = el.getBoundingClientRect();
        const lines = (id) => {
          const e = document.getElementById(id);
          const cs = getComputedStyle(e);
          const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
          return Math.round(e.getBoundingClientRect().height / lh);
        };
        return {
          w: Math.round(box.width),
          rank: lines('result-rank'),
          detail: lines('result-detail'),
          はみ出し: box.left < 0 || box.right > innerWidth || box.top < 0 || box.bottom > innerHeight,
          ボタン: (() => {
            const btns = [...document.querySelectorAll('#result-buttons .btn')];
            const boxes = btns.map((e) => e.getBoundingClientRect());
            const 横並び = Math.abs(boxes[0].top - boxes[1].top) < 2 && boxes[0].right <= boxes[1].left + 1;
            /* 文字が縦に割れていないか: 高さが1行ぶんに収まっているか見る */
            const 一行 = btns.every((e) => {
              const cs = getComputedStyle(e);
              const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
              const 中身 = e.getBoundingClientRect().height
                - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
                - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
              return Math.round(中身 / lh) <= 1;
            });
            return { 横並び, 一行 };
          })()
        };
      });
      ok(m.rank === 1, `${label}: 評価が1行に収まる (パネル幅 ${m.w}px / 画面 ${vw}px)`);
      ok(m.detail === 1, `${label}: 「埋まり・こぼれ」が1行に収まる`);
      ok(m.ボタン.横並び && m.ボタン.一行, `${label}: ボタンの文字が縦に割れず横に並ぶ`);
      ok(!m.はみ出し, `${label}: パネルが画面からはみ出さない`);
      await ctxP.close();
    }
    await ctx3.close();

    /* ------------------------------------------------------------------
       見張り ⑤: 『三日月』の型に、ちゃんと欠けがある

       内弧を外側へ膨らませていたため、削るどころか面積を足してしまい、
       三日月ではなく木の葉(レンズ)の形になっていた。
       型の中央の高さを横に走査し、外円の右寄りが「外」になることを見る。
       ------------------------------------------------------------------ */
    section('『三日月』が欠けている (見張り⑤)');
    const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const pm = await ctxM.newPage();
    pm.on('pageerror', (e) => errors.push('見張り⑤: ' + e.message));
    await pm.goto(URL);
    await pm.waitForFunction(() => window.__app);
    const moon = await pm.evaluate(() => {
      /* アプリが実際に採点へ使う型そのものを測る */
      const names = window.__app.SHAPES.map((s) => s.name);
      const idx = names.indexOf('三日月');
      window.__app.useShape(idx);
      const s = Math.min(innerWidth, innerHeight) * 0.32;
      const cx = innerWidth / 2, cy = innerHeight * 0.42;
      const inside = (ux) => window.__app.isInsideShape(cx + ux * s, cy);
      let 左端 = null, 右端 = null, 内側の幅 = 0;
      for (let ux = -2; ux <= 4; ux += 0.01) {
        if (inside(ux)) {
          if (左端 === null) 左端 = +ux.toFixed(2);
          右端 = +ux.toFixed(2);
          内側の幅 += 0.01;
        }
      }
      return { 名前: names[idx], 左端, 右端, 内側の幅: +内側の幅.toFixed(2),
               中心ずれ: +((左端 + 右端) / 2).toFixed(2) };
    });
    // 三日月なら、中央の高さの「肉」は外円の直径よりずっと細い。
    // レンズ形(直す前)だと -0.3〜1.0 = 1.3 になる。
    ok(moon.内側の幅 < 0.8,
      `中央の高さで型が細い = 欠けている (${moon.名前}: 肉の厚み ${moon.内側の幅} / 左端 ${moon.左端} 右端 ${moon.右端})`);
    ok(moon.右端 - moon.左端 < 0.8,
      `欠けが外円の内側に入っている (左端 ${moon.左端} 右端 ${moon.右端})`);
    ok(Math.abs(moon.中心ずれ) < 0.06,
      `型が画面の中央に来ている (中心ずれ ${moon.中心ずれ})`);
    await ctxM.close();

    // ------------------------------------------------ アイコン
    section('アイコン');
    const apple = await phone.evaluate(() =>
      document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'));
    // iOS は SVG のアイコンを使えない
    ok(!!apple && apple.endsWith('.png'), `ホーム画面用アイコンが PNG (${apple})`);

    /* ------------------------------------------------------------------
       見張り ②: 直したものが 1 回のリロードで出る

       サービスワーカーがキャッシュ優先だと、配り直しても古い画面が出続ける。
       HTML だけはネットワーク優先にしてあること。
       ------------------------------------------------------------------ */
    section('更新とオフライン (見張り②)');
    const swCtx = await browser.newContext({ ...devices['iPhone 13'] });
    const swPage = await swCtx.newPage();
    swPage.on('pageerror', (e) => errors.push('更新: ' + e.message));
    await swPage.goto(URL);
    await swPage.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
    ok(true, 'サービスワーカーが動く');

    const indexPath = path.join(ROOT, 'index.html');
    const original = fs.readFileSync(indexPath, 'utf8');
    const OLD_TITLE = '<div id="title">金箔ひらひら</div>';
    const NEW_TITLE = '<div id="title">こうしんかくにん</div>';
    if (!original.includes(OLD_TITLE)) throw new Error('題字の目印が見つからない');

    let title = '';
    try {
      fs.writeFileSync(indexPath, original.replace(OLD_TITLE, NEW_TITLE));
      await swPage.reload();
      await swPage.waitForTimeout(500);
      title = (await swPage.textContent('#title')).trim();
    } finally {
      fs.writeFileSync(indexPath, original);   // かならず元へ戻す
    }
    ok(title === 'こうしんかくにん', `直したものが 1 回のリロードで出る (題字: ${title})`);

    await swPage.reload();
    await swPage.waitForTimeout(600);
    await swCtx.setOffline(true);
    await swPage.reload().catch(() => {});
    await swPage.waitForTimeout(500);
    ok(await swPage.evaluate(() => !!document.getElementById('cv')).catch(() => false),
      'ネットにつながらなくても開ける');
    await swCtx.setOffline(false);
    await swCtx.close();

    section('エラー');
    ok(errors.length === 0, errors.length ? '画面のエラー: ' + errors.join(' / ') : 'JS エラーなし');
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} 件合格 / ${failed} 件失敗`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
