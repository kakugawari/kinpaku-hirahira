/* ロジックのテスト: node --test core.test.js (ブラウザ不要) */
const test = require("node:test");
const assert = require("node:assert");
const C = require("./core.js").KinpakuCore;

const shapes = C.buildShapes();

/* 線分どうしが交わるか(型が自分自身と交差していないかを見るため) */
function crosses(a, b, c, d) {
  const s = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return s(a, b, c) * s(a, b, d) < 0 && s(c, d, a) * s(c, d, b) < 0;
}

test("型はどれも、面積を持つ閉じた多角形になっている", () => {
  assert.ok(shapes.length >= 12, `型が ${shapes.length} 個しかない`);
  for (const s of shapes) {
    assert.ok(Array.isArray(s.rings) && s.rings.length >= 1, `${s.name}: 輪がない`);
    for (const ring of s.rings) {
      assert.ok(ring.length >= 3, `${s.name}: 点が少なすぎる`);
      for (const [x, y] of ring) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), `${s.name}: 座標が数値でない`);
      }
    }
    assert.ok(s.area > 0.2, `${s.name}: 面積が小さすぎる (${s.area})`);
  }
});

/* 丸2個のように離れた輪でできた型が、ちゃんと離れていること。
   輪どうしが重なっていると、面積を足し算で出しているぶんだけ多く数えて
   しまう(ひと匙の量も許し幅も、そこから決まる) */
test("離れた輪でできた型は、輪どうしが重なっていない", () => {
  const 複数 = shapes.filter((s) => s.rings.length > 1);
  assert.ok(複数.length >= 3, `離れた輪の型が ${複数.length} 個しかない`);
  for (const s of 複数) {
    for (let i = 0; i < s.rings.length; i++) {
      for (const [x, y] of s.rings[i]) {
        for (let j = 0; j < s.rings.length; j++) {
          if (i === j) continue;
          assert.equal(C.contains([s.rings[j]], x, y), false,
            `${s.name}: ${i} 番目の輪が ${j} 番目に食い込んでいる`);
        }
      }
    }
  }
});

test("型は自分自身と交差していない(ねじれた形になっていない)", () => {
  for (const s of shapes) {
    for (const p of s.rings) {
      const n = p.length;
      let bad = null;
      for (let i = 0; i < n && !bad; i++) {
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;          /* 隣どうしは除く */
          if (crosses(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) { bad = [i, j]; break; }
        }
      }
      assert.equal(bad, null, `${s.name}: 辺 ${bad} が交差している`);
    }
  }
});

test("型は原点を中心に、同じ大きさへ揃えてある", () => {
  for (const s of shapes) {
    const b = C.bbox(s.rings);
    assert.ok(Math.abs(Math.max(b.w, b.h) - 2) < 1e-9, `${s.name}: 長辺が 2 でない (${Math.max(b.w, b.h)})`);
    assert.ok(Math.abs((b.x0 + b.x1) / 2) < 1e-9, `${s.name}: 横の中心がずれている`);
    assert.ok(Math.abs((b.y0 + b.y1) / 2) < 1e-9, `${s.name}: 縦の中心がずれている`);
  }
});

test("三日月には欠けがあり、亀甲はへこんでいない", () => {
  const moon = shapes.find((s) => s.name === "三日月");
  const hex  = shapes.find((s) => s.name === "亀甲");
  /* 内弧を逆向きに描くとレンズ形になり、へこみが消える(= 1 に近づく)。
     細さで見ると、月を太らせただけで落ちてしまうので、へこみで見る */
  assert.ok(moon.concavity < 0.92, `三日月に欠けがない (へこみ ${moon.concavity.toFixed(3)})`);
  assert.ok(hex.concavity > 0.98, `亀甲がへこんでいる (${hex.concavity.toFixed(3)})`);
  /* 欠けている側(左)の、弦の中ほどは外にあるはず */
  const b = C.bbox(moon.rings);
  assert.equal(C.contains(moon.rings, b.x0 - 0.01, 0), false, "三日月の左外が内側になっている");
});

test("へこみ具合: 凸な形は 1、欠けた形は小さくなる", () => {
  /* 形は「輪の集まり」で渡す(輪が1本でも配列にくるむ) */
  const 四角 = [[[-1,-1],[1,-1],[1,1],[-1,1]]];
  const コの字 = [[[-1,-1],[1,-1],[1,-0.4],[-0.3,-0.4],[-0.3,0.4],[1,0.4],[1,1],[-1,1]]];
  assert.ok(Math.abs(C.concavity(四角) - 1) < 1e-9, "四角がへこんでいることになっている");
  assert.ok(C.concavity(コの字) < 0.8, `コの字のへこみが浅すぎる (${C.concavity(コの字).toFixed(3)})`);
  /* 離れた丸ふたつは、輪ゴムをかけると隙間ぶんだけ痩せて見える */
  const 丸二つ = [C.circle(-0.6, 0, 0.35, 64), C.circle(0.6, 0, 0.35, 64)];
  assert.ok(C.concavity(丸二つ) < 0.7,
    `離れた丸ふたつのへこみが浅すぎる (${C.concavity(丸二つ).toFixed(3)})`);
});

