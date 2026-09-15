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
