/* guitar-kit.js — 吉他乐理教材共用工具（classic script，非 module）
 *
 * 暴露 window.KBG，四块内容：
 *   KBG.theory     纯乐理数据与推导（音名/音程/音阶/和弦/顺阶/调弦），无副作用
 *   KBG.audio      Web Audio 发声（Karplus–Strong 拨弦合成 + 可调失真链）
 *   KBG.fretboard  SVG 指板渲染器（可点击发声、音名/级数标注、任意调弦）
 *   KBG.chordbox   SVG 和弦指法图
 *   KBG.tab        SVG 六线谱 TAB + 播放光标
 *   KBG.soundToggle 页面级「声音开关 + 音量」控件
 *
 * 约定：颜色一律用 CSS 变量（var(--kb-fg) 等）以适配深浅色主题；
 *      AudioContext 只在首次用户手势时创建，任何情况下都不自动播放。
 */
(function () {
  "use strict";
  var KBG = (window.KBG = window.KBG || {});

  /* ================================================================
   * 1. KBG.theory — 乐理真值来源
   * 所有控件与习题共用这一套数据，避免各章各写一份而互相矛盾。
   * ================================================================ */
  var NAMES_SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  var NAMES_FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
  var DEGREES = ["1", "♭2", "2", "♭3", "3", "4", "♭5", "5", "♭6", "6", "♭7", "7"];

  /* 音程：中文名、简写、纯律频率比（用于讲协和度的物理来源） */
  var INTERVALS = [
    { cn: "纯一度", ab: "P1", ratio: "1:1", ratioVal: 1 / 1 },
    { cn: "小二度", ab: "m2", ratio: "16:15", ratioVal: 16 / 15 },
    { cn: "大二度", ab: "M2", ratio: "9:8", ratioVal: 9 / 8 },
    { cn: "小三度", ab: "m3", ratio: "6:5", ratioVal: 6 / 5 },
    { cn: "大三度", ab: "M3", ratio: "5:4", ratioVal: 5 / 4 },
    { cn: "纯四度", ab: "P4", ratio: "4:3", ratioVal: 4 / 3 },
    { cn: "三全音", ab: "TT", ratio: "45:32", ratioVal: 45 / 32 },
    { cn: "纯五度", ab: "P5", ratio: "3:2", ratioVal: 3 / 2 },
    { cn: "小六度", ab: "m6", ratio: "8:5", ratioVal: 8 / 5 },
    { cn: "大六度", ab: "M6", ratio: "5:3", ratioVal: 5 / 3 },
    { cn: "小七度", ab: "m7", ratio: "9:5", ratioVal: 9 / 5 },
    { cn: "大七度", ab: "M7", ratio: "15:8", ratioVal: 15 / 8 },
    { cn: "纯八度", ab: "P8", ratio: "2:1", ratioVal: 2 / 1 }
  ];

  /* 音阶公式（半音数偏移） */
  var SCALES = {
    major: { cn: "大调（自然大调）", steps: [0, 2, 4, 5, 7, 9, 11] },
    naturalMinor: { cn: "自然小调", steps: [0, 2, 3, 5, 7, 8, 10] },
    harmonicMinor: { cn: "和声小调", steps: [0, 2, 3, 5, 7, 8, 11] },
    melodicMinor: { cn: "旋律小调（上行）", steps: [0, 2, 3, 5, 7, 9, 11] },
    ionian: { cn: "伊奥尼亚（＝大调）", steps: [0, 2, 4, 5, 7, 9, 11] },
    dorian: { cn: "多利亚", steps: [0, 2, 3, 5, 7, 9, 10] },
    phrygian: { cn: "弗里几亚", steps: [0, 1, 3, 5, 7, 8, 10] },
    lydian: { cn: "利底亚", steps: [0, 2, 4, 6, 7, 9, 11] },
    mixolydian: { cn: "混合利底亚", steps: [0, 2, 4, 5, 7, 9, 10] },
    aeolian: { cn: "爱奥利亚（＝自然小调）", steps: [0, 2, 3, 5, 7, 8, 10] },
    locrian: { cn: "洛克里亚", steps: [0, 1, 3, 5, 6, 8, 10] },
    phrygianDominant: { cn: "弗里几亚属（和声小调第五级）", steps: [0, 1, 4, 5, 7, 8, 10] },
    majorPentatonic: { cn: "大调五声", steps: [0, 2, 4, 7, 9] },
    minorPentatonic: { cn: "小调五声", steps: [0, 3, 5, 7, 10] },
    blues: { cn: "蓝调音阶", steps: [0, 3, 5, 6, 7, 10] },
    chromatic: { cn: "半音阶", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
  };

  /* 七个自然调式，按「亮 → 暗」排序（第 14 章讲调式色彩用） */
  var MODE_ORDER = ["lydian", "ionian", "mixolydian", "dorian", "aeolian", "phrygian", "locrian"];

  /* 和弦公式 */
  var CHORDS = {
    maj: { cn: "大三和弦", sym: "", steps: [0, 4, 7] },
    min: { cn: "小三和弦", sym: "m", steps: [0, 3, 7] },
    dim: { cn: "减三和弦", sym: "dim", steps: [0, 3, 6] },
    aug: { cn: "增三和弦", sym: "aug", steps: [0, 4, 8] },
    sus2: { cn: "挂二和弦", sym: "sus2", steps: [0, 2, 7] },
    sus4: { cn: "挂四和弦", sym: "sus4", steps: [0, 5, 7] },
    pow: { cn: "强力和弦", sym: "5", steps: [0, 7, 12] },
    maj7: { cn: "大七和弦", sym: "maj7", steps: [0, 4, 7, 11] },
    m7: { cn: "小七和弦", sym: "m7", steps: [0, 3, 7, 10] },
    dom7: { cn: "属七和弦", sym: "7", steps: [0, 4, 7, 10] },
    m7b5: { cn: "半减七和弦", sym: "m7♭5", steps: [0, 3, 6, 10] },
    dim7: { cn: "减七和弦", sym: "dim7", steps: [0, 3, 6, 9] },
    mMaj7: { cn: "小大七和弦", sym: "mMaj7", steps: [0, 3, 7, 11] },
    maj6: { cn: "大六和弦", sym: "6", steps: [0, 4, 7, 9] },
    m6: { cn: "小六和弦", sym: "m6", steps: [0, 3, 7, 9] },
    add9: { cn: "加九和弦", sym: "add9", steps: [0, 4, 7, 14] },
    dom9: { cn: "属九和弦", sym: "9", steps: [0, 4, 7, 10, 14] }
  };

  /* 开放和弦指法库：frets / fingers 索引 0 = 6 弦；-1 = 不弹，0 = 空弦 */
  var VOICINGS = {
    "C":     { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0], rootString: 1 },
    "Cmaj7": { frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0], rootString: 1 },
    "A":     { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0], rootString: 1 },
    "Am":    { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0], rootString: 1 },
    "Am7":   { frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0], rootString: 1 },
    "A7":    { frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0], rootString: 1 },
    "G":     { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3], rootString: 0 },
    "G7":    { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1], rootString: 0 },
    "E":     { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0], rootString: 0 },
    "Em":    { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0], rootString: 0 },
    "Em7":   { frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0], rootString: 0 },
    "E7":    { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0], rootString: 0 },
    "D":     { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2], rootString: 2 },
    "Dm":    { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1], rootString: 2 },
    "D7":    { frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3], rootString: 2 },
    "Dm7":   { frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1], rootString: 2 },
    "F":     { frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], rootString: 0 }
  };

  /* 可移动形状：offsets 是相对根音品位的偏移，null 表示该弦不弹（允许负偏移，
   * 因此不能沿用 -1 当「不弹」的标记）。整体平移即可换根音——这正是
   * 「强力和弦可以平行移动」与「CAGED 五形状通吃十二调」的机制。 */
  var SHAPES = {
    E_maj:  { cn: "E 型大三和弦", rootString: 0, offsets: [0, 2, 2, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1] },
    E_min:  { cn: "E 型小三和弦", rootString: 0, offsets: [0, 2, 2, 0, 0, 0], fingers: [1, 3, 4, 1, 1, 1] },
    E_7:    { cn: "E 型属七",     rootString: 0, offsets: [0, 2, 0, 1, 0, 0], fingers: [1, 3, 1, 2, 1, 1] },
    E_m7:   { cn: "E 型小七",     rootString: 0, offsets: [0, 2, 0, 0, 0, 0], fingers: [1, 3, 1, 1, 1, 1] },
    E_maj7: { cn: "E 型大七",     rootString: 0, offsets: [0, 2, 1, 1, 0, 0], fingers: [1, 3, 2, 2, 1, 1] },
    A_maj:  { cn: "A 型大三和弦", rootString: 1, offsets: [null, 0, 2, 2, 2, 0], fingers: [0, 1, 3, 3, 3, 1] },
    A_min:  { cn: "A 型小三和弦", rootString: 1, offsets: [null, 0, 2, 2, 1, 0], fingers: [0, 1, 3, 4, 2, 1] },
    A_7:    { cn: "A 型属七",     rootString: 1, offsets: [null, 0, 2, 0, 2, 0], fingers: [0, 1, 3, 1, 4, 1] },
    A_m7:   { cn: "A 型小七",     rootString: 1, offsets: [null, 0, 2, 0, 1, 0], fingers: [0, 1, 3, 1, 2, 1] },
    A_maj7: { cn: "A 型大七",     rootString: 1, offsets: [null, 0, 2, 1, 2, 0], fingers: [0, 1, 3, 2, 4, 1] },
    /* CAGED 的另外三个形状：根音不在最低音弦上，且含负偏移 */
    C_maj:  { cn: "C 型大三和弦", rootString: 1, offsets: [null, 0, -1, -3, -2, -3], fingers: [0, 3, 2, 0, 1, 0] },
    G_maj:  { cn: "G 型大三和弦", rootString: 0, offsets: [0, -1, -3, -3, -3, 0], fingers: [2, 1, 0, 0, 0, 3] },
    D_maj:  { cn: "D 型大三和弦", rootString: 2, offsets: [null, null, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
    P6:     { cn: "六弦根强力和弦", rootString: 0, offsets: [0, 2, 2, null, null, null], fingers: [1, 3, 4, 0, 0, 0] },
    P5:     { cn: "五弦根强力和弦", rootString: 1, offsets: [null, 0, 2, 2, null, null], fingers: [0, 1, 3, 4, 0, 0] },
    P4:     { cn: "四弦根强力和弦", rootString: 2, offsets: [null, null, 0, 2, 2, null], fingers: [0, 0, 1, 3, 4, 0] }
  };

  /* 常用调弦（低音弦在前，MIDI 音高；E2 = 40） */
  var TUNINGS = {
    standard: { cn: "标准调弦 EADGBE", notes: [40, 45, 50, 55, 59, 64] },
    dropD: { cn: "Drop D", notes: [38, 45, 50, 55, 59, 64] },
    halfDown: { cn: "降半音 E♭", notes: [39, 44, 49, 54, 58, 63] },
    fullDown: { cn: "降全音 D", notes: [38, 43, 48, 53, 57, 62] },
    dropC: { cn: "Drop C", notes: [36, 43, 48, 53, 57, 62] },
    dropB: { cn: "Drop B", notes: [35, 42, 47, 52, 56, 61] },
    sevenB: { cn: "七弦标准 B", notes: [35, 40, 45, 50, 55, 59, 64] }
  };

  function mod12(n) { return ((n % 12) + 12) % 12; }

  /* 罗马数字用小写表示的和弦性质（含三度为小三度的一族） */
  var MINORISH = { min: 1, dim: 1, m7: 1, m7b5: 1, dim7: 1, mMaj7: 1, m6: 1 };

  var T = {
    NAMES_SHARP: NAMES_SHARP,
    NAMES_FLAT: NAMES_FLAT,
    DEGREES: DEGREES,
    INTERVALS: INTERVALS,
    SCALES: SCALES,
    MODE_ORDER: MODE_ORDER,
    CHORDS: CHORDS,
    TUNINGS: TUNINGS,
    VOICINGS: VOICINGS,
    SHAPES: SHAPES,
    mod12: mod12,

    /* MIDI → 频率（十二平均律，A4 = 69 = 440Hz） */
    freq: function (midi) { return 440 * Math.pow(2, (midi - 69) / 12); },

    /* MIDI → 音名。opts: {flat 用降号, octave 附八度数字} */
    name: function (midi, opts) {
      opts = opts || {};
      var tbl = opts.flat ? NAMES_FLAT : NAMES_SHARP;
      var s = tbl[mod12(midi)];
      return opts.octave ? s + (Math.floor(midi / 12) - 1) : s;
    },

    /* 音名 → MIDI，接受 "A4" "C#3" "E♭2" "Bb2"；无八度数字时返回音级(0–11) */
    midi: function (str) {
      var m = /^([A-Ga-g])([#♯b♭]?)(-?\d+)?$/.exec(String(str).trim());
      if (!m) return null;
      var base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
      if (m[2] === "#" || m[2] === "♯") base += 1;
      if (m[2] === "b" || m[2] === "♭") base -= 1;
      if (m[3] === undefined) return mod12(base);
      return mod12(base) + (parseInt(m[3], 10) + 1) * 12;
    },

    /* 相对 root 的级数标记，如 "♭3"、"5" */
    degree: function (midi, rootPc) { return DEGREES[mod12(midi - rootPc)]; },

    /* 音程信息（0–12 半音；超过八度先折叠） */
    interval: function (semitones) {
      var n = Math.abs(semitones);
      return INTERVALS[n > 12 ? mod12(n) : n];
    },

    /* 音阶音级集合：返回 0–11 的音级数组 */
    scalePcs: function (rootPc, scaleKey) {
      var st = (SCALES[scaleKey] || SCALES.major).steps;
      return st.map(function (s) { return mod12(rootPc + s); });
    },

    /* 和弦构成音（MIDI，从 rootMidi 起叠） */
    chordNotes: function (rootMidi, chordKey) {
      var c = CHORDS[chordKey] || CHORDS.maj;
      return c.steps.map(function (s) { return rootMidi + s; });
    },

    /* 由构成音的音级集合反查和弦性质 key（找不到返回 null） */
    chordKeyOf: function (pcsFromRoot) {
      var want = pcsFromRoot.map(mod12).sort(function (a, b) { return a - b; }).join(",");
      for (var k in CHORDS) {
        if (!CHORDS.hasOwnProperty(k) || k === "pow") continue;
        var got = CHORDS[k].steps.map(mod12).sort(function (a, b) { return a - b; }).join(",");
        if (got === want) return k;
      }
      return null;
    },

    /* 顺阶和弦：在音阶内隔一个音叠三度。size = 3 或 4
     * 返回 [{degree:1, rootPc, key, sym, roman, notes:[pc…]}, …] */
    diatonic: function (rootPc, scaleKey, size) {
      size = size || 3;
      var steps = (SCALES[scaleKey] || SCALES.major).steps;
      var n = steps.length;
      var out = [];
      var ROMAN = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ"];
      for (var i = 0; i < n; i++) {
        var rel = [];
        for (var j = 0; j < size; j++) {
          var idx = i + j * 2;
          rel.push(steps[idx % n] + 12 * Math.floor(idx / n));
        }
        var fromRoot = rel.map(function (s) { return mod12(s - rel[0]); });
        var key = T.chordKeyOf(fromRoot);
        var c = key ? CHORDS[key] : null;
        var rn = ROMAN[i] || String(i + 1);
        var minorish = !!MINORISH[key];
        out.push({
          degree: i + 1,
          rootPc: mod12(rootPc + rel[0]),
          key: key,
          sym: c ? c.sym : "?",
          cn: c ? c.cn : "（非三度叠置）",
          roman: minorish ? rn.toLowerCase() : rn,
          notes: rel.map(function (s) { return mod12(rootPc + s); })
        });
      }
      return out;
    },

    /* 和弦名，如 (9, "m7") → "Am7" */
    chordName: function (rootPc, chordKey, flat) {
      var c = CHORDS[chordKey];
      return T.name(rootPc, { flat: flat }) + (c ? c.sym : "");
    },

    /* 把可移动形状平移到指定根音。返回可直接喂给 KBG.chordbox 的对象。 */
    barre: function (shapeKey, rootPc, tuning) {
      var sh = SHAPES[shapeKey];
      if (!sh) return null;
      tuning = tuning || TUNINGS.standard.notes;
      var base = mod12(rootPc - tuning[sh.rootString]);
      /* 含负偏移的形状（C 型 / G 型）在低把位会算出负品位，整体上移一个八度 */
      var minOff = 99;
      sh.offsets.forEach(function (o) { if (o !== null && o < minOff) minOff = o; });
      while (base + minOff < 0) base += 12;
      var frets = sh.offsets.map(function (o) { return o === null ? -1 : o + base; });
      var pos = frets.filter(function (f) { return f > 0; });
      var lo = pos.length ? Math.min.apply(null, pos) : 1;
      return {
        frets: frets, fingers: sh.fingers.slice(), rootString: sh.rootString,
        baseFret: lo <= 4 ? 1 : lo, cn: sh.cn, rootFret: base
      };
    },

    /* 指法 → 实际发声的 MIDI 列表（跳过打叉的弦），用于 KBG.audio.strum */
    voicingMidis: function (frets, tuning) {
      tuning = tuning || TUNINGS.standard.notes;
      var out = [];
      for (var i = 0; i < frets.length; i++) {
        if (frets[i] >= 0) out.push(tuning[i] + frets[i]);
      }
      return out;
    },

    /* 五度圈：从 C 开始顺时针 12 个大调 [{pc, name, sharps, flats}] */
    circleOfFifths: function () {
      var out = [];
      var SH = ["C", "G", "D", "A", "E", "B", "F♯"];
      var FL = ["C", "F", "B♭", "E♭", "A♭", "D♭", "G♭"];
      for (var i = 0; i < 12; i++) {
        var pc = mod12(i * 7);
        var sharps = i <= 6 ? i : 0;
        var flats = i >= 6 ? 12 - i : 0;
        out.push({
          pc: pc,
          name: i <= 5 ? SH[i] : (i === 6 ? "F♯/G♭" : FL[12 - i]),
          sharps: sharps,
          flats: flats,
          relMinor: NAMES_SHARP[mod12(pc + 9)]
        });
      }
      return out;
    },

    /* 在指板上找出所有属于 pcs 的位置。
     * 返回 [{string, fret, midi, pc}]，string 索引 0 = 最低音弦 */
    findOnBoard: function (tuning, pcs, maxFret, minFret) {
      minFret = minFret || 0;
      maxFret = maxFret == null ? 12 : maxFret;
      var set = {};
      pcs.forEach(function (p) { set[mod12(p)] = true; });
      var out = [];
      for (var s = 0; s < tuning.length; s++) {
        for (var f = minFret; f <= maxFret; f++) {
          var midi = tuning[s] + f;
          if (set[mod12(midi)]) out.push({ string: s, fret: f, midi: midi, pc: mod12(midi) });
        }
      }
      return out;
    }
  };

  KBG.theory = T;

  /* ================================================================
   * 2. KBG.audio — 发声引擎
   * 音色用 Karplus–Strong 算法离线合成（噪声激励 + 衰减延迟线），
   * 结果缓存成 AudioBuffer，比正弦波像吉他得多，且不依赖任何采样文件。
   * 信号链：BufferSource → 音量 → 通道(失真 → 低通 → 高通 → 补偿 → 音量 → 声像) → 总音量 → 分析器
   * 通道可实例化（KBG.audio.channel），多轨编曲每轨走一条独立通道。
   * ================================================================ */
  var ctx = null, master = null, ana = null, main = null;
  var bufCache = {};
  var live = [];          // 正在发声的节点，供 stopAll 掐断
  var timers = [];        // 待触发的 setTimeout，供 stopAll 清理
  var enabled = true, volume = 0.5;

  /* 一条通道 ＝ input → 失真 → 低通(箱体) → 高通 → 补偿 → 音量 → 声像 → master
   * 多轨编曲需要每轨独立的失真/音量/声像，所以信号链被做成可实例化的「通道」。
   * 默认通道 main 的行为与单通道时代完全一致，旧页面无需改动。 */
  function makeChain(opts) {
    opts = opts || {};
    var ch = {
      drive: opts.drive == null ? 0 : opts.drive,
      lpOpen: opts.lp == null ? 6000 : opts.lp,      // drive 为 0 时的低通截止
      input: ctx.createGain(),
      shaper: ctx.createWaveShaper(),
      lp: ctx.createBiquadFilter(),
      hp: ctx.createBiquadFilter(),
      post: ctx.createGain(),
      vol: ctx.createGain(),
      pan: ctx.createStereoPanner ? ctx.createStereoPanner() : null
    };
    ch.shaper.oversample = "4x";
    ch.lp.type = "lowpass"; ch.lp.frequency.value = ch.lpOpen;
    ch.hp.type = "highpass"; ch.hp.frequency.value = opts.hp == null ? 85 : opts.hp;
    ch.post.gain.value = 1;
    ch.vol.gain.value = opts.gain == null ? 1 : opts.gain;
    ch.input.connect(ch.shaper); ch.shaper.connect(ch.lp);
    ch.lp.connect(ch.hp); ch.hp.connect(ch.post); ch.post.connect(ch.vol);
    if (ch.pan) { ch.pan.pan.value = opts.pan == null ? 0 : opts.pan; ch.vol.connect(ch.pan); ch.pan.connect(master); }
    else ch.vol.connect(master);
    applyDrive(ch);
    return ch;
  }

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = volume;
    master.connect(ctx.destination);
    main = makeChain({ drive: 0 });
    return ctx;
  }

  /* drive 0 → 完全干净（旁路整形器）；1 → 高增益近似硬削波 */
  function applyDrive(ch) {
    if (!ch) return;
    var d = ch.drive;
    if (d <= 0.001) {
      ch.shaper.curve = null;
      ch.lp.frequency.value = ch.lpOpen;
      ch.post.gain.value = 1;
      return;
    }
    var k = 0.6 + d * 26;
    var n = 1024, curve = new Float32Array(n), norm = Math.tanh(k);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    ch.shaper.curve = curve;
    ch.lp.frequency.value = 5200 - 2000 * d;   // 增益越大越需要箱体滚降压住毛刺
    ch.post.gain.value = 1 / (1 + 2.2 * d);    // 补偿削波带来的响度提升
  }

  /* Karplus–Strong：生成一次拨弦的波形 */
  function ksBuffer(midi, mute) {
    var c = ensure();
    var sr = c.sampleRate;
    var f = T.freq(midi);
    var N = Math.max(2, Math.round(sr / f));
    var t60 = mute ? 0.17 : 2.4;                // 闷音（palm mute）衰减极快
    var dur = mute ? 0.32 : 2.7;
    var len = Math.round(sr * dur);
    var damp = Math.exp(-6.9078 / (f * t60));
    var buf = c.createBuffer(1, len, sr);
    var out = buf.getChannelData(0);

    /* 确定性伪随机，保证同一个音每次听起来一致 */
    var seed = (midi * 7919 + 104729) >>> 0;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; }

    var line = new Float32Array(N), prev = 0, i;
    for (i = 0; i < N; i++) { prev = 0.6 * rnd() + 0.4 * prev; line[i] = prev; }
    /* 拨片位置梳状滤波：在弦长约 13% 处拨弦，抵消该处的谐波，音色更亮 */
    var off = Math.max(1, Math.round(N * 0.13));
    var tmp = new Float32Array(N);
    for (i = 0; i < N; i++) tmp[i] = line[i] - 0.55 * line[(i + off) % N];
    var mx = 0;
    for (i = 0; i < N; i++) mx = Math.max(mx, Math.abs(tmp[i]));
    if (mx > 0) for (i = 0; i < N; i++) line[i] = (tmp[i] / mx) * (mute ? 0.75 : 0.95);

    var idx = 0;
    for (var n = 0; n < len; n++) {
      var cur = line[idx];
      out[n] = cur;
      line[idx] = damp * 0.5 * (cur + line[(idx + 1) % N]);
      idx = (idx + 1) % N;
    }
    /* 起音 2ms 淡入、收尾 25ms 淡出，避免爆音 */
    var aN = Math.round(sr * 0.002), fN = Math.round(sr * 0.025);
    for (i = 0; i < aN && i < len; i++) out[i] *= i / aN;
    for (i = 0; i < fN && i < len; i++) out[len - 1 - i] *= i / fN;
    /* 环路的有效长度不是 N 而是 N − 0.5：循环里的两点平均取的是「下一个」采样，
     * 相当于半个采样的负延迟。加上 N 只能取整，未校正时高音区会偏高 40 多音分。
     * 这里缓存目标基频与实际基频之比，播放时用 playbackRate 精确校正——
     * 本教材要讲「14 音分听得出来」，音准不能自己先塌。 */
    return { buf: buf, rate: f * (N - 0.5) / sr };
  }

  function getBuffer(midi, mute) {
    var key = midi + (mute ? "m" : "n");
    if (!bufCache[key]) bufCache[key] = ksBuffer(midi, mute);
    return bufCache[key];
  }

  function track(node) {
    live.push(node);
    node.onended = function () {
      var i = live.indexOf(node);
      if (i >= 0) live.splice(i, 1);
    };
  }

  var A = {
    /* 是否已经出过声（用于提示用户点一下才有声音） */
    started: function () { return !!ctx; },

    /* 下面三个供 band-kit 这类扩展库接入同一条总线与生命周期管理 */
    ctx: function () { return ensure(); },              // 取（必要时创建）AudioContext
    busInput: function () { var c = ensure(); return c ? main.input : null; },  // 默认通道入口
    track: function (n) { track(n); },                  // 注册节点，纳入 stopAll 管理

    now: function () { var c = ensure(); return c ? c.currentTime : 0; },
    isEnabled: function () { return enabled; },
    setEnabled: function (v) { enabled = !!v; if (!enabled) A.stopAll(); },
    getVolume: function () { return volume; },
    setVolume: function (v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = volume; },
    getDrive: function () { return main ? main.drive : 0; },
    setDrive: function (d) {
      var c = ensure(); if (!c) return;
      main.drive = Math.max(0, Math.min(1, d)); applyDrive(main);
    },

    /* 新建一条独立通道：多轨编曲里每个声部走一条，各自有失真/音量/声像。
     * opts: {drive, gain, pan, lp, hp}。lp 默认 6000（吉他箱体感），
     * 鼓这类需要高频的声部传 lp:18000、hp:20 即可得到接近直通的链路。 */
    channel: function (opts) {
      var c = ensure(); if (!c) return null;
      var ch = makeChain(opts);
      return {
        _chain: ch,
        input: ch.input,
        getDrive: function () { return ch.drive; },
        setDrive: function (d) { ch.drive = Math.max(0, Math.min(1, d)); applyDrive(ch); },
        getGain: function () { return ch.vol.gain.value; },
        setGain: function (g) { ch.vol.gain.value = Math.max(0, g); },
        getPan: function () { return ch.pan ? ch.pan.pan.value : 0; },
        setPan: function (v) { if (ch.pan) ch.pan.pan.value = Math.max(-1, Math.min(1, v)); },
        hasPan: !!ch.pan,
        dispose: function () { try { ch.vol.disconnect(); if (ch.pan) ch.pan.disconnect(); } catch (e) { /* 已断开 */ } }
      };
    },

    /* 分析器节点（频谱/波形可视化用），首次调用时插入到总线末端 */
    analyser: function () {
      var c = ensure(); if (!c) return null;
      if (!ana) {
        ana = c.createAnalyser();
        ana.fftSize = 4096;
        ana.smoothingTimeConstant = 0.75;
        master.disconnect();
        master.connect(ana);
        ana.connect(c.destination);
      }
      return ana;
    },

    /* 拨响一个音。opts: {delay 相对秒, at 绝对时刻, dur 秒(截断), gain, mute 闷音} */
    pluck: function (midi, opts) {
      opts = opts || {};
      if (!enabled) return null;
      var c = ensure(); if (!c) return null;
      if (c.state === "suspended" && c.resume) c.resume();
      var when = opts.at != null ? opts.at : c.currentTime + Math.max(0, opts.delay || 0);
      var rec = getBuffer(Math.round(midi), !!opts.mute);
      var src = c.createBufferSource();
      src.buffer = rec.buf;
      if (src.playbackRate) src.playbackRate.value = rec.rate;
      if (opts.detune && src.detune) src.detune.value = opts.detune;
      /* 推弦：把 playbackRate 从原速斜升到目标半音数（比 detune 兼容性好）。
       * opts.bend = {semitones, time 秒, delay 秒, hold 秒, release true 表示放回} */
      if (opts.bend && src.playbackRate) {
        var bd = opts.bend, pr = src.playbackRate;
        var up = rec.rate * Math.pow(2, (bd.semitones || 2) / 12);
        var t0 = when + (bd.delay == null ? 0.14 : bd.delay);
        var t1 = t0 + (bd.time == null ? 0.22 : bd.time);
        pr.setValueAtTime(rec.rate, t0);
        pr.linearRampToValueAtTime(up, t1);
        if (bd.release) {
          var t2 = t1 + (bd.hold == null ? 0.3 : bd.hold);
          pr.setValueAtTime(up, t2);
          pr.linearRampToValueAtTime(rec.rate, t2 + (bd.time == null ? 0.22 : bd.time));
        }
      }
      /* 揉弦：用一个低频振荡器调制 playbackRate。opts.vibrato = {cents, hz, delay} */
      if (opts.vibrato && src.playbackRate) {
        var vb = opts.vibrato;
        var lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = vb.hz || 5.5;
        lg.gain.value = rec.rate * (Math.pow(2, (vb.cents || 45) / 1200) - 1);
        lfo.connect(lg); lg.connect(src.playbackRate);
        lfo.start(when + (vb.delay == null ? 0.18 : vb.delay));
        lfo.stop(when + (opts.dur || 2.4));
        track(lfo);
      }
      var g = c.createGain();
      g.gain.value = opts.gain == null ? 0.8 : opts.gain;
      var dest = (opts.channel && opts.channel.input) ? opts.channel.input : main.input;
      src.connect(g); g.connect(dest);
      src.start(when);
      if (opts.dur) {
        g.gain.setValueAtTime(g.gain.value, when + opts.dur);
        g.gain.linearRampToValueAtTime(0.0001, when + opts.dur + 0.06);
        src.stop(when + opts.dur + 0.08);
      }
      track(src);
      return src;
    },

    /* 扫弦：midis 从低到高，spread 为相邻弦的时间差（秒），up=true 则从高到低 */
    strum: function (midis, opts) {
      opts = opts || {};
      var spread = opts.spread == null ? 0.028 : opts.spread;
      var list = opts.up ? midis.slice().reverse() : midis.slice();
      var base = opts.at != null ? opts.at : A.now() + (opts.delay || 0);
      var out = [];
      for (var i = 0; i < list.length; i++) {
        out.push(A.pluck(list[i], {
          at: base + i * spread, gain: opts.gain == null ? 0.62 : opts.gain,
          mute: opts.mute, dur: opts.dur, channel: opts.channel, detune: opts.detune
        }));
      }
      return out;
    },

    /* 按拍序播放。events: [{t 拍, midi|midis, dur 拍, mute, gain, spread}]
     * opts: {bpm, loop, lengthBeats, onLoop}
     * 返回 {stop(), position() 当前拍数, beats 总拍数} */
    sequence: function (events, opts) {
      opts = opts || {};
      if (!enabled) return { stop: function () {}, position: function () { return 0; }, beats: 0 };
      var c = ensure(); if (!c) return { stop: function () {}, position: function () { return 0; }, beats: 0 };
      if (c.state === "suspended" && c.resume) c.resume();
      var spb = 60 / (opts.bpm || 100);
      var beats = opts.lengthBeats || events.reduce(function (m, e) {
        return Math.max(m, e.t + (e.dur || 1));
      }, 0);
      var start = c.currentTime + 0.08;
      var stopped = false;

      function fire(cycleStart) {
        events.forEach(function (e) {
          var at = cycleStart + e.t * spb;
          var chan = e.channel || opts.channel;
          var o = {
            at: at, gain: e.gain, mute: e.mute, channel: chan,
            dur: e.dur ? e.dur * spb * 0.98 : undefined, detune: e.detune,
            bend: e.bend, vibrato: e.vibrato
          };
          if (e.midis) A.strum(e.midis, { at: at, gain: e.gain, mute: e.mute, spread: e.spread, dur: o.dur, channel: chan, detune: e.detune });
          else if (e.midi != null) A.pluck(e.midi, o);
          else if (e.play) e.play(at);          /* 任意自定义发声（鼓等），由 band-kit 使用 */
        });
      }
      function cycle(cycleStart) {
        if (stopped) return;
        fire(cycleStart);
        if (opts.loop) {
          var next = cycleStart + beats * spb;
          var ms = Math.max(20, (next - c.currentTime - 0.15) * 1000);
          timers.push(setTimeout(function () {
            if (opts.onLoop) opts.onLoop();
            cycle(next);
          }, ms));
        }
      }
      cycle(start);
      return {
        beats: beats,
        stop: function () { stopped = true; A.stopAll(); },
        position: function () {
          var p = (c.currentTime - start) / spb;
          if (p < 0) return 0;
          return opts.loop ? p % beats : Math.min(p, beats);
        }
      };
    },

    /* 节拍器：绕过失真链直接进总线。pattern 为每拍是否重音的数组，如 [1,0,0,0] */
    metronome: function (bpm, opts) {
      opts = opts || {};
      if (!enabled) return { stop: function () {} };
      var c = ensure(); if (!c) return { stop: function () {} };
      if (c.state === "suspended" && c.resume) c.resume();
      var pattern = opts.pattern || [1, 0, 0, 0];
      var spb = 60 / (bpm || 100);
      var beat = 0, next = c.currentTime + 0.06, stopped = false;
      function click(at, accent) {
        var o = c.createOscillator(); o.type = "square";
        o.frequency.value = accent ? 1760 : 1174;
        var g = c.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(accent ? 0.34 : 0.18, at + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
        o.connect(g); g.connect(master);
        o.start(at); o.stop(at + 0.07);
        track(o);
      }
      var iv = setInterval(function () {
        if (stopped) return;
        while (next < c.currentTime + 0.25) {
          click(next, !!pattern[beat % pattern.length]);
          if (opts.onBeat) {
            var b = beat, when = next;
            timers.push(setTimeout(function () {
              if (!stopped) opts.onBeat(b % pattern.length, b);
            }, Math.max(0, (when - c.currentTime) * 1000)));
          }
          beat++; next += spb;
        }
      }, 40);
      timers.push(iv);
      return { stop: function () { stopped = true; clearInterval(iv); } };
    },

    stopAll: function () {
      timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
      timers.length = 0;
      live.slice().forEach(function (n) { try { n.stop(0); } catch (e) { /* 已结束 */ } });
      live.length = 0;
    }
  };

  KBG.audio = A;

  /* 切走标签页 / 离开本页时不留残声 */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) A.stopAll();
  });
  window.addEventListener("pagehide", function () { A.stopAll(); });

  /* ================================================================
   * 3. 视觉组件（全部 SVG，颜色取 CSS 变量以适配深浅色主题）
   * 标记点用固定饱和色 + 白字，保证两种主题下都读得清。
   * ================================================================ */
  var NS = "http://www.w3.org/2000/svg";
  var MARK_COLORS = {
    root: "#dc2626", note: "#2563eb", third: "#16a34a",
    warm: "#d97706", purple: "#8b5cf6", ghost: null
  };
  var INLAYS = { 3: 1, 5: 1, 7: 1, 9: 1, 12: 2, 15: 1, 17: 1, 19: 1, 21: 1, 24: 2 };

  function el(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k) && attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function wrap(host, svg, maxW) {
    var box = document.createElement("div");
    box.style.cssText = "overflow-x:auto;max-width:100%;";
    svg.style.cssText = "width:100%;height:auto;display:block;min-width:" +
      Math.min(maxW, 520) + "px;max-width:" + maxW + "px;margin:0 auto;";
    box.appendChild(svg);
    host.appendChild(box);
    return box;
  }

  /* ---------------- 3.1 指板 ----------------
   * KBG.fretboard(host, {tuning, fromFret, toFret, showOpen, labels, root,
   *                      marks, clickable, onClick, title})
   *   tuning  MIDI 数组，索引 0 = 最低音弦（6 弦）
   *   labels  "name" | "degree" | "none" | function(midi, string, fret)
   *   marks   [{string, fret, kind, label}]，kind 见 MARK_COLORS
   * 返回 {setMarks, setLabels, flash, destroy, tuning, svg}
   *   换调弦请 destroy() 后重建（第 15 章用），指板几何会随弦数一起变。
   */
  KBG.fretboard = function (host, opts) {
    opts = opts || {};
    var tuning = (opts.tuning || TUNINGS.standard.notes).slice();
    var from = opts.fromFret == null ? 1 : opts.fromFret;
    var to = opts.toFret == null ? 12 : opts.toFret;
    var showOpen = opts.showOpen !== false;
    var labels = opts.labels || "name";
    var root = opts.root == null ? 0 : opts.root;
    var marks = opts.marks || [];

    var FW = 60, SH = 28, PADL = 30, PADR = 12, PADT = 24, PADB = 26;
    var OPENW = showOpen ? 38 : 0;
    var nS = tuning.length, nF = to - from + 1;
    var bx = PADL + OPENW, bw = nF * FW;
    var W = bx + bw + PADR, H = PADT + (nS - 1) * SH + PADB;

    var svg = el("svg", {
      viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": opts.title || "吉他指板图"
    });
    svg.setAttribute("font-family", "-apple-system, PingFang SC, sans-serif");
    var gStatic = el("g"), gMarks = el("g"), gHit = el("g");

    function yOf(s) { return PADT + (nS - 1 - s) * SH; }      // s=0 是最低音弦，画在最下方
    function xOf(f) { return f === 0 ? PADL + OPENW / 2 : bx + (f - from + 0.5) * FW; }

    /* 琴颈底板 */
    gStatic.appendChild(el("rect", {
      x: bx, y: yOf(nS - 1) - 10, width: bw, height: (nS - 1) * SH + 20,
      rx: 4, fill: "var(--kb-surface-alt)"
    }));
    /* 品格线与品记 */
    for (var f = from; f <= to + 1; f++) {
      var x = bx + (f - from) * FW;
      var isNut = (f === 1);
      gStatic.appendChild(el("line", {
        x1: x, y1: yOf(nS - 1) - 10, x2: x, y2: yOf(0) + 10,
        stroke: isNut ? "var(--kb-fg)" : "var(--kb-border-strong)",
        "stroke-width": isNut ? 5 : 2, "stroke-linecap": "round"
      }));
    }
    for (var f2 = from; f2 <= to; f2++) {
      if (INLAYS[f2]) {
        var cy = PADT + ((nS - 1) * SH) / 2;
        if (INLAYS[f2] === 1) {
          gStatic.appendChild(el("circle", { cx: xOf(f2), cy: cy, r: 5, fill: "var(--kb-fg-faint)", opacity: "0.5" }));
        } else {
          gStatic.appendChild(el("circle", { cx: xOf(f2), cy: cy - SH * 0.8, r: 5, fill: "var(--kb-fg-faint)", opacity: "0.5" }));
          gStatic.appendChild(el("circle", { cx: xOf(f2), cy: cy + SH * 0.8, r: 5, fill: "var(--kb-fg-faint)", opacity: "0.5" }));
        }
      }
      gStatic.appendChild(el("text", {
        x: xOf(f2), y: H - 8, "text-anchor": "middle", "font-size": 11,
        fill: "var(--kb-fg-muted)"
      }, String(f2)));
    }
    /* 琴弦（低音弦画粗）与左侧空弦音名 */
    for (var s = 0; s < nS; s++) {
      var y = yOf(s);
      gStatic.appendChild(el("line", {
        x1: showOpen ? PADL : bx, y1: y, x2: bx + bw, y2: y,
        stroke: "var(--kb-fg-muted)", "stroke-width": 1 + (nS - 1 - s) * 0.28
      }));
      gStatic.appendChild(el("text", {
        x: PADL - 6, y: y + 4, "text-anchor": "end", "font-size": 11.5,
        fill: "var(--kb-fg-muted)", "font-weight": 600
      }, T.name(tuning[s])));
    }
    if (showOpen) {
      gStatic.appendChild(el("text", {
        x: PADL + OPENW / 2, y: H - 8, "text-anchor": "middle",
        "font-size": 11, fill: "var(--kb-fg-muted)"
      }, "0"));
    }

    function labelFor(midi, s, f) {
      if (labels === "none") return "";
      if (typeof labels === "function") return labels(midi, s, f);
      if (labels === "degree") return T.degree(midi, root);
      return T.name(midi);
    }

    function drawMarks() {
      while (gMarks.firstChild) gMarks.removeChild(gMarks.firstChild);
      marks.forEach(function (m) {
        if (m.fret < (showOpen ? 0 : from) || m.fret > to) return;
        if (m.fret > 0 && m.fret < from) return;
        var midi = tuning[m.string] + m.fret;
        var color = MARK_COLORS[m.kind || "note"];
        var cx = xOf(m.fret), cy = yOf(m.string);
        var r = m.r || 11.5;
        var g = el("g");
        g.appendChild(el("circle", {
          cx: cx, cy: cy, r: r,
          fill: color || "var(--kb-surface)",
          stroke: color || "var(--kb-fg-faint)",
          "stroke-width": color ? 0 : 1.5,
          "stroke-dasharray": color ? null : "3 2"
        }));
        var txt = m.label != null ? m.label : labelFor(midi, m.string, m.fret);
        if (txt) {
          g.appendChild(el("text", {
            x: cx, y: cy + 3.8, "text-anchor": "middle", "font-size": txt.length > 2 ? 9 : 10.5,
            "font-weight": 700, fill: color ? "#fff" : "var(--kb-fg-muted)"
          }, txt));
        }
        gMarks.appendChild(g);
      });
    }

    /* 点击热区：整块品格 × 弦 */
    function buildHits() {
      while (gHit.firstChild) gHit.removeChild(gHit.firstChild);
      if (!opts.clickable) return;
      for (var s = 0; s < nS; s++) {
        var lo = showOpen ? 0 : from;
        for (var f = lo; f <= to; f++) {
          if (f > 0 && f < from) continue;
          var w = f === 0 ? OPENW : FW;
          var r = el("rect", {
            x: xOf(f) - w / 2, y: yOf(s) - SH / 2, width: w, height: SH,
            fill: "transparent", style: "cursor:pointer"
          });
          r.setAttribute("data-s", s); r.setAttribute("data-f", f);
          gHit.appendChild(r);
        }
      }
    }
    if (opts.clickable) {
      gHit.addEventListener("click", function (e) {
        var t = e.target;
        if (!t.hasAttribute || !t.hasAttribute("data-s")) return;
        var s = +t.getAttribute("data-s"), f = +t.getAttribute("data-f");
        var midi = tuning[s] + f;
        if (opts.onClick) opts.onClick({ string: s, fret: f, midi: midi, name: T.name(midi), pc: mod12(midi) });
      });
    }

    svg.appendChild(gStatic); svg.appendChild(gMarks); svg.appendChild(gHit);
    drawMarks(); buildHits();
    var box = wrap(host, svg, W);

    return {
      svg: svg,
      destroy: function () { if (box.parentNode) box.parentNode.removeChild(box); },
      tuning: function () { return tuning.slice(); },
      setMarks: function (m) { marks = m || []; drawMarks(); },
      setLabels: function (l, newRoot) {
        labels = l; if (newRoot != null) root = newRoot; drawMarks();
      },
      /* 短暂高亮一个位置（点击反馈） */
      flash: function (s, f, kind) {
        var c = el("circle", {
          cx: xOf(f), cy: yOf(s), r: 15, fill: "none",
          stroke: MARK_COLORS[kind || "root"], "stroke-width": 3, opacity: "0.95"
        });
        gMarks.appendChild(c);
        var t0 = null;
        function step(ts) {
          if (t0 === null) t0 = ts;
          var k = (ts - t0) / 420;
          if (k >= 1) { if (c.parentNode) c.parentNode.removeChild(c); return; }
          c.setAttribute("r", 15 + k * 9);
          c.setAttribute("opacity", String(0.95 * (1 - k)));
          requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      }
    };
  };

  /* ---------------- 3.2 和弦指法图 ----------------
   * KBG.chordbox(host, {frets:[-1,3,2,0,1,0], fingers, baseFret, title, rootString})
   *   frets 索引 0 = 最低音弦；-1 = 不弹(×)，0 = 空弦(○)
   */
  KBG.chordbox = function (host, opts) {
    opts = opts || {};
    var frets = opts.frets || [];
    var fingers = opts.fingers || [];
    var base = opts.baseFret || 1;
    var nS = frets.length, nF = opts.rows || 5;
    var SW = 22, FH = 26, PADL = 20, PADT = 34, PADR = 20, PADB = 16;
    var W = PADL + (nS - 1) * SW + PADR, H = PADT + nF * FH + PADB;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": (opts.title || "和弦") + " 指法图" });
    svg.setAttribute("font-family", "-apple-system, PingFang SC, sans-serif");

    if (opts.title) {
      svg.appendChild(el("text", {
        x: W / 2, y: 15, "text-anchor": "middle", "font-size": 14,
        "font-weight": 700, fill: "var(--kb-fg)"
      }, opts.title));
    }
    var x0 = PADL, y0 = PADT;
    for (var i = 0; i < nS; i++) {
      svg.appendChild(el("line", {
        x1: x0 + i * SW, y1: y0, x2: x0 + i * SW, y2: y0 + nF * FH,
        stroke: "var(--kb-fg-muted)", "stroke-width": 1.1
      }));
    }
    for (var j = 0; j <= nF; j++) {
      var isNut = (j === 0 && base === 1);
      svg.appendChild(el("line", {
        x1: x0, y1: y0 + j * FH, x2: x0 + (nS - 1) * SW, y2: y0 + j * FH,
        stroke: isNut ? "var(--kb-fg)" : "var(--kb-border-strong)",
        "stroke-width": isNut ? 4.5 : 1.1
      }));
    }
    if (base > 1) {
      svg.appendChild(el("text", {
        x: x0 - 8, y: y0 + FH * 0.7, "text-anchor": "end", "font-size": 11,
        fill: "var(--kb-fg-muted)", "font-weight": 600
      }, base + "fr"));
    }
    frets.forEach(function (fv, s) {
      var cx = x0 + s * SW;
      if (fv < 0 || fv === 0) {
        svg.appendChild(el("text", {
          x: cx, y: y0 - 7, "text-anchor": "middle", "font-size": 12,
          fill: fv < 0 ? "var(--kb-fg-faint)" : "var(--kb-fg-muted)", "font-weight": 700
        }, fv < 0 ? "×" : "○"));
        return;
      }
      var row = fv - base;
      if (row < 0 || row >= nF) return;
      var cy = y0 + row * FH + FH / 2;
      var isRoot = opts.rootString === s;
      svg.appendChild(el("circle", {
        cx: cx, cy: cy, r: 8.5, fill: isRoot ? MARK_COLORS.root : MARK_COLORS.note
      }));
      if (fingers[s]) {
        svg.appendChild(el("text", {
          x: cx, y: cy + 3.5, "text-anchor": "middle", "font-size": 10,
          "font-weight": 700, fill: "#fff"
        }, String(fingers[s])));
      }
    });
    wrap(host, svg, W);
    return { svg: svg };
  };

  /* ---------------- 3.3 六线谱 TAB ----------------
   * KBG.tab(host, {tuning, columns, labelMode, root, title})
   *   columns: [{notes:[{string, fret}], dur 拍, mute 闷音, tech 技法记号, label 上方标注}]
   * 返回 {setCursor(i|null), columns, svg}
   */
  KBG.tab = function (host, opts) {
    opts = opts || {};
    var tuning = opts.tuning || TUNINGS.standard.notes;
    var cols = opts.columns || [];
    var nS = tuning.length;
    var labelMode = opts.labelMode || "none";
    var root = opts.root == null ? 0 : opts.root;

    var LH = 15, PADL = 26, PADT = opts.title ? 40 : 26, PADR = 14, PADB = 14;
    var widths = cols.map(function (c) { return Math.max(26, Math.round(28 * (c.dur || 1))); });
    var xs = [], acc = PADL;
    widths.forEach(function (w) { xs.push(acc); acc += w; });
    var W = acc + PADR, H = PADT + (nS - 1) * LH + PADB + 14;

    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": opts.title || "六线谱 TAB" });
    svg.setAttribute("font-family", "ui-monospace, SFMono-Regular, Menlo, monospace");
    if (opts.title) {
      svg.appendChild(el("text", {
        x: PADL, y: 16, "font-size": 12.5, "font-weight": 700, fill: "var(--kb-fg)",
        "font-family": "-apple-system, PingFang SC, sans-serif"
      }, opts.title));
    }
    var gCur = el("g");
    svg.appendChild(gCur);
    function yOf(s) { return PADT + (nS - 1 - s) * LH; }   // s=0 最低音弦 → 最下面一线

    for (var s = 0; s < nS; s++) {
      svg.appendChild(el("line", {
        x1: PADL - 4, y1: yOf(s), x2: W - PADR + 4, y2: yOf(s),
        stroke: "var(--kb-border-strong)", "stroke-width": 1
      }));
      svg.appendChild(el("text", {
        x: PADL - 8, y: yOf(s) + 3.5, "text-anchor": "end", "font-size": 9.5,
        fill: "var(--kb-fg-faint)"
      }, T.name(tuning[s]).replace("♯", "#")));
    }

    cols.forEach(function (c, i) {
      var cx = xs[i] + widths[i] / 2;
      (c.notes || []).forEach(function (n) {
        var txt = String(n.fret) + (c.tech && n.tech !== false ? "" : "");
        var w = txt.length * 6.6 + 4;
        svg.appendChild(el("rect", {
          x: cx - w / 2, y: yOf(n.string) - 6.5, width: w, height: 13,
          fill: "var(--kb-surface)"
        }));
        svg.appendChild(el("text", {
          x: cx, y: yOf(n.string) + 4, "text-anchor": "middle", "font-size": 11.5,
          "font-weight": 700, fill: c.mute ? "var(--kb-fg-muted)" : "var(--kb-fg)"
        }, txt));
      });
      var top = "";
      if (c.label) top = c.label;
      else if (labelMode !== "none" && c.notes && c.notes.length) {
        var m = tuning[c.notes[0].string] + c.notes[0].fret;
        top = labelMode === "degree" ? T.degree(m, root) : T.name(m);
      }
      if (c.mute) top = (top ? top + " " : "") + "PM";
      if (top) {
        svg.appendChild(el("text", {
          x: cx, y: PADT - 9, "text-anchor": "middle", "font-size": 9.5,
          fill: "var(--kb-accent)", "font-family": "-apple-system, PingFang SC, sans-serif"
        }, top));
      }
      if (c.tech) {
        svg.appendChild(el("text", {
          x: cx, y: yOf(0) + 12, "text-anchor": "middle", "font-size": 9.5,
          fill: "var(--kb-fg-muted)"
        }, c.tech));
      }
    });

    var cursor = el("rect", {
      x: 0, y: PADT - 20, width: 0, height: (nS - 1) * LH + 30,
      fill: "var(--kb-accent)", opacity: "0.14", rx: 3
    });
    gCur.appendChild(cursor);
    wrap(host, svg, W);

    return {
      svg: svg, columns: cols,
      setCursor: function (i) {
        if (i == null || i < 0 || i >= cols.length) { cursor.setAttribute("width", 0); return; }
        cursor.setAttribute("x", xs[i]);
        cursor.setAttribute("width", widths[i]);
      },
      /* 把 TAB 转成 KBG.audio.sequence 可播放的事件序列 */
      events: function () {
        var t = 0, out = [];
        cols.forEach(function (c, i) {
          var ns = (c.notes || []).map(function (n) { return tuning[n.string] + n.fret; });
          if (ns.length === 1) out.push({ t: t, midi: ns[0], dur: c.dur || 1, mute: c.mute, i: i });
          else if (ns.length > 1) out.push({ t: t, midis: ns, dur: c.dur || 1, mute: c.mute, spread: 0.012, i: i });
          t += c.dur || 1;
        });
        return out;
      },
      /* 每列的起始拍，供光标定位 */
      beatsOf: function () {
        var t = 0, out = [];
        cols.forEach(function (c) { out.push(t); t += c.dur || 1; });
        return out;
      }
    };
  };

  /* ---------------- 3.4 声音开关 ----------------
   * 每章第一个演示上方放一个，统一控制发声与音量。 */
  var toggles = [];
  KBG.soundToggle = function (host, opts) {
    opts = opts || {};
    var row = document.createElement("div");
    row.className = "kb-interactive-controls";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kb-btn";
    var lab = document.createElement("label");
    lab.className = "kb-control";
    lab.appendChild(document.createTextNode("音量"));
    var val = document.createElement("span");
    val.className = "kb-control-value";
    lab.appendChild(val);
    var rng = document.createElement("input");
    rng.type = "range"; rng.min = "0"; rng.max = "1"; rng.step = "0.05";
    rng.value = String(A.getVolume());
    lab.appendChild(rng);

    var hint = document.createElement("span");
    hint.style.cssText = "font-size:0.86em;color:var(--kb-fg-muted);align-self:center;";
    hint.textContent = opts.hint || "戴耳机效果更好；浏览器要求先点一下页面才会出声。";

    function sync() {
      btn.textContent = A.isEnabled() ? "🔊 声音：开" : "🔇 声音：关";
      btn.setAttribute("aria-pressed", A.isEnabled() ? "true" : "false");
      val.textContent = Math.round(A.getVolume() * 100) + "%";
      rng.value = String(A.getVolume());
    }
    btn.addEventListener("click", function () {
      A.setEnabled(!A.isEnabled());
      toggles.forEach(function (f) { f(); });
    });
    rng.addEventListener("input", function () {
      A.setVolume(parseFloat(rng.value));
      toggles.forEach(function (f) { f(); });
    });
    toggles.push(sync);
    sync();

    row.appendChild(btn); row.appendChild(lab); row.appendChild(hint);
    host.appendChild(row);
    return { el: row, sync: sync };
  };
})();
