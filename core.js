/* ============================================================
   金箔ひらひら ロジック
   ------------------------------------------------------------
   DOM を触らない。ブラウザと node の両方で動く。
   ここに置いたものは core.test.js から node だけで確かめられる。

   ■ 型をすべて「単位座標の多角形」で持つ理由
     以前は型ごとに Path2D を手で組んでいたため、三日月の内弧を
     逆向きに描いてレンズ形になっている、という間違いに気づけなかった。
     多角形の点列にすれば、面積も細さもひと匙の量も計算で出せる。
     「あとで目で見て確かめる」より「計算で決まる」方が強い。
   ============================================================ */
(function (root) {
  "use strict";

  /* ---------- 多角形をつくる小道具 ---------- */

  /* 弧を点列にする */
  function arcPts(cx, cy, r, a0, a1, ccw, n) {
    const pts = [];
    let span = a1 - a0;
    if (ccw) { while (span > 0) span -= Math.PI * 2; }
    else     { while (span < 0) span += Math.PI * 2; }
    for (let i = 0; i <= n; i++) {
      const a = a0 + span * (i / n);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  }

  /* 左右対称の形を、高さごとの「半分の幅」から組む */
  function profile(yFrom, yTo, halfWidth, n) {
    const right = [], left = [];
    for (let i = 0; i <= n; i++) {
      const y = yFrom + (yTo - yFrom) * (i / n);
      const w = Math.max(0, halfWidth(y));
      right.push([w, y]);
      left.push([-w, y]);
    }
    return right.concat(left.reverse());
  }

  /* 中心からの距離が角度で決まる形(花など) */
  function polar(radius, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2) * (i / n) - Math.PI / 2;
      const r = radius(a);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  }

  /* 円の、その高さでの半分の幅(左右対称の形を重ねるのに使う) */
  function circleHalf(cy, r, y) {
    const d = r * r - (y - cy) * (y - cy);
    return d > 0 ? Math.sqrt(d) : 0;
  }

  /* ---------- 多角形の性質(すべて計算で出す) ---------- */

  /* 符号つき面積の2倍。点の並び順も分かる */
  function shoelace(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      s += x1 * y2 - x2 * y1;
    }
    return s;
  }

  function area(pts) { return Math.abs(shoelace(pts)) / 2; }

  function perimeter(pts) {
    let p = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      p += Math.hypot(x2 - x1, y2 - y1);
    }
    return p;
  }

  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  /* 点が内側か(奇偶判定)。当たり判定の答え合わせに使う */
  function contains(pts, px, py) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) &&
          px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /* まるっこさ。円=1、細い/入り組んだ形ほど小さい */
  function compactness(pts) {
    const p = perimeter(pts);
    return p > 0 ? (4 * Math.PI * area(pts)) / (p * p) : 0;
  }

  /* 枠の中心を原点へ寄せ、長い方の辺が 2 になるよう揃える。
     どの型も画面上で同じくらいの大きさになる */
  function normalize(pts) {
    const b = bbox(pts);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const k = 2 / Math.max(b.w, b.h);
    return pts.map(([x, y]) => [(x - cx) * k, (y - cy) * k]);
  }

  /* ---------- 型 ---------- */

  const N = 90;   /* 曲線を刻む細かさ */

  const SHAPE_DEFS = [
    {
      name: "駒",
      /* 将棋駒の五角形 */
      build: () => [[0, -1], [0.55, -0.5], [0.70, 1], [-0.70, 1], [-0.55, -0.5]],
    },
    {
      name: "亀甲",
      /* 六角形。辺がまっすぐで狙いやすい */
      build: () => arcPts(0, 0, 1, -Math.PI / 2, Math.PI * 1.5, false, 6).slice(0, 6),
    },
    {
      name: "富士",
      /* 山の稜線。頂は雪形にぎざぎざと */
      build: () => [[-1, 0.62], [-0.36, -0.52], [-0.18, -0.40], [0, -0.55],
                    [0.18, -0.40], [0.36, -0.52], [1, 0.62]],
    },
    {
      name: "扇",
      /* 上に開く扇形(外弧と内弧の帯) */
      build: () => {
        const a0 = -Math.PI * 5 / 6, a1 = -Math.PI / 6;
        return arcPts(0, 0.55, 1.05, a0, a1, false, N)
          .concat(arcPts(0, 0.55, 0.35, a1, a0, true, N));
      },
    },
    {
      name: "瓢箪",
      /* 上下ふたつのふくらみ。左右対称なので、高さごとに
         二つの円の広い方を取れば、そのまま輪郭になる */
      build: () => profile(-1, 1, (y) =>
        Math.max(circleHalf(-0.48, 0.44, y), circleHalf(0.42, 0.60, y), 0.13), N * 2),
    },
    {
      name: "松",
      /* 三段の笠と幹 */
      build: () => profile(-1, 1, (y) => {
        const tier = (top, bottom, w) =>
          (y >= top && y <= bottom) ? w * (y - top) / (bottom - top) : 0;
        const kasa = Math.max(tier(-1, -0.34, 0.46), tier(-0.52, 0.16, 0.72),
                              tier(-0.02, 0.66, 0.96));
        return Math.max(kasa, y > 0.5 ? 0.13 : 0);
      }, N * 2),
    },
    {
      name: "三日月",
      /* 外弧から内弧を削る。内弧は外円の内側 (x=+0.3) を通す */
      build: () => {
        const cx = -1.5, r2 = Math.hypot(cx, 1);
        return arcPts(0, 0, 1, -Math.PI / 2, Math.PI / 2, false, N)
          .concat(arcPts(cx, 0, r2, Math.atan2(1, -cx), Math.atan2(-1, -cx), true, N));
      },
    },
    {
      name: "桜",
      /* 五弁の花。中心からの距離が角度で決まる */
      build: () => polar((a) => 0.52 + 0.48 * Math.pow(Math.abs(Math.cos(2.5 * a)), 0.7), N * 3),
    },
  ];

  /* 型を組み立てて、性質を添えたものを返す */
  function buildShapes() {
    return SHAPE_DEFS.map((d, i) => {
      const pts = normalize(d.build());
      const a = area(pts);
      const miss = missRatio(pts);
      return {
        index: i, name: d.name, points: pts,
        area: a, compactness: compactness(pts), miss,
        budget: budgetFor(a),
        spillMax: spillMaxFor(miss),
        difficulty: difficultyOf(miss),
      };
    });
  }

  /* ---------- ひと匙の量・難易度・採点の線引き ---------- */

  /* ひと匙 = 型の面積に比例させる。
     広い型ほど多く配り、どの型でも「埋めきれる」ようにする。
     係数は実測から決めた: 駒 (面積 2.15) に 300枚 蒔いて埋まり100%
     だったので、1面積あたり 140枚 とする */
  const SPOON_PER_AREA = 140;
  const SPOON_MIN = 140, SPOON_MAX = 420;

  function budgetFor(a) {
    return Math.max(SPOON_MIN, Math.min(SPOON_MAX, Math.round(a * SPOON_PER_AREA)));
  }

  /* ------------------------------------------------------------
     型の「受け止めにくさ」
     ------------------------------------------------------------
     箔は撒いた場所から少し下に落ちてから貼り付く。つまり型の上から
     落とすと、型の形しだいで必ず何割かは外へこぼれる。
     そのこぼれ具合を、型の上を横になぞって落としたと仮定して数える。

     まるっこさで代わりにしようとしたが、実測との相関は -0.22 で
     まるで当たらなかった (松はいちばん細いのにこぼれ 22%、扇はまるいのに
     50%)。落下を数える方は相関 0.83 で、こちらを使う。

     落ちる距離は画面の大きさで変わるが、難易度が遊ぶたびに変わると
     記録の意味がなくなるので、基準の大きさで固定して数える。
     基準: iPhone 16 Plus (幅 430pt)。型の大きさは画面の短辺の 0.32 倍
     なので s = 430 * 0.32 = 137.6px。落下は 60〜280px。
     縦持ちなら短辺は常に幅なので、Safari でもホーム画面から開いても
     この値は変わらない
     ------------------------------------------------------------ */
  const REF_SHAPE_SIZE = 430 * 0.32;   /* = 137.6px */
  const FALL_MIN_U = 60 / REF_SHAPE_SIZE;    /* 型の座標に直した落下距離 */
  const FALL_MAX_U = 280 / REF_SHAPE_SIZE;

  function missRatio(pts) {
    const b = bbox(pts);
    const y0 = b.y0;                /* 型の上端から落とす */
    const NX = 160, ND = 160;
    let hit = 0, n = 0;
    for (let i = 0; i < NX; i++) {
      const x = b.x0 + b.w * ((i + 0.5) / NX);
      for (let j = 0; j < ND; j++) {
        const d = FALL_MIN_U + (FALL_MAX_U - FALL_MIN_U) * ((j + 0.5) / ND);
        n++;
        if (contains(pts, x, y0 + d)) hit++;
      }
    }
    return 1 - hit / n;
  }

  /* こぼれの許し幅。受け止めにくい型ほど広く許す。
     係数は実測に合わせる。撒いたときに指から外へ散らす勢いを足したので、
     どの型もこぼれが増えた (三日月は 24% → 42%)。
     8型の実測が計算値 +10% に収まるので、その線を許し幅にする。
     余裕がいちばん薄いのは三日月で +8ポイント。
     ★ 撒き方の手触りを変えたら、実機で測り直してこの係数を引き直すこと */
  function spillMaxFor(miss) {
    return Math.round(Math.max(0.26, Math.min(0.68, miss + 0.10)) * 100) / 100;
  }

  /* 難易度も同じ「受け止めにくさ」から機械的に決める(手で付けない) */
  function difficultyOf(miss) {
    if (miss < 0.25) return 1;
    if (miss < 0.35) return 2;
    if (miss < 0.45) return 3;
    if (miss < 0.60) return 4;
    return 5;
  }

  /* 一回ぶんの採点 */
  function judge(fill, spill, shape) {
    const max = shape.spillMax;
    if (fill >= 0.70 && spill <= max) {
      return { rank: "名人", word: "見事な蒔きぶり。師も唸る手際です" };
    }
    if (fill >= 0.45 && spill <= Math.min(0.85, max * 1.8)) {
      return { rank: "職人", word: "堂に入った撒き心地。名人まであと少し" };
    }
    return { rank: "見習い", word: "型のすぐ上から、そっと落としてみましょう" };
  }

  const RANK_ORDER = ["見習い", "職人", "名人"];
  function rankValue(r) { return RANK_ORDER.indexOf(r); }

  /* ---------- 記録と段位 ---------- */

  function emptyRecords() {
    return { best: {}, meijin: 0, shokunin: 0, rounds: 0, streak: 0, bestStreak: 0 };
  }

  /* 一回の結果を記録に畳み込む。元の記録は変えず、新しい記録を返す */
  function applyResult(rec, shapeName, result) {
    const r = {
      best: Object.assign({}, rec.best),
      meijin: rec.meijin, shokunin: rec.shokunin, rounds: rec.rounds + 1,
      streak: rec.streak, bestStreak: rec.bestStreak,
    };
    const prev = r.best[shapeName];
    const better = !prev || rankValue(result.rank) > rankValue(prev.rank) ||
      (rankValue(result.rank) === rankValue(prev.rank) && result.fill > prev.fill);
    if (better) r.best[shapeName] = { rank: result.rank, fill: result.fill, spill: result.spill };

    if (result.rank === "名人") r.meijin++;
    if (result.rank === "職人") r.shokunin++;
    /* 連続は「職人以上」で伸び、見習いで途切れる */
    if (rankValue(result.rank) >= 1) {
      r.streak = rec.streak + 1;
      r.bestStreak = Math.max(rec.bestStreak, r.streak);
    } else {
      r.streak = 0;
    }
    return r;
  }

  /* 段位 = 名人を取れた型がいくつあるか。全部の型で名人なら皆伝 */
  const GRADES = ["無位", "初伝", "中伝", "奥伝", "皆伝"];

  function grade(rec, shapeCount) {
    const done = Object.values(rec.best).filter((b) => b.rank === "名人").length;
    if (done <= 0) return { name: GRADES[0], done, of: shapeCount };
    if (done >= shapeCount) return { name: GRADES[4], done, of: shapeCount };
    const step = Math.ceil(shapeCount / 3);
    const i = Math.min(3, 1 + Math.floor((done - 1) / step));
    return { name: GRADES[i], done, of: shapeCount };
  }

  /* 保存されていた記録を読む。壊れていても必ず使える形で返す */
  function reviveRecords(raw) {
    const base = emptyRecords();
    if (!raw || typeof raw !== "object") return base;
    const out = emptyRecords();
    if (raw.best && typeof raw.best === "object") {
      for (const [k, v] of Object.entries(raw.best)) {
        if (v && RANK_ORDER.includes(v.rank) &&
            typeof v.fill === "number" && typeof v.spill === "number") {
          out.best[k] = { rank: v.rank, fill: v.fill, spill: v.spill };
        }
      }
    }
    for (const k of ["meijin", "shokunin", "rounds", "streak", "bestStreak"]) {
      if (Number.isFinite(raw[k]) && raw[k] >= 0) out[k] = Math.floor(raw[k]);
    }
    return out;
  }

  root.KinpakuCore = {
    arcPts, profile, polar, circleHalf,
    area, perimeter, bbox, contains, compactness, normalize,
    SHAPE_DEFS, buildShapes,
    budgetFor, missRatio, spillMaxFor, difficultyOf, judge, rankValue, RANK_ORDER,
    emptyRecords, applyResult, grade, reviveRecords, GRADES,
  };
})(typeof module !== "undefined" && module.exports ? module.exports : (this.window || globalThis));
