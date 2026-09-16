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

/* このアプリが向き合う端末は iPhone 16 Plus ひとつ。
   幅 430pt / DPR 3。Safari で開いたときの高さは 739pt。
   すべての確認をこの一台に合わせる */
const PHONE = 'iPhone 16 Plus';

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

  const V = devices[PHONE].viewport;          // 430 x 739
  const CX = Math.round(V.width / 2);        // 画面の横のまんなか

  const server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(PORT)], {
    stdio: 'ignore'
  });
  await waitForServer();

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  try {
    // ------------------------------------------------ まず開く
    section('スマホで開く');
    const context = await browser.newContext({ ...devices[PHONE] });
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
    const ctx2 = await browser.newContext({ ...devices[PHONE] });
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
    const ctx3 = await browser.newContext({ ...devices[PHONE] });
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
    for (const [label] of [[PHONE]]) {
      const ctxP = await browser.newContext({ ...devices[PHONE] });
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
        document.getElementById('result-limit').textContent = 'この型は こぼれ 38% まで';
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
          limit: lines('result-limit'),
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
      ok(m.rank === 1, `${label}: 評価が1行に収まる (パネル幅 ${m.w}px)`);
      ok(m.detail === 1, `${label}: 「埋まり・こぼれ」が1行に収まる`);
      ok(m.limit === 1, `${label}: こぼれの許容が1行に収まる`);
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
    const ctxM = await browser.newContext({ ...devices[PHONE] });
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
      /* 型ぜんたいが画面の中央に置かれているかは、枠の中心で見る。
         三日月は真ん中の高さの断面が左右非対称なので、断面では測れない */
      let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
      for (const [x, y] of window.__app.SHAPES[idx].points) {
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
        if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
      return { 名前: names[idx], 左端, 右端, 内側の幅: +内側の幅.toFixed(2),
               へこみ: +window.__app.Core.concavity(window.__app.SHAPES[idx].points).toFixed(3),
               枠の中心: [+((bx0 + bx1) / 2).toFixed(3), +((by0 + by1) / 2).toFixed(3)] };
    });
    // 三日月なら、中央の高さの「肉」は外円の直径よりずっと細い。
    // レンズ形(直す前)だと -0.3〜1.0 = 1.3 になる。
    /* 内弧を逆向きに描くとレンズ形になり、へこみが消える。
       細さで見ると月を太らせただけで落ちるので、へこみで見る */
    ok(moon.へこみ < 0.92,
      `${moon.名前}に欠けがある (へこみ ${moon.へこみ} / 肉の厚み ${moon.内側の幅})`);
    ok(moon.左端 < 0 && moon.右端 > 0,
      `型が画面のまんなかをまたいでいる (左端 ${moon.左端} 右端 ${moon.右端})`);
    ok(Math.abs(moon.枠の中心[0]) < 0.01 && Math.abs(moon.枠の中心[1]) < 0.01,
      `型が画面の中央に置かれている (枠の中心 ${moon.枠の中心.join(', ')})`);
    await ctxM.close();

    /* ------------------------------------------------------------------
       見張り ⑥: 背景が真っ黒で、どこを取っても同じ

       もとは中央が温かい放射グラデーション + 斜めの艶が乗っていた。
       箔を際立たせるため真っ黒で固定した。画面のあちこちを拾って、
       すべて #000 かつ全部同色であることを見る。
       ------------------------------------------------------------------ */
    section('背景が真っ黒で固定 (見張り⑥)');
    const ctxB = await browser.newContext({ ...devices[PHONE] });
    const pb = await ctxB.newPage();
    pb.on('pageerror', (e) => errors.push('見張り⑥: ' + e.message));
    await pb.goto(URL);
    await pb.waitForTimeout(600);
    const bg = await pb.evaluate(() => {
      const cv = document.getElementById('cv');
      const c = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      /* 中央・四隅・斜めの艶が乗っていた帯、をまんべんなく拾う */
      const pts = [
        [W / 2, H * 0.42], [2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3],
        [W / 2, 2], [W / 4, H / 4], [W * 0.45, H * 0.45], [W * 0.65, H * 0.65],
      ];
      const seen = pts.map(([x, y]) => {
        const d = c.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return `${d[0]},${d[1]},${d[2]}`;
      });
      return { 色: [...new Set(seen)], 見た点数: pts.length };
    });
    ok(bg.色.length === 1,
      `どこを取っても同じ色 (${bg.見た点数}点で ${bg.色.length}種: ${bg.色.join(' / ')})`);
    ok(bg.色[0] === '0,0,0', `背景が真っ黒 (${bg.色[0]})`);
    const themed = await pb.evaluate(() => ({
      meta: document.querySelector('meta[name="theme-color"]').content.toLowerCase(),
      body: getComputedStyle(document.body).backgroundColor,
    }));
    ok(themed.meta === '#000000', `theme-color も黒 (${themed.meta})`);
    ok(themed.body === 'rgb(0, 0, 0)', `body の地色も黒 (${themed.body})`);
    const mf = await (await pb.request.get(URL + 'manifest.json')).json();
    ok(mf.background_color === '#000000' && mf.theme_color === '#000000',
      `manifest の地色も黒 (背景 ${mf.background_color} / テーマ ${mf.theme_color})`);
    await ctxB.close();

    /* ------------------------------------------------------------------
       見張り ⑦: 型ごとに、ひと匙と難易度が形から決まっている
       ------------------------------------------------------------------ */
    section('型ごとのひと匙と難易度 (見張り⑦)');
    const ctxS = await browser.newContext({ ...devices[PHONE] });
    const ps = await ctxS.newPage();
    ps.on('pageerror', (e) => errors.push('見張り⑦: ' + e.message));
    await ps.goto(URL);
    await ps.waitForFunction(() => window.__app);
    const shapes = await ps.evaluate(() => window.__app.SHAPES.map((s) => ({
      name: s.name, area: s.area, budget: s.budget, difficulty: s.difficulty, spillMax: s.spillMax,
    })));
    ok(shapes.length >= 8, `型が ${shapes.length} 種ある`);
    ok(new Set(shapes.map((s) => s.name)).size === shapes.length, '型の名前が重複していない');
    const byArea = [...shapes].sort((a, b) => a.area - b.area);
    ok(byArea.every((s, i) => i === 0 || s.budget >= byArea[i - 1].budget),
      '広い型ほどひと匙が多い');
    ok(shapes.every((s) => s.difficulty >= 1 && s.difficulty <= 5),
      `難易度が1〜5に収まる (${shapes.map((s) => s.name + s.difficulty).join(' ')})`);

    // お題に入ると、その型のひと匙が使われる
    await ps.click('#btn-odai');
    await ps.waitForTimeout(2000);
    const hud = await ps.evaluate(() => {
      const i = window.__app.odai.shapeIdx;
      return {
        budgetMax: window.__app.odai.budgetMax,
        shapeBudget: window.__app.SHAPES[i].budget,
        level: document.getElementById('odai-level').textContent,
        label: document.getElementById('odai-gauge-label').textContent,
      };
    });
    ok(hud.budgetMax === hud.shapeBudget,
      `その型のひと匙が使われる (${hud.budgetMax}枚)`);
    ok(/^◆+◇*$/.test(hud.level) && hud.level.length === 5, `難易度が出る (${hud.level})`);
    ok(/ひと匙 \d+枚/.test(hud.label), `ひと匙の枚数が出る (${hud.label})`);
    await ctxS.close();

    /* ------------------------------------------------------------------
       見張り ⑧: 記録が残り、開き直しても消えない
       ------------------------------------------------------------------ */
    section('記録が残る (見張り⑧)');
    const ctxR = await browser.newContext({ ...devices[PHONE] });
    const pr = await ctxR.newPage();
    pr.on('pageerror', (e) => errors.push('見張り⑧: ' + e.message));
    await pr.goto(URL);
    await pr.waitForFunction(() => window.__app);
    ok(await pr.evaluate(() => window.__app.records.rounds === 0), 'はじめは記録が空');

    // 名人を1つ積んで、開き直しても残っているか
    await pr.evaluate(() => {
      const C = window.__app.Core;
      let r = C.emptyRecords();
      r = C.applyResult(r, window.__app.SHAPES[0].name, { rank: '名人', fill: 0.9, spill: 0.1 });
      window.__app.setRecords(r);
    });
    await pr.reload();
    await pr.waitForFunction(() => window.__app);
    const kept = await pr.evaluate(() => ({
      rounds: window.__app.records.rounds,
      best: window.__app.records.best[window.__app.SHAPES[0].name],
      grade: window.__app.Core.grade(window.__app.records, window.__app.SHAPES.length).name,
    }));
    ok(kept.rounds === 1 && kept.best && kept.best.rank === '名人',
      `開き直しても記録が残る (${kept.best && kept.best.rank})`);
    ok(kept.grade !== '無位', `段位が上がる (${kept.grade})`);

    // 記録の帳が開き、型が全部並ぶ
    await pr.click('#btn-book');
    await pr.waitForTimeout(300);
    const book = await pr.evaluate(() => ({
      shown: document.getElementById('book').classList.contains('show'),
      rows: document.querySelectorAll('#book-table tr').length,
      grade: document.getElementById('book-grade').textContent,
      はみ出し: (() => {
        const b = document.getElementById('book').getBoundingClientRect();
        return b.left < 0 || b.right > innerWidth;
      })(),
    }));
    ok(book.shown && book.rows === shapes.length,
      `記録の帳に型が全部並ぶ (${book.rows}行 / 段位 ${book.grade})`);
    ok(!book.はみ出し, '記録の帳が画面からはみ出さない');

    // 壊れた記録が入っていても開ける
    await pr.evaluate(() => localStorage.setItem('kinpaku-records-v1', '{こわれた'));
    await pr.reload();
    await pr.waitForFunction(() => window.__app);
    ok(await pr.evaluate(() => window.__app.records.rounds === 0),
      '記録が壊れていても、空から始めて遊べる');
    await ctxR.close();

    /* ------------------------------------------------------------------
       見張り ⑩: 払うと、そのあたりの箔だけがずれる

       もとは画面じゅうの箔がいっせいに飛んでいってしまい、細かい直しに
       使えなかった。指の通り道のそばだけが、なぞった向きへずれること、
       離れた場所は1枚も動かないこと、総数が減らない(飛んでいかない)ことを見る。
       ------------------------------------------------------------------ */
    section('払うとそのあたりだけずれる (見張り⑩)');
    const ctxW = await browser.newContext({ ...devices[PHONE] });
    const pw = await ctxW.newPage();
    pw.on('pageerror', (e) => errors.push('見張り⑩: ' + e.message));
    await pw.goto(URL);
    await pw.waitForFunction(() => window.__app);

    // 上と下、離れた二か所に蒔く
    const 蒔く高さ = [Math.round(V.height * 0.25), Math.round(V.height * 0.72)];
    for (const y of 蒔く高さ) {
      await pw.mouse.move(CX, y);
      await pw.mouse.down();
      for (let i = 0; i < 24; i++) { await pw.mouse.move(CX + Math.sin(i / 2) * 80, y); await sleep(14); }
      await pw.mouse.up();
      await sleep(4200);          // 落ちきるまで待つ (終端速度 約96px/秒で最大280px)
    }
    await sleep(1200);

    const 位置 = () => pw.evaluate(() => window.__app.settled.map((r) => ({ x: r.x, y: r.y })));
    const before = await 位置();
    ok(before.length > 200, `二か所に箔が積もった (${before.length}枚)`);

    // 上の山だけを右へ払う
    const 払う高さ = Math.round(蒔く高さ[0] + 145);   // 上の山が落ちて積もったあたり
    const moved = await pw.evaluate(async ([cx, y]) => {
      const cv = document.getElementById('cv');
      const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, {
        clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch' }));
      ev('pointerdown', cx - 120, y);
      for (let i = 1; i <= 6; i++) {
        await new Promise((r) => setTimeout(r, 6));
        ev('pointermove', cx - 120 + i * 40, y);
      }
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      return window.__app.sliding.length;
    }, [CX, 払う高さ]);
    ok(moved > 0, `払うと、そのあたりの箔がすべり出す (${moved}枚)`);
    await sleep(1500);
    const after = await 位置();

    // 総数が減っていない = 飛んでいっていない
    // (払う動作そのものが少し蒔くので、増えるぶんには構わない)
    ok(after.length >= before.length,
      `払っても箔が飛んでいかない (${before.length}枚 → ${after.length}枚)`);

    // 払った高さ(330付近)の箔は右へ動き、遠い下の山は1枚も動いていない
    const 近く = (a) => a.filter((r) => Math.abs(r.y - 払う高さ) < 70);
    const 遠く = (a) => a.filter((r) => r.y > 蒔く高さ[1]);
    const 平均x = (a) => a.reduce((s2, r) => s2 + r.x, 0) / (a.length || 1);
    const 近前 = 平均x(近く(before)), 近後 = 平均x(近く(after));
    const 遠前 = 平均x(遠く(before)), 遠後 = 平均x(遠く(after));
    ok(近後 - 近前 > 10,
      `払ったあたりの箔が、なぞった向きへずれる (平均x ${近前.toFixed(0)} → ${近後.toFixed(0)})`);
    ok(Math.abs(遠後 - 遠前) < 1,
      `離れた場所の箔は動かない (平均x ${遠前.toFixed(0)} → ${遠後.toFixed(0)})`);
    ok(遠く(after).length === 遠く(before).length,
      `離れた場所の枚数も変わらない (${遠く(before).length}枚)`);
    await ctxW.close();

    /* ------------------------------------------------------------------
       見張り ⑫: 「払う」で積もった箔が消える

       速くなでる操作は「その場所だけずらす」に変えたので、画面を
       まっさらにする手立てがボタンだけになった。効くことを見張る。
       ------------------------------------------------------------------ */
    section('払うと画面が戻る (見張り⑫)');
    const ctxC = await browser.newContext({ ...devices[PHONE] });
    const pc = await ctxC.newPage();
    pc.on('pageerror', (e) => errors.push('見張り⑫: ' + e.message));
    await pc.goto(URL);
    await pc.waitForFunction(() => window.__app);

    await pc.mouse.move(CX, Math.round(V.height * 0.35));
    await pc.mouse.down();
    for (let i = 0; i < 30; i++) { await pc.mouse.move(CX + Math.sin(i / 2) * 90, Math.round(V.height * 0.35)); await sleep(14); }
    await pc.mouse.up();
    await sleep(4200);          // 落ちきるまで待つ
    const 蒔いた = await pc.evaluate(() => window.__app.settled.length);
    ok(蒔いた > 100, `払う前に箔が積もっている (${蒔いた}枚)`);

    await pc.click('#btn-clear');
    await sleep(2200);          // 洗い流しが終わるまで
    const 払った後 = await pc.evaluate(() => ({
      settled: window.__app.settled.length,
      flakes: window.__app.flakes.length,
      金: (() => {
        const cv = window.__app.sedimentSnapshot();
        const c = cv.getContext('2d');
        const d = c.getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4 * 7) if (d[i] > 120 && d[i] > d[i + 2] + 30) n++;
        return n;
      })(),
    }));
    ok(払った後.settled === 0 && 払った後.flakes === 0,
      `払うと記録が空になる (積もり ${払った後.settled}枚 / 舞い ${払った後.flakes}枚)`);
    ok(払った後.金 === 0, `払うと画面から箔が消える (残り ${払った後.金} 画素)`);

    // お題の最中は、ひと匙も戻る
    await pc.click('#btn-odai');
    await sleep(2200);
    await pc.mouse.move(CX, Math.round(V.height * 0.22));
    await pc.mouse.down();
    for (let i = 0; i < 15; i++) { await pc.mouse.move(CX + Math.sin(i / 2) * 40, Math.round(V.height * 0.22)); await sleep(14); }
    await pc.mouse.up();
    await sleep(600);
    const 使用中 = await pc.evaluate(() => window.__app.odai.budget);
    await pc.click('#btn-clear');
    await sleep(2200);
    const 戻った = await pc.evaluate(() => ({
      budget: window.__app.odai.budget, max: window.__app.odai.budgetMax,
    }));
    ok(使用中 < 戻った.max, `お題でひと匙を使った (${戻った.max} → ${使用中})`);
    ok(戻った.budget === 戻った.max, `お題中に払うと、ひと匙も戻る (${使用中} → ${戻った.budget})`);
    await ctxC.close();

    /* ------------------------------------------------------------------
       見張り ⑪: 操作帯が、小さい端末でも横に溢れない
       ------------------------------------------------------------------ */
    section('操作帯が溢れない (見張り⑪)');
    for (const [label] of [[PHONE]]) {
      const ctxBar = await browser.newContext({ ...devices[PHONE] });
      const pbar = await ctxBar.newPage();
      pbar.on('pageerror', (e) => errors.push('見張り⑪: ' + e.message));
      await pbar.goto(URL);
      await pbar.waitForTimeout(400);
      const bar = await pbar.evaluate(() => {
        const el = document.getElementById('bar');
        /* 隠してある飾り (狭い端末の仕切り線) は並びの対象から外す。
           display:none の要素は位置が 0 になり、段がずれて見えてしまう */
        const kids = [...el.children]
          .filter((k) => getComputedStyle(k).display !== 'none')
          .map((k) => k.getBoundingClientRect());
        /* 仕切り線は飾りなので、押せる大きさの対象から外す */
        const 押す = [...el.querySelectorAll('.swatch, .btn')].map((k) => k.getBoundingClientRect());
        return {
          溢れ: el.scrollWidth - Math.round(el.getBoundingClientRect().width),
          はみ出し: kids.some((k) => k.left < 0 || k.right > innerWidth),
          一段: kids.every((k) => Math.abs(k.top - kids[0].top) < 20),
          押せる数: 押す.length,
          最小の押し所: Math.min(...押す.map((k) => Math.min(k.width, k.height))),
        };
      });
      ok(bar.溢れ <= 0 && !bar.はみ出し, `${label}: 操作帯が横に溢れない`);
      ok(bar.一段, `${label}: 操作帯が一段に収まる`);
      ok(bar.最小の押し所 >= 28,
        `${label}: ${bar.押せる数}つの操作すべてが指で押せる大きさ (最小 ${Math.round(bar.最小の押し所)}px)`);
      await ctxBar.close();
    }

    /* ------------------------------------------------------------------
       見張り ⑬: 記録の帳から型を選べる / 記録を消せる

       段位は「名人を取れた型の数」で決まるのに型がランダムだと、
       残り1型を引くまで何度もやり直すことになる。
       ------------------------------------------------------------------ */
    section('帳から型を選び、記録を消せる (見張り⑬)');
    const ctxK = await browser.newContext({ ...devices[PHONE] });
    const pk = await ctxK.newPage();
    pk.on('pageerror', (e) => errors.push('見張り⑬: ' + e.message));
    await pk.goto(URL);
    await pk.waitForFunction(() => window.__app);

    await pk.evaluate(() => {
      const C = window.__app.Core;
      let r = C.emptyRecords();
      r = C.applyResult(r, window.__app.SHAPES[0].name, { rank: '名人', fill: 0.9, spill: 0.1 });
      window.__app.setRecords(r);
    });
    await pk.click('#btn-book');
    await pk.waitForTimeout(300);
    const 行数 = await pk.evaluate(() => document.querySelectorAll('#book-table tr[data-shape]').length);
    ok(行数 === shapes.length, `帳の行がすべて選べる (${行数}行)`);
    ok(await pk.evaluate(() => document.getElementById('hint').classList.contains('hidden')),
      '帳を開くと、裏に案内文が透けない');

    // 狙った型で始まるか (毎回同じ型を選べることを、2回続けて確かめる)
    const 選ぶ = shapes.length - 1;
    const 名前 = await pk.evaluate((i) => window.__app.SHAPES[i].name, 選ぶ);
    for (let k = 0; k < 2; k++) {
      await pk.click(`#book-table tr[data-shape="${選ぶ}"]`);
      await pk.waitForTimeout(2300);
      const 出た = await pk.evaluate(() => ({
        idx: window.__app.odai.shapeIdx,
        name: document.getElementById('odai-name').textContent,
        budget: window.__app.odai.budgetMax,
        shapeBudget: window.__app.SHAPES[window.__app.odai.shapeIdx].budget,
      }));
      ok(出た.idx === 選ぶ && 出た.name.includes(名前),
        `${k + 1}回目も狙った型で始まる (${出た.name})`);
      ok(出た.budget === 出た.shapeBudget, `その型のひと匙が入る (${出た.budget}枚)`);
      if (k === 0) { await pk.click('#btn-book'); await pk.waitForTimeout(400); }
    }

    // 記録を消す (二度押しで確かめる作り)
    await pk.click('#btn-odai');
    await pk.waitForTimeout(300);
    await pk.click('#btn-book');
    await pk.waitForTimeout(300);
    ok(await pk.evaluate(() => window.__app.records.rounds > 0), '消す前は記録がある');
    await pk.click('#btn-book-clear');
    await pk.waitForTimeout(200);
    const 一度目 = await pk.evaluate(() => ({
      label: document.getElementById('btn-book-clear').textContent,
      rounds: window.__app.records.rounds,
    }));
    ok(一度目.rounds > 0, '一度押しただけでは消えない');
    ok(一度目.label.includes('もう一度'), `確かめの表示が出る (${一度目.label})`);
    await pk.click('#btn-book-clear');
    await pk.waitForTimeout(400);
    await pk.reload();
    await pk.waitForFunction(() => window.__app);
    ok(await pk.evaluate(() => window.__app.records.rounds === 0),
      '二度押すと消え、開き直しても戻らない');
    await ctxK.close();

    /* ------------------------------------------------------------------
       見張り ⑭: 「このあたりから蒔く」の目安が出て、蒔き始めたら消える

       計測では、型の上0〜60pxが最適で、150px上げると名人→見習いまで
       落ちていた。しかも「うまくいかない→もっと上から」と思うほど
       悪くなる向きなので、目で見えないと辛い。
       ------------------------------------------------------------------ */
    section('蒔く目安が出る (見張り⑭)');
    const ctxG = await browser.newContext({ ...devices[PHONE] });
    const pg = await ctxG.newPage();
    pg.on('pageerror', (e) => errors.push('見張り⑭: ' + e.message));
    await pg.goto(URL);
    await pg.waitForFunction(() => window.__app);
    await pg.click('#btn-odai');
    await pg.waitForTimeout(2300);

    /* ボケの箔が漂うようになったので、1点だけ見ると当たり外れが出る。
       線のある高さと、離れた高さを、横一列ならして比べる */
    await pg.addScriptTag({ content: `
      window.__横ならし = (py) => {
        const cv = document.getElementById('cv');
        const c = cv.getContext('2d');
        const s = cv.width / innerWidth;
        const y = Math.round(py * s);
        const d = c.getImageData(0, y, cv.width, 1).data;
        let 和 = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { 和 += d[i]; n++; }
        return 和 / n;
      };
    ` });
    const 目安 = await pg.evaluate(() => {
      const o = window.__app.odai;
      const 平均落下 = window.__app.SETTLE_MIN + window.__app.SETTLE_SPAN / 2;
      const y = (o.bounds.top + o.bounds.bottom) / 2 - 平均落下;
      return {
        y: Math.round(y),
        線の高さ: +window.__横ならし(y).toFixed(1),
        離れた高さ: +window.__横ならし(y - 120).toFixed(1),
        型の上端: Math.round(o.bounds.top),
        画面内: y > 0 && y < innerHeight,
      };
    });
    ok(目安.画面内, `目安が画面の中に出る (y=${目安.y})`);
    ok(目安.線の高さ > 目安.離れた高さ + 8,
      `目安の線が光っている (線の高さ ${目安.線の高さ} / 離れた高さ ${目安.離れた高さ})`);
    ok(目安.y < 目安.型の上端,
      `目安は型より上にある (目安 ${目安.y} < 型の上端 ${目安.型の上端})`);

    // 蒔き始めたら消える
    await pg.mouse.move(Math.round(V.width * 0.15), 目安.y);
    await pg.mouse.down();
    await pg.waitForTimeout(120);
    await pg.mouse.up();
    await pg.waitForTimeout(400);
    const 消えた = await pg.evaluate(() => {
      const o = window.__app.odai;
      const y = (o.bounds.top + o.bounds.bottom) / 2 - (window.__app.SETTLE_MIN + window.__app.SETTLE_SPAN / 2);
      return {
        線の高さ: +window.__横ならし(y).toFixed(1),
        離れた高さ: +window.__横ならし(y - 120).toFixed(1),
      };
    });
    /* 線が消えていれば、線のあった高さと離れた高さの差がほとんど無くなる */
    ok(消えた.線の高さ < 消えた.離れた高さ + 8,
      `蒔き始めると目安が消える (線の高さ ${消えた.線の高さ} / 離れた高さ ${消えた.離れた高さ})`);
    await ctxG.close();

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
    const swCtx = await browser.newContext({ ...devices[PHONE] });
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