test("ひと匙は型の広さに比例し、広い型ほど多い", () => {
  const sorted = [...shapes].sort((a, b) => a.area - b.area);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].budget >= sorted[i - 1].budget,
      `${sorted[i].name} の方が広いのにひと匙が少ない`);
  }
  for (const s of shapes) assert.ok(s.budget >= 140 && s.budget <= 420, `${s.name}: ひと匙が範囲外`);
});

test("受け止めにくい型ほど、こぼれを多めに許す", () => {
  const sorted = [...shapes].sort((a, b) => a.miss - b.miss);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].spillMax >= sorted[i - 1].spillMax,
      `${sorted[i].name} の方が受け止めにくいのに、こぼれを厳しく見ている`);
  }
});

test("難易度は「許し幅のどこまで使うか」で決まり、1〜5 に収まる", () => {
  for (const s of shapes) {
    assert.ok(s.difficulty >= 1 && s.difficulty <= 5, `${s.name}: 難易度が範囲外`);
    assert.equal(s.difficulty, C.difficultyOf(s.name, s.spillMax), `${s.name}: 難易度が導出と食い違う`);
  }
  /* 余裕を使い切る型ほど難しい、という向きが保たれていること */
  const 順 = [...shapes].sort((a, b) => (a.reached / a.spillMax) - (b.reached / b.spillMax));
  for (let i = 1; i < 順.length; i++) {
    assert.ok(順[i].difficulty >= 順[i - 1].difficulty,
      `${順[i].name} の方が余裕を使うのに、難易度が低い`);
  }
});

test("測っていない型が来ても、難易度は真ん中で返る", () => {
  assert.equal(C.difficultyOf("まだ無い型", 0.4), 3);
});

test("どの型も名人に手が届く(実機で測ったこぼれを下回らない)", () => {
  /* 実測は core.js の REACHED が唯一の出どころ。ここで持ち直すと
     二重管理になり、片方だけ古くなる */
  for (const s of shapes) {
    assert.ok(s.reached !== undefined,
      `${s.name}: 実測がない。型を足したら実機で測って core.js の REACHED に入れること`);
    assert.ok(s.spillMax * 100 >= s.reached,
      `${s.name}: 許容 ${Math.round(s.spillMax * 100)}% では、実測 ${s.reached}% に届かず名人が取れない`);
  }
});

test("実測の表に、余分な型が残っていない", () => {
  const 型名 = new Set(shapes.map((s) => s.name));
  for (const name of Object.keys(C.REACHED)) {
    assert.ok(型名.has(name), `REACHED に、もう無い型 ${name} が残っている`);
  }
});

test("受け止めにくさは、型を上から見たときの当たり方から出ている", () => {
  /* 上下にまっすぐな帯は、落ちてきた箔をよく受け止める */
  const 帯 = [[[-0.2, -1], [0.2, -1], [0.2, 1], [-0.2, 1]]];
  /* 横に平たい板は、上から落とすとほとんど下へ抜ける */
  const 板 = [[[-1, -0.08], [1, -0.08], [1, 0.08], [-1, 0.08]]];
  assert.ok(C.missRatio(帯) < C.missRatio(板),
    `縦長の帯 (${C.missRatio(帯).toFixed(2)}) が、平たい板 (${C.missRatio(板).toFixed(2)}) より受け止めにくいことになっている`);
  for (const pts of [帯, 板]) {
    const m = C.missRatio(pts);
    assert.ok(m >= 0 && m <= 1, `受け止めにくさが 0〜1 の外 (${m})`);
  }
});

test("採点: 埋まりときれいさの両方が要る", () => {
  const koma = shapes.find((s) => s.name === "駒");
  assert.equal(C.judge(0.95, 0.10, koma).rank, "名人");
  assert.equal(C.judge(0.95, koma.spillMax + 0.01, koma).rank, "職人");  /* こぼれ過多で落ちる */
  assert.equal(C.judge(0.50, 0.10, koma).rank, "職人");                  /* 埋まり不足で落ちる */
  assert.equal(C.judge(0.20, 0.10, koma).rank, "見習い");
  assert.equal(C.judge(0.95, 0.99, koma).rank, "見習い");
});

test("採点: 受け止めにくい型は、同じこぼれでも名人になれる", () => {
  const koma = shapes.find((s) => s.name === "駒");
  const matsu = shapes.find((s) => s.name === "松");
  /* 駒の許容をわずかに超える、しかし松の許容には収まるこぼれを選ぶ。
     決め打ちの数値にすると、許容を調整したとたんに意味が変わってしまう */
  const spill = koma.spillMax + 0.05;
  assert.ok(spill < matsu.spillMax, "松の許容が駒と近すぎて、この比べ方が成り立たない");
  assert.equal(C.judge(0.9, spill, koma).rank, "職人");
  assert.equal(C.judge(0.9, spill, matsu).rank, "名人");
});

