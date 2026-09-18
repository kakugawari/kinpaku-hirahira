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

   ■ 型は「輪(閉じた点列)の配列」
     二つ星や梅鉢のように、離れた丸でできた型がある。点列ひとつながりで
     持つと、輪と輪のあいだにも辺ができてしまう。輪の配列にしておけば、
     面積は足し算、内外は輪ごとの偶奇で、そのまま正しく出る。
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

  /* 円をひとつ。丸を並べた型に使う */
  function circle(cx, cy, r, n) {
    return arcPts(cx, cy, r, 0, Math.PI * 2, false, n).slice(0, n);
  }

  /* ---------- 型は「輪」の集まり ----------
     丸2個のように離れた形も持てるよう、型は輪(閉じた点列)の配列にする。
     ひとつながりの型は、輪が1本なだけ。
     内外は偶奇で決める ―― 離れた輪なら「どれか1つの内側」、入れ子の輪なら
     「穴」になり、どちらも同じ式で正しく出る。
     ring〜 が輪ひとつ、それ以外は輪の集まりを受け取る ---------- */

  /* build() は 1本の輪でも、輪の配列でも返してよい */
  function toRings(v) { return (typeof v[0][0] === "number") ? [v] : v; }

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

  function ringArea(pts) { return Math.abs(shoelace(pts)) / 2; }

  function ringPerimeter(pts) {
    let p = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      p += Math.hypot(x2 - x1, y2 - y1);
    }
    return p;
  }

  /* 離れた輪どうしは重ならない約束なので、面積は足すだけでよい */
  function area(rings) {
    let a = 0;
    for (const r of rings) a += ringArea(r);
    return a;
  }

  function perimeter(rings) {
    let p = 0;
    for (const r of rings) p += ringPerimeter(r);
    return p;
  }

  function bbox(rings) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const pts of rings) for (const [x, y] of pts) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  /* 点が内側か(奇偶判定)。当たり判定の答え合わせに使う。
     輪ごとに数えるので、輪と輪のあいだに線は引かれない */
  function contains(rings, px, py) {
    let inside = false;
    for (const pts of rings) {
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) &&
            px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }

  /* 凸包(輪ゴムをかけた形)。へこみがあるか調べるのに使う。
     輪の集まりを受け取り、輪ひとつ(点列)を返す */
  function convexHull(rings) {
    const p = rings.flat().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
    const lo = [];
    for (const q of p) { while (lo.length > 1 && cross(lo[lo.length-2], lo[lo.length-1], q) <= 0) lo.pop(); lo.push(q); }
    const hi = [];
    for (const q of [...p].reverse()) { while (hi.length > 1 && cross(hi[hi.length-2], hi[hi.length-1], q) <= 0) hi.pop(); hi.push(q); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }

  /* へこみ具合。1 = でっぱりだけ(凸)、小さいほど深く欠けている。
     三日月が裏返ってレンズ形になる類の間違いは、これで捕まる */
  function concavity(rings) {
    const h = ringArea(convexHull(rings));
    return h > 0 ? area(rings) / h : 1;
  }

  /* まるっこさ。円=1、細い/入り組んだ形ほど小さい */
  function compactness(rings) {
    const p = perimeter(rings);
    return p > 0 ? (4 * Math.PI * area(rings)) / (p * p) : 0;
  }

  /* 枠の中心を原点へ寄せ、長い方の辺が 2 になるよう揃える。
     どの型も画面上で同じくらいの大きさになる */
  function normalize(rings) {
    const b = bbox(rings);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const k = 2 / Math.max(b.w, b.h);
    return rings.map((pts) => pts.map(([x, y]) => [(x - cx) * k, (y - cy) * k]));
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
        /* 内側の円の中心を遠くに置くほど、欠けが浅く=月が太くなる。
           -1.5 だと肉の厚みが 0.70 しかなく、撒いた箔の散らばり (片側
           0.30) に対して細すぎて、名人がほとんど取れない型になっていた */
        const cx = -2.4, r2 = Math.hypot(cx, 1);
        return arcPts(0, 0, 1, -Math.PI / 2, Math.PI / 2, false, N)
          .concat(arcPts(cx, 0, r2, Math.atan2(1, -cx), Math.atan2(-1, -cx), true, N));
      },
    },
    {
      name: "桜",
      /* 五弁の花。中心からの距離が角度で決まる */
      build: () => polar((a) => 0.52 + 0.48 * Math.pow(Math.abs(Math.cos(2.5 * a)), 0.7), N * 3),
    },

    /* ---- ここから、離れた輪でできた型(家紋の意匠) ---- */
    {
      name: "二つ星",
      /* 丸ふたつを斜めに。横に並べると、上から落としたぶんが左右へ
         抜けてしまい (計算こぼれ 77%)、許し幅の上限 68% でも名人に
         届かなかった。斜めなら 47% で、狙えば取れる */
      build: () => [circle(-0.38, -0.38, 0.52, N), circle(0.38, 0.38, 0.52, N)],
    },
    {
      name: "三つ星",
      /* 丸みっつを三角に。オリオンの三つ星にちなむ紋 */
      build: () => [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6].map(
        (a) => circle(Math.cos(a) * 0.56, Math.sin(a) * 0.56, 0.42, N)),
    },
    {
      name: "梅鉢",
      /* 加賀の梅鉢。中心の丸と、まわりの五弁 ―― 金沢の箔にちなんで */
      build: () => [circle(0, 0, 0.26, N)].concat(
        [0, 1, 2, 3, 4].map((i) => {
          const a = -Math.PI / 2 + (Math.PI * 2 / 5) * i;
          return circle(Math.cos(a) * 0.64, Math.sin(a) * 0.64, 0.34, N);
        })),
    },
    {
      name: "四つ目",
      /* 四つ目結。角のある輪を四つ。丸より隅を埋めにくい */
      build: () => {
        const 升 = (cx, cy, h) => [[cx - h, cy - h], [cx + h, cy - h],
                                   [cx + h, cy + h], [cx - h, cy + h]];
        return [升(-0.5, -0.5, 0.42), 升(0.5, -0.5, 0.42),
                升(-0.5, 0.5, 0.42), 升(0.5, 0.5, 0.42)];
      },
    },
  ];

  /* 型を組み立てて、性質を添えたものを返す */
  function buildShapes() {
    return SHAPE_DEFS.map((d, i) => {
      const rings = normalize(toRings(d.build()));
      const a = area(rings);
      const miss = missRatio(rings);
      const spillMax = spillMaxFor(miss);
      return {
        index: i, name: d.name, rings,
        area: a, compactness: compactness(rings), concavity: concavity(rings), miss,
        budget: budgetFor(a),
        spillMax,
        reached: REACHED[d.name],
        difficulty: difficultyOf(d.name, spillMax),
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

  /* 横の散らばり。撒いた箔は生まれる位置が散り (±16px)、さらに指から
     外へ弾ける (12〜42px)。合わせて片側およそ 42px = 型の座標で 0.30。
     これを入れないと、細い型の取りこぼしを大幅に見誤る。
     実際、入れずに決めた許し幅では三日月だけ名人に届かなかった */
  const SCATTER_U = 42 / REF_SHAPE_SIZE;

  function missRatio(rings) {
    const b = bbox(rings);
    const y0 = b.y0;                /* 型の上端から落とす */
    const NX = 120, ND = 120, NS = 9;
    let hit = 0, n = 0;
    for (let i = 0; i < NX; i++) {
      const x = b.x0 + b.w * ((i + 0.5) / NX);
      for (let j = 0; j < ND; j++) {
        const d = FALL_MIN_U + (FALL_MAX_U - FALL_MIN_U) * ((j + 0.5) / ND);
        /* 横のぶれを、真ん中が厚い山なりの重みで見込む */
        for (let k = 0; k < NS; k++) {
          const u = (k + 0.5) / NS * 2 - 1;              /* -1..1 */
          const w = 1 - Math.abs(u);                      /* 山なりの重み */
          const sx = x + u * SCATTER_U;
          n += w;
          if (contains(rings, sx, y0 + d)) hit += w;
        }
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
    return Math.round(Math.max(0.26, Math.min(0.68, miss + 0.14)) * 100) / 100;
  }

  /* ------------------------------------------------------------
     「上手に蒔いたときのこぼれ」(%)
     ------------------------------------------------------------
     iPhone 16 Plus (幅430pt) 相当で、なぞる打ち方 (振り幅3通り x 型の
     上10/40/80px) と狙い置き (落ち方を数えて見込みの高い所に置く) を
     自動で流し、「埋まり 70% 以上 = 名人の条件を満たしたうちで、いちばん
     こぼれの少なかった回」を採る。下手に蒔けばどの型でもこぼれるが、
     それは型の難しさではないので、最良だけを採る。

     出し方: npm run measure  (measure.js。2周流して最良を採った)
     2周の差: 扇 42/50・二つ星 26/33 と、ぎりぎりの型ほど振れた。
     他は 3ポイント以内。
     ★ 型を足す・基準の大きさを変える・撒く手触りを変えたら、
       npm run measure で測り直すこと。1回では足りない
     ------------------------------------------------------------ */
  const REACHED = {
    駒: 4, 亀甲: 5, 富士: 30, 扇: 42,
    瓢箪: 13, 松: 22, 三日月: 22, 桜: 5,
    二つ星: 26, 三つ星: 31, 梅鉢: 20, 四つ目: 20,
  };

  /* 難易度は「許し幅のどこまで使ってしまうか」で決める。
     受け止めにくさだけで決めていたときは、瓢箪が◆1つ(いちばん易しい)
     なのに名人の余裕がいちばん薄い、という食い違いが出ていた。
     遊ぶ人が感じるのは、計算上の取りこぼしではなく「線までの余裕」 */
  /* 線引きは、12型の実測 (0.11〜0.62) が 1〜5 に散るように引いた。
     前の線引き (0.30/0.45/0.58/0.70) は、測り方を揃えたあとの値に対して
     粗すぎて、6型が◆3に固まり◆5が一つも出なくなっていた */
  function difficultyOf(name, spillMax) {
    const reached = REACHED[name];
    if (reached === undefined || !spillMax) return 3;   /* 測っていない型は真ん中 */
    const 使う割合 = reached / (spillMax * 100);
    if (使う割合 < 0.20) return 1;
    if (使う割合 < 0.35) return 2;
    if (使う割合 < 0.43) return 3;
    if (使う割合 < 0.51) return 4;
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

  /* 名人を取れた型の数。段位も、箔の鍵も、すべてここから決まる */
  function meijinCount(rec) {
    return Object.values(rec.best).filter((b) => b.rank === "名人").length;
  }

  /* 段位 = 名人を取れた型がいくつあるか。全部の型で名人なら皆伝 */
  const GRADES = ["無位", "初伝", "中伝", "奥伝", "皆伝"];

  function grade(rec, shapeCount) {
    const done = meijinCount(rec);
    if (done <= 0) return { name: GRADES[0], done, of: shapeCount };
    if (done >= shapeCount) return { name: GRADES[4], done, of: shapeCount };
    const step = Math.ceil(shapeCount / 3);
    const i = Math.min(3, 1 + Math.floor((done - 1) / step));
    return { name: GRADES[i], done, of: shapeCount };
  }

  /* ------------------------------------------------------------
     箔の鍵
     ------------------------------------------------------------
     名人を取った型の数で、新しい箔が開く。
     型が12なら、それぞれ 初伝(1) / 中伝(5) / 奥伝(9) に当たる。
     はじめの5色(金箔・銀箔・赤金・青金・焼箔)は取り上げない。
     開くのは、そこへ足す3色。

     塗り絵と同じく、一度開いたら閉じない(段位は記録から出るので、
     つなぎっぱなしだと「記録を消す」で閉じてしまう)
     ------------------------------------------------------------ */
  const FOIL_UNLOCK = [
    { key: "dou",      name: "銅箔",   need: 1 },
    { key: "rokusho",  name: "緑青箔", need: 5 },
    { key: "beniyaki", name: "紅焼箔", need: 9 },
  ];

  /* その箔が開くのに要る名人の数。表に無い箔ははじめから使える */
  function foilNeed(key) {
    const u = FOIL_UNLOCK.find((f) => f.key === key);
    return u ? u.need : 0;
  }

  function foilUnlocked(key, rec, 開いていた) {
    if (開いていた) return true;
    return meijinCount(rec) >= foilNeed(key);
  }

  /* ------------------------------------------------------------
     塗り絵の鍵
     ------------------------------------------------------------
     全部の型で名人 = 皆伝 になったら開く。免許皆伝なので、もう採点は
     要らない ―― 型の下絵だけ借りて、好きなだけ蒔いてよい、という筋。

     一度開いたら閉じない。段位は記録から計算しているので、そのまま
     つなぐと「記録を消す」でせっかく開いた物が閉じてしまう。
     開いたかどうかは記録とは別に持ち、ここでは前の状態を受け取る
     ------------------------------------------------------------ */
  function nurieUnlocked(rec, shapeCount, 開いていた) {
    if (開いていた) return true;
    return grade(rec, shapeCount).name === GRADES[4];
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

  /* ============================================================
     下の余白:ホームバーに掛からないために、どれだけ空けるか
     ------------------------------------------------------------
     ホーム画面から開くと、iOS が渡してくるウェブ画面が画面より短い
     ことがある(実機で 端末932 に対して 描ける873、位置0)。その場合
     ウェブ画面の下端は 873 で終わり、ホームバー(898〜932)には届かない。
     届いていないのに安全域ぶん空けると、34pt がまるまる無駄になる。

     画面を触らない計算なので、ここに置いて node で試す。
     ============================================================ */
  function bottomGap(画面の下端, 端末の高さ, 安全域下) {
    const 下 = Math.max(0, 安全域下 || 0);
    const 重なり = (画面の下端 || 0) - ((端末の高さ || 0) - 下);
    return Math.max(0, Math.min(下, Math.round(重なり)));
  }

  root.KinpakuCore = {
    bottomGap,
    arcPts, profile, polar, circleHalf, circle, toRings,
    ringArea, ringPerimeter,
    area, perimeter, bbox, contains, compactness, normalize, convexHull, concavity,
    SHAPE_DEFS, buildShapes,
    budgetFor, missRatio, spillMaxFor, difficultyOf, judge, rankValue, RANK_ORDER, REACHED,
    emptyRecords, applyResult, grade, reviveRecords, GRADES, nurieUnlocked,
    meijinCount, FOIL_UNLOCK, foilNeed, foilUnlocked,
  };
})(typeof module !== "undefined" && module.exports ? module.exports : (this.window || globalThis));