test("記録: 良い結果だけが最高記録を塗り替える", () => {
  let r = C.emptyRecords();
  r = C.applyResult(r, "駒", { rank: "職人", fill: 0.6, spill: 0.3 });
  assert.equal(r.best["駒"].rank, "職人");
  r = C.applyResult(r, "駒", { rank: "見習い", fill: 0.99, spill: 0.9 });
  assert.equal(r.best["駒"].rank, "職人", "下の評価で塗り替わってしまった");
  r = C.applyResult(r, "駒", { rank: "名人", fill: 0.8, spill: 0.1 });
  assert.equal(r.best["駒"].rank, "名人");
  assert.equal(r.rounds, 3);
  assert.equal(r.meijin, 1);
});

test("記録: 連続は職人以上で伸び、見習いで途切れる", () => {
  let r = C.emptyRecords();
  for (const rank of ["職人", "名人", "職人"]) r = C.applyResult(r, "駒", { rank, fill: 0.8, spill: 0.1 });
  assert.equal(r.streak, 3);
  assert.equal(r.bestStreak, 3);
  r = C.applyResult(r, "駒", { rank: "見習い", fill: 0.1, spill: 0.9 });
  assert.equal(r.streak, 0, "見習いで途切れていない");
  assert.equal(r.bestStreak, 3, "最高の連続まで消えている");
});

test("記録: 元の記録は書き換えられない", () => {
  const r0 = C.emptyRecords();
  const r1 = C.applyResult(r0, "駒", { rank: "名人", fill: 0.8, spill: 0.1 });
  assert.equal(r0.rounds, 0, "元の記録が書き換わっている");
  assert.equal(Object.keys(r0.best).length, 0);
  assert.equal(r1.rounds, 1);
});

test("段位: 名人を取れた型の数で上がり、全型で皆伝", () => {
  const n = shapes.length;
  let r = C.emptyRecords();
  assert.equal(C.grade(r, n).name, "無位");
  for (let i = 0; i < n; i++) {
    r = C.applyResult(r, shapes[i].name, { rank: "名人", fill: 0.8, spill: 0.1 });
    const g = C.grade(r, n);
    assert.equal(g.done, i + 1);
    if (i + 1 < n) assert.notEqual(g.name, "皆伝", `${i + 1}型で皆伝になっている`);
  }
  assert.equal(C.grade(r, n).name, "皆伝");
});

test("記録の読み込み: 壊れていても必ず使える形で返る", () => {
  for (const junk of [null, undefined, 42, "こわれた", [], { best: "ちがう" },
                      { meijin: -5, rounds: NaN }, { best: { 駒: { rank: "将軍" } } }]) {
    const r = C.reviveRecords(junk);
    assert.ok(r && typeof r.best === "object", `${JSON.stringify(junk)} で壊れた`);
    assert.ok(Number.isFinite(r.rounds) && r.rounds >= 0);
    for (const v of Object.values(r.best)) assert.ok(C.RANK_ORDER.includes(v.rank));
  }
  /* まともな記録はそのまま通る */
  const ok = C.reviveRecords({ best: { 駒: { rank: "名人", fill: 0.9, spill: 0.1 } }, meijin: 1, rounds: 4 });
  assert.equal(ok.best["駒"].rank, "名人");
  assert.equal(ok.rounds, 4);
});

test("面積と内外判定が食い違わない(ばらまいて数える)", () => {
  for (const s of shapes) {
    const b = C.bbox(s.rings);
    let hit = 0;
    const n = 20000;
    /* 決まった並びで散らす(毎回同じ結果になるように) */
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < n; i++) {
      if (C.contains(s.rings, b.x0 + rnd() * b.w, b.y0 + rnd() * b.h)) hit++;
    }
    const 推定 = (hit / n) * b.w * b.h;
    assert.ok(Math.abs(推定 - s.area) / s.area < 0.05,
      `${s.name}: 面積 ${s.area.toFixed(2)} と数えた ${推定.toFixed(2)} が合わない`);
  }
});

test("下の余白は、ホームバーに届いていなければ空けない", () => {
  /* 実機の値: ウェブ画面は 873 で終わり、ホームバーは 932-34=898 から */
  assert.equal(C.bottomGap(873, 932, 34), 0);
  /* 画面いっぱいをもらえていれば、安全域ぶん空ける */
  assert.equal(C.bottomGap(932, 932, 34), 34);
  /* 途中まで掛かっていれば、掛かったぶんだけ */
  assert.equal(C.bottomGap(910, 932, 34), 12);
  /* 安全域が無い端末では、いつでも 0 */
  assert.equal(C.bottomGap(739, 932, 0), 0);
  /* 空けすぎない(安全域より大きくならない) */
  assert.equal(C.bottomGap(1200, 932, 34), 34);
});
