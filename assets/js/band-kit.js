/* band-kit.js — 乐队编曲教材共用工具（classic script，非 module）
 *
 * 依赖 guitar-kit.js（window.KBG）。暴露 window.KBB：
 *   KBB.drums     合成鼓组（底鼓/军鼓/闭镲/开镲/嗵鼓/叮叮/擦片）
 *   KBB.bass      贝斯音色（Karplus–Strong，更暗更长的衰减）
 *   KBB.tracks    多轨播放器（每轨独立通道：失真/音量/声像；静音与独奏实时生效）
 *   KBB.mixer     混音台 UI（名字 · 静音 · 独奏 · 音量 · 声像）
 *   KBB.timeline  段落时间轴（色块 + 能量高度 + 播放头）
 *   KBB.spectrum  频段占位图（对数频率轴，画各乐器占的频段与重叠）
 *
 * 约定：所有音色离线渲染成 AudioBuffer 并缓存，与 guitar-kit 一致；
 *      颜色一律取 CSS 变量以适配深浅色主题；不自动播放，只在用户手势后发声。
 */
(function () {
  "use strict";
  var KBB = (window.KBB = window.KBB || {});
  var G = window.KBG;
  if (!G || !G.audio) { console.warn("band-kit 需要先加载 guitar-kit.js"); return; }
  var A = G.audio;

  /* ================================================================
   * 1. KBB.drums — 合成鼓组
   * 每件鼓都是「一个包络 × 一个音源」：底鼓与嗵鼓是扫频正弦，
   * 军鼓是带通噪声 + 低频音体，镲片是高通噪声。全部离线渲染后缓存。
   * ================================================================ */
  var drumCache = {};

  /* 一阶高通：y[n] = a·(y[n-1] + x[n] − x[n-1])，a 由截止频率决定 */
  function hipass(buf, sr, fc) {
    var rc = 1 / (2 * Math.PI * fc), a = rc / (rc + 1 / sr);
    var yPrev = 0, xPrev = 0;
    for (var i = 0; i < buf.length; i++) {
      var x = buf[i];
      var y = a * (yPrev + x - xPrev);
      buf[i] = y; yPrev = y; xPrev = x;
    }
  }
  /* 一阶低通 */
  function lopass(buf, sr, fc) {
    var rc = 1 / (2 * Math.PI * fc), a = (1 / sr) / (rc + 1 / sr);
    var yPrev = 0;
    for (var i = 0; i < buf.length; i++) {
      yPrev = yPrev + a * (buf[i] - yPrev);
      buf[i] = yPrev;
    }
  }
  function rndGen(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x3fffffff - 1; };
  }

  /* 鼓件参数表。改这里就能调音色，正文与习题引用的数字都取自这张表。 */
  /* band 一栏是对合成结果的实测描述（谱峰与 −10 dB 频段），
   * 第 7 章的频段占位图与习题都引用这里的数字，改音色时务必同步重测。 */
  var PIECES = {
    kick:  { cn: "底鼓 Kick",  dur: 0.55, band: "40–80 Hz 音体 + 1 kHz 以上音头", lo: 37, hi: 80, peak: 39 },
    snare: { cn: "军鼓 Snare", dur: 0.40, band: "180–220 Hz 音体 + 1–5 kHz 噪声", lo: 180, hi: 5000, peak: 188 },
    tom:   { cn: "嗵鼓 Tom",   dur: 0.50, band: "120–220 Hz", lo: 120, hi: 220, peak: 124 },
    hh:    { cn: "闭镲 HH",    dur: 0.09, band: "4–16 kHz", lo: 3800, hi: 16000, peak: 15800 },
    hho:   { cn: "开镲 HH-o",  dur: 0.42, band: "4–15 kHz", lo: 4300, hi: 15300, peak: 12100 },
    ride:  { cn: "叮叮 Ride",  dur: 0.85, band: "2.5–16 kHz", lo: 2400, hi: 16000, peak: 13200 },
    crash: { cn: "擦片 Crash", dur: 1.60, band: "900 Hz–10 kHz", lo: 900, hi: 10400, peak: 5500 }
  };

  function renderDrum(piece, sr) {
    var spec = PIECES[piece] || PIECES.kick;
    var len = Math.round(sr * spec.dur);
    var out = new Float32Array(len);
    var i, t;

    if (piece === "kick" || piece === "tom") {
      /* 扫频正弦：频率从 f0 指数衰减到 f1，相位靠逐样本积分保证连续 */
      var f0 = piece === "kick" ? 62 : 220, f1 = piece === "kick" ? 38 : 120;
      var fTau = piece === "kick" ? 0.018 : 0.05;
      var aTau = piece === "kick" ? 0.115 : 0.16;
      var phase = 0;
      for (i = 0; i < len; i++) {
        t = i / sr;
        var f = f1 + (f0 - f1) * Math.exp(-t / fTau);
        phase += 2 * Math.PI * f / sr;
        out[i] = Math.sin(phase) * Math.exp(-t / aTau);
      }
      /* 音头点击：极短的高通噪声，让底鼓在小音箱上也听得见 */
      var rc = rndGen(piece === "kick" ? 1234 : 4321);
      var clickLen = Math.round(sr * 0.006), click = new Float32Array(clickLen);
      for (i = 0; i < clickLen; i++) click[i] = rc() * Math.exp(-i / (sr * 0.0016));
      hipass(click, sr, 1200);
      for (i = 0; i < clickLen; i++) out[i] += click[i] * (piece === "kick" ? 0.45 : 0.3);

    } else if (piece === "snare") {
      /* 噪声（带通）+ 180 Hz 音体，两者比例约 6:4 */
      var rs = rndGen(9876);
      var noise = new Float32Array(len);
      for (i = 0; i < len; i++) noise[i] = rs() * Math.exp(-(i / sr) / 0.075);
      hipass(noise, sr, 900); lopass(noise, sr, 7000);
      var ph = 0;
      for (i = 0; i < len; i++) {
        t = i / sr;
        ph += 2 * Math.PI * (180 + 40 * Math.exp(-t / 0.02)) / sr;
        out[i] = 0.60 * noise[i] + 0.40 * Math.sin(ph) * Math.exp(-t / 0.055);
      }

    } else if (piece === "hh" || piece === "hho" || piece === "crash" || piece === "ride") {
      var cfg = {
        hh:    { tau: 0.022, fc: 8000, gain: 1 },
        hho:   { tau: 0.130, fc: 8000, gain: 0.95 },
        crash: { tau: 0.520, fc: 5000, gain: 0.9 },
        ride:  { tau: 0.300, fc: 6000, gain: 0.85 }
      }[piece];
      var rh = rndGen(piece === "hh" ? 555 : piece === "hho" ? 556 : piece === "crash" ? 557 : 558);
      for (i = 0; i < len; i++) out[i] = rh() * Math.exp(-(i / sr) / cfg.tau) * cfg.gain;
      /* 一阶高通只有 6 dB/oct，镲片会拖出大量中频；串两级得到 12 dB/oct，
       * 既更像真镲，也让第 7 章的频段占位图不至于处处重叠。 */
      hipass(out, sr, cfg.fc); hipass(out, sr, cfg.fc);
      if (piece === "ride") {                       /* 叮叮需要一个可辨识的音头 */
        var pr = 0;
        for (i = 0; i < len; i++) {
          t = i / sr; pr += 2 * Math.PI * 2400 / sr;
          out[i] += 0.22 * Math.sin(pr) * Math.exp(-t / 0.05);
        }
      }
    }

    /* 归一化 + 首尾淡入淡出，避免爆音 */
    var mx = 0;
    for (i = 0; i < len; i++) mx = Math.max(mx, Math.abs(out[i]));
    if (mx > 0) for (i = 0; i < len; i++) out[i] /= mx;
    var aN = Math.round(sr * 0.0006), fN = Math.round(sr * 0.008);
    for (i = 0; i < aN && i < len; i++) out[i] *= i / aN;
    for (i = 0; i < fN && i < len; i++) out[len - 1 - i] *= i / fN;
    return out;
  }

  function drumBuffer(piece) {
    if (drumCache[piece]) return drumCache[piece];
    var c = A.ctx ? A.ctx() : null;
    if (!c) return null;
    var data = renderDrum(piece, c.sampleRate);
    var buf = c.createBuffer(1, data.length, c.sampleRate);
    buf.getChannelData(0).set(data);
    drumCache[piece] = buf;
    return buf;
  }

  KBB.drums = {
    PIECES: PIECES,
    /* 打一下。opts: {at 绝对时刻, delay 相对秒, gain, channel} */
    hit: function (piece, opts) {
      opts = opts || {};
      if (!A.isEnabled()) return null;
      var c = A.ctx(); if (!c) return null;
      if (c.state === "suspended" && c.resume) c.resume();
      var buf = drumBuffer(piece); if (!buf) return null;
      var when = opts.at != null ? opts.at : c.currentTime + (opts.delay || 0);
      var src = c.createBufferSource(); src.buffer = buf;
      var g = c.createGain(); g.gain.value = opts.gain == null ? 0.85 : opts.gain;
      src.connect(g);
      g.connect(opts.channel && opts.channel.input ? opts.channel.input : A.busInput());
      src.start(when);
      A.track(src);
      return src;
    },
    /* 供数值验证：拿到离线渲染的波形 */
    render: function (piece, sr) { return renderDrum(piece, sr || 48000); }
  };

  /* ================================================================
   * 2. KBB.bass — 贝斯音色
   * 同样是 Karplus–Strong，但激励更暗、衰减更长；沿用 guitar-kit 里
   * 「环路有效长度 N − 0.5」的 playbackRate 校正，保证音准。
   * ================================================================ */
  var bassCache = {};
  function bassBuffer(midi, mute) {
    var key = midi + (mute ? "m" : "n");
    if (bassCache[key]) return bassCache[key];
    var c = A.ctx(); if (!c) return null;
    var sr = c.sampleRate, f = G.theory.freq(midi);
    var N = Math.max(2, Math.round(sr / f));
    var t60 = mute ? 0.20 : 1.9;
    var dur = mute ? 0.36 : 2.2;
    var len = Math.round(sr * dur);
    var damp = Math.exp(-6.9078 / (f * t60));
    var buf = c.createBuffer(1, len, sr);
    var out = buf.getChannelData(0);
    var rnd = rndGen(midi * 5381 + 7919);
    var line = new Float32Array(N), prev = 0, i;
    /* 激励比吉他暗得多：三次一阶低通，几乎只剩低次谐波 */
    for (i = 0; i < N; i++) { prev = 0.25 * rnd() + 0.75 * prev; line[i] = prev; }
    lopass(line, sr, 400);
    var mx = 0;
    for (i = 0; i < N; i++) mx = Math.max(mx, Math.abs(line[i]));
    if (mx > 0) for (i = 0; i < N; i++) line[i] = line[i] / mx * (mute ? 0.8 : 0.95);
    var idx = 0;
    for (var n = 0; n < len; n++) {
      var cur = line[idx];
      out[n] = cur;
      line[idx] = damp * 0.5 * (cur + line[(idx + 1) % N]);
      idx = (idx + 1) % N;
    }
    var aN = Math.round(sr * 0.003), fN = Math.round(sr * 0.03);
    for (i = 0; i < aN && i < len; i++) out[i] *= i / aN;
    for (i = 0; i < fN && i < len; i++) out[len - 1 - i] *= i / fN;
    var rec = { buf: buf, rate: f * (N - 0.5) / sr };
    bassCache[key] = rec;
    return rec;
  }

  KBB.bass = {
    pluck: function (midi, opts) {
      opts = opts || {};
      if (!A.isEnabled()) return null;
      var c = A.ctx(); if (!c) return null;
      if (c.state === "suspended" && c.resume) c.resume();
      var rec = bassBuffer(Math.round(midi), !!opts.mute); if (!rec) return null;
      var when = opts.at != null ? opts.at : c.currentTime + (opts.delay || 0);
      var src = c.createBufferSource();
      src.buffer = rec.buf;
      if (src.playbackRate) src.playbackRate.value = rec.rate;
      var g = c.createGain(); g.gain.value = opts.gain == null ? 0.85 : opts.gain;
      src.connect(g);
      g.connect(opts.channel && opts.channel.input ? opts.channel.input : A.busInput());
      src.start(when);
      if (opts.dur) {
        g.gain.setValueAtTime(g.gain.value, when + opts.dur);
        g.gain.linearRampToValueAtTime(0.0001, when + opts.dur + 0.05);
        src.stop(when + opts.dur + 0.07);
      }
      A.track(src);
      return src;
    },
    render: function (midi, mute) { return bassBuffer(midi, mute); }
  };

  /* ================================================================
   * 3. KBB.tracks — 多轨播放器
   * 每轨一条 KBG.audio.channel（独立失真/音量/声像）。
   * 静音与独奏通过改通道音量实时生效，不重排事件、不打断循环——
   * 这正是「把贝斯静音听听少了什么」这类演示需要的行为。
   * ================================================================ */
  /* 每轨可选 lp / hp 覆盖通道的滤波（第 9 章的贝斯双轨分频靠它实现） */
  KBB.tracks = function (spec) {
    spec = spec || {};
    var bpm = spec.bpm || 120;
    var lengthBeats = spec.lengthBeats || 4;
    var loop = spec.loop !== false;
    var list = (spec.tracks || []).map(function (t) {
      return {
        id: t.id, name: t.name || t.id, inst: t.inst || "guitar",
        events: t.events || [],
        gain: t.gain == null ? 1 : t.gain,
        pan: t.pan == null ? 0 : t.pan,
        drive: t.drive == null ? 0 : t.drive,
        lp: t.lp, hp: t.hp,                 /* 不传则按乐器类型取默认 */
        mute: !!t.mute, solo: !!t.solo,
        _ch: null
      };
    });
    var handle = null, byId = {};
    list.forEach(function (t) { byId[t.id] = t; });

    function chanOf(t) {
      if (!t._ch) {
        /* 鼓与贝斯需要更宽的频响，吉他保留箱体感的低通 */
        var wide = (t.inst === "drums");
        t._ch = A.channel({
          drive: t.drive, gain: t.gain, pan: t.pan,
          lp: t.lp == null ? (wide ? 18000 : 6000) : t.lp,
          hp: t.hp == null ? (wide ? 25 : 85) : t.hp
        });
      }
      return t._ch;
    }
    function applyMix() {
      var anySolo = list.some(function (t) { return t.solo; });
      list.forEach(function (t) {
        var on = anySolo ? t.solo : !t.mute;
        chanOf(t).setGain(on ? t.gain : 0);
      });
    }
    function buildEvents() {
      var spb = 60 / bpm, out = [];
      list.forEach(function (t) {
        var ch = chanOf(t);
        t.events.forEach(function (e) {
          if (t.inst === "drums") {
            out.push({ t: e.t, play: (function (e, ch) {
              return function (at) { KBB.drums.hit(e.piece, { at: at, gain: e.gain, channel: ch }); };
            })(e, ch) });
          } else if (t.inst === "bass") {
            out.push({ t: e.t, play: (function (e, ch, spb) {
              return function (at) {
                KBB.bass.pluck(e.midi, { at: at, gain: e.gain, mute: e.mute,
                  dur: e.dur ? e.dur * spb * 0.98 : undefined, channel: ch });
              };
            })(e, ch, spb) });
          } else {
            out.push({ t: e.t, midi: e.midi, midis: e.midis, dur: e.dur,
              mute: e.mute, gain: e.gain, spread: e.spread, channel: ch });
          }
        });
      });
      return out;
    }

    var api = {
      tracks: list,
      get: function (id) { return byId[id]; },
      isPlaying: function () { return !!handle; },
      position: function () { return handle ? handle.position() : 0; },
      lengthBeats: function () { return lengthBeats; },
      bpm: function () { return bpm; },
      setBpm: function (v) { bpm = v; if (handle) { api.stop(); api.play(); } },
      play: function () {
        api.stop();
        if (!A.ctx()) return;
        applyMix();
        handle = A.sequence(buildEvents(), { bpm: bpm, loop: loop, lengthBeats: lengthBeats });
        return handle;
      },
      stop: function () {
        if (handle) { handle.stop(); handle = null; }
        A.stopAll();
      },
      setMute: function (id, v) { if (byId[id]) { byId[id].mute = !!v; applyMix(); } },
      setSolo: function (id, v) { if (byId[id]) { byId[id].solo = !!v; applyMix(); } },
      setGain: function (id, v) { if (byId[id]) { byId[id].gain = Math.max(0, v); applyMix(); } },
      setPan: function (id, v) { if (byId[id]) { byId[id].pan = v; chanOf(byId[id]).setPan(v); } },
      setDrive: function (id, v) { if (byId[id]) { byId[id].drive = v; chanOf(byId[id]).setDrive(v); } },
      /* 供验证：读回通道上真实生效的值 */
      readMix: function () {
        return list.map(function (t) {
          var c = chanOf(t);
          return { id: t.id, mute: t.mute, solo: t.solo, gain: c.getGain(), pan: c.getPan() };
        });
      },
      dispose: function () {
        api.stop();
        list.forEach(function (t) { if (t._ch) { t._ch.dispose(); t._ch = null; } });
      }
    };
    return api;
  };

  /* ================================================================
   * 4. KBB.mixer — 混音台 UI
   * 每轨一行：名字 · 静音 · 独奏 · 音量 · 声像。复用 kb-btn / kb-control 样式。
   * ================================================================ */
  KBB.mixer = function (host, rig, opts) {
    opts = opts || {};
    var rows = [];
    var wrap = document.createElement("div");
    wrap.className = "kbb-mixer";

    rig.tracks.forEach(function (t) {
      var row = document.createElement("div");
      row.className = "kbb-track";

      var nm = document.createElement("span");
      nm.className = "kbb-name";
      nm.textContent = t.name;

      var mBtn = document.createElement("button");
      mBtn.type = "button"; mBtn.className = "kb-btn kbb-mini";
      mBtn.textContent = "静音";
      var sBtn = document.createElement("button");
      sBtn.type = "button"; sBtn.className = "kb-btn kbb-mini";
      sBtn.textContent = "独奏";

      function sync() {
        rows.forEach(function (r) {
          r.m.classList.toggle("on", r.t.mute);
          r.s.classList.toggle("on", r.t.solo);
          var anySolo = rig.tracks.some(function (x) { return x.solo; });
          r.row.classList.toggle("dim", anySolo ? !r.t.solo : r.t.mute);
        });
      }
      mBtn.addEventListener("click", function () { rig.setMute(t.id, !t.mute); sync(); if (opts.onChange) opts.onChange(); });
      sBtn.addEventListener("click", function () { rig.setSolo(t.id, !t.solo); sync(); if (opts.onChange) opts.onChange(); });

      var vol = document.createElement("input");
      vol.type = "range"; vol.min = "0"; vol.max = "1.4"; vol.step = "0.05";
      vol.value = String(t.gain); vol.className = "kbb-slider";
      vol.setAttribute("aria-label", t.name + " 音量");
      vol.addEventListener("input", function () { rig.setGain(t.id, parseFloat(vol.value)); });

      var pan = document.createElement("input");
      pan.type = "range"; pan.min = "-1"; pan.max = "1"; pan.step = "0.1";
      pan.value = String(t.pan); pan.className = "kbb-slider";
      pan.setAttribute("aria-label", t.name + " 声像");
      pan.addEventListener("input", function () { rig.setPan(t.id, parseFloat(pan.value)); });

      var vLab = document.createElement("small"); vLab.textContent = "音量";
      var pLab = document.createElement("small"); pLab.textContent = "声像";

      row.appendChild(nm); row.appendChild(mBtn); row.appendChild(sBtn);
      row.appendChild(vLab); row.appendChild(vol);
      row.appendChild(pLab); row.appendChild(pan);
      wrap.appendChild(row);
      rows.push({ t: t, row: row, m: mBtn, s: sBtn, vol: vol, pan: pan });
    });

    host.appendChild(wrap);
    return {
      el: wrap,
      sync: function () {
        rows.forEach(function (r) {
          r.m.classList.toggle("on", r.t.mute);
          r.s.classList.toggle("on", r.t.solo);
          r.vol.value = String(r.t.gain);
          r.pan.value = String(r.t.pan);
          var anySolo = rig.tracks.some(function (x) { return x.solo; });
          r.row.classList.toggle("dim", anySolo ? !r.t.solo : r.t.mute);
        });
      },
      reset: function () {
        rig.tracks.forEach(function (t) { rig.setMute(t.id, false); rig.setSolo(t.id, false); });
        this.sync();
      }
    };
  };

  /* ================================================================
   * 5. 可视化组件（canvas，颜色取 CSS 变量以适配深浅色主题）
   * ================================================================ */
  function cssVar(n, fb) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return v || fb;
  }
  /* 段落配色：按角色固定，保证全书视觉一致 */
  var ROLE_COLOR = {
    intro: "#64748b", verse: "#2563eb", pre: "#d97706",
    chorus: "#dc2626", bridge: "#8b5cf6", solo: "#16a34a", outro: "#64748b"
  };
  KBB.ROLE_COLOR = ROLE_COLOR;

  /* ---- 5.1 段落时间轴 ----
   * sections: [{name, role, beats, energy(0–1)}]
   * 返回 {setPos(beats), redraw, total}
   */
  KBB.timeline = function (host, sections, opts) {
    opts = opts || {};
    var cv = document.createElement("canvas");
    cv.className = "kb-canvas";
    host.appendChild(cv);
    var H = opts.height || 130;
    var ctx = window.KB && KB.fitCanvas ? KB.fitCanvas(cv, H, function () { draw(pos); }) : cv.getContext("2d");
    var total = sections.reduce(function (a, s) { return a + s.beats; }, 0);
    var pos = null;

    function draw(p) {
      var w = cv.clientWidth || 600;
      var muted = cssVar("--kb-fg-muted", "#64748b");
      var faint = cssVar("--kb-fg-faint", "#94a3b8");
      ctx.clearRect(0, 0, w, H);
      var x0 = 8, x1 = w - 8, span = x1 - x0;
      if (span < 60) return;
      ctx.font = "11px -apple-system, PingFang SC, sans-serif";
      var top = 24, botAxis = H - 30, maxH = botAxis - top;
      var acc = 0;
      sections.forEach(function (s) {
        var bx = x0 + span * (acc / total), bw = span * (s.beats / total);
        var col = ROLE_COLOR[s.role] || ROLE_COLOR.verse;
        var hgt = Math.max(10, maxH * (s.energy == null ? 0.5 : s.energy));
        ctx.fillStyle = col; ctx.globalAlpha = 0.78;
        ctx.fillRect(bx + 1, botAxis - hgt, Math.max(2, bw - 2), hgt);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        if (bw > 40) {
          ctx.textAlign = "center";
          ctx.fillText(s.name, bx + bw / 2, botAxis - 8);
        }
        ctx.fillStyle = muted; ctx.textAlign = "center";
        if (bw > 26) ctx.fillText(s.beats + " 拍", bx + bw / 2, H - 14);
        acc += s.beats;
      });
      ctx.strokeStyle = faint; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, botAxis); ctx.lineTo(x1, botAxis); ctx.stroke();
      ctx.fillStyle = muted; ctx.textAlign = "left";
      ctx.fillText(opts.label || "段落 · 高度＝能量", x0, 16);
      if (p != null) {
        var px = x0 + span * ((p % total) / total);
        ctx.strokeStyle = cssVar("--kb-fg", "#1e293b"); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(px, top - 8); ctx.lineTo(px, botAxis + 6); ctx.stroke();
      }
    }
    draw(null);
    return {
      canvas: cv, total: total,
      setPos: function (p) { pos = p; draw(p); },
      redraw: function () { draw(pos); },
      /* 给定拍数，返回它落在第几段 */
      sectionAt: function (p) {
        var acc = 0, q = ((p % total) + total) % total;
        for (var i = 0; i < sections.length; i++) {
          acc += sections[i].beats;
          if (q < acc) return sections[i];
        }
        return sections[sections.length - 1];
      }
    };
  };

  /* ---- 5.2 频段占位图 ----
   * bands: [{name, lo, hi, row, color}]，频率单位 Hz
   * 同一 row 的乐器画在同一行；不同乐器的重叠区会被标出来。
   */
  KBB.spectrum = function (host, bands, opts) {
    opts = opts || {};
    var cv = document.createElement("canvas");
    cv.className = "kb-canvas";
    host.appendChild(cv);
    var rows = bands.reduce(function (m, b) { return Math.max(m, b.row || 0); }, 0) + 1;
    var H = opts.height || (52 + rows * 26);
    var ctx = window.KB && KB.fitCanvas ? KB.fitCanvas(cv, H, function () { draw(); }) : cv.getContext("2d");
    var FMIN = opts.fmin || 30, FMAX = opts.fmax || 16000;
    var hidden = {};

    function draw() {
      var w = cv.clientWidth || 600;
      var muted = cssVar("--kb-fg-muted", "#64748b");
      var faint = cssVar("--kb-fg-faint", "#94a3b8");
      ctx.clearRect(0, 0, w, H);
      var x0 = 10, x1 = w - 10, span = x1 - x0;
      if (span < 80) return;
      ctx.font = "11px -apple-system, PingFang SC, sans-serif";
      function fx(f) { return x0 + span * (Math.log(f / FMIN) / Math.log(FMAX / FMIN)); }
      /* 频率刻度 */
      [50, 100, 250, 500, 1000, 2000, 4000, 8000].forEach(function (f) {
        var px = fx(f);
        ctx.strokeStyle = faint; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, 18); ctx.lineTo(px, H - 20); ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = muted; ctx.textAlign = "center";
        ctx.fillText(f >= 1000 ? (f / 1000) + "k" : String(f), px, H - 6);
      });
      /* 各乐器占的频段 */
      var visible = bands.filter(function (b) { return !hidden[b.name]; });
      visible.forEach(function (b) {
        var y = 26 + (b.row || 0) * 26;
        var a = fx(Math.max(FMIN, b.lo)), c = fx(Math.min(FMAX, b.hi));
        ctx.fillStyle = b.color || ROLE_COLOR.verse;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(a, y, Math.max(3, c - a), 18);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff"; ctx.textAlign = "left";
        if (c - a > 46) ctx.fillText(b.name, a + 5, y + 13);
        else { ctx.fillStyle = muted; ctx.fillText(b.name, c + 4, y + 13); }
      });
      /* 重叠区：两两相交且行不同的，画斜线警示 */
      var clash = 0;
      for (var i = 0; i < visible.length; i++) {
        for (var j = i + 1; j < visible.length; j++) {
          var A1 = visible[i], B1 = visible[j];
          var lo = Math.max(A1.lo, B1.lo), hi = Math.min(A1.hi, B1.hi);
          if (hi <= lo) continue;
          clash++;
          var xa = fx(lo), xb = fx(hi);
          ctx.strokeStyle = "#dc2626"; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
          for (var x = xa; x < xb; x += 6) {
            ctx.beginPath(); ctx.moveTo(x, 22); ctx.lineTo(x + 5, H - 22); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }
      ctx.fillStyle = muted; ctx.textAlign = "left";
      ctx.fillText(opts.label || ("频段占位　红色斜线＝重叠区（共 " + clash + " 处）"), x0, 13);
    }
    draw();
    return {
      canvas: cv,
      redraw: draw,
      setHidden: function (name, v) { hidden[name] = !!v; draw(); },
      /* 返回两件乐器的重叠区间，供正文与习题引用 */
      overlap: function (n1, n2) {
        var a = bands.filter(function (b) { return b.name === n1; })[0];
        var b = bands.filter(function (x) { return x.name === n2; })[0];
        if (!a || !b) return null;
        var lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi);
        return hi > lo ? { lo: lo, hi: hi } : null;
      }
    };
  };

  /* ================================================================
   * 6. KBB.riff — 示范曲的通用展开助手
   * 全书用同一段 E 小调素材做对照，各章只给「根音偏移 + 节奏型」，
   * 由这里统一展开成发声事件与 TAB 列，保证十六章的演示口径一致。
   * ================================================================ */
  var RHY = {
    quarter: { cn: "四分", subs: [[0, 1]] },
    eighth:  { cn: "八分", subs: [[0, 0.5], [0.5, 0.5]] },
    gallop:  { cn: "Gallop", subs: [[0, 0.5], [0.5, 0.25], [0.75, 0.25]] },
    rgallop: { cn: "反向 Gallop", subs: [[0, 0.25], [0.25, 0.25], [0.5, 0.5]] },
    sixteen: { cn: "十六分", subs: [[0, 0.25], [0.25, 0.25], [0.5, 0.25], [0.75, 0.25]] },
    half:    { cn: "半速", subs: [[0, 2]] }
  };
  KBB.riff = {
    RHY: RHY,
    ROOT: 40,                    /* 6 弦空弦 E2 —— 示范曲的主音 */
    /* roots: 相对主音的半音偏移数组，null 表示整拍休止
     * opts: {root, rhy, channel, power(默认 true), mute(默认 true), octave} */
    events: function (roots, rhy, opts) {
      opts = opts || {};
      var base = (opts.root == null ? KBB.riff.ROOT : opts.root) + (opts.octave || 0) * 12;
      var subs = (RHY[rhy] || RHY.gallop).subs;
      var power = opts.power !== false, mute = opts.mute !== false;
      var ev = [];
      roots.forEach(function (r, i) {
        if (r === null) return;
        subs.forEach(function (s) {
          var e = { t: i + s[0], dur: s[1], mute: mute, spread: 0.008,
            gain: s[0] === 0 ? 0.92 : 0.62, channel: opts.channel };
          if (power) e.midis = [base + r, base + r + 7, base + r + 12];
          else e.midi = base + r;
          ev.push(e);
        });
      });
      return ev;
    },
    /* 同一批 roots 的 TAB 列（六弦根强力和弦形状） */
    cols: function (roots, rhy, opts) {
      opts = opts || {};
      var subs = (RHY[rhy] || RHY.gallop).subs;
      var power = opts.power !== false;
      var cols = [];
      roots.forEach(function (r) {
        subs.forEach(function (s) {
          if (r === null) { cols.push({ notes: [], dur: s[1], label: "休" }); return; }
          cols.push({
            notes: power
              ? [{ string: 0, fret: r }, { string: 1, fret: r + 2 }, { string: 2, fret: r + 2 }]
              : [{ string: 0, fret: r }],
            dur: s[1], mute: opts.mute !== false
          });
        });
      });
      return cols;
    },
    /* 级数串，用于读数条 */
    line: function (roots) {
      return roots.map(function (r) {
        return r === null ? "休" : (window.KBG.theory.DEGREES[window.KBG.theory.mod12(r)]);
      }).join(" – ");
    },
    /* 常用鼓型：basic（底鼓在正拍、军鼓在后拍）、driving（八分底鼓）、half（半速） */
    drumPattern: function (bars, kind) {
      var ev = [], beats = bars * 4;
      for (var b = 0; b < beats; b++) {
        if (kind === "half") {
          if (b % 4 === 0) ev.push({ t: b, piece: "kick", gain: 0.95 });
          if (b % 4 === 2) ev.push({ t: b, piece: "snare", gain: 0.9 });
          if (b % 2 === 0) ev.push({ t: b, piece: "hh", gain: 0.45 });
        } else {
          if (b % 2 === 0) ev.push({ t: b, piece: "kick", gain: 0.92 });
          else ev.push({ t: b, piece: "snare", gain: 0.85 });
          ev.push({ t: b, piece: "hh", gain: 0.45 });
          ev.push({ t: b + 0.5, piece: "hh", gain: 0.32 });
          if (kind === "driving" && b % 2 === 0) ev.push({ t: b + 0.5, piece: "kick", gain: 0.6 });
        }
      }
      return ev;
    }
  };

  /* ================================================================
   * 7. KBB.song — 贯穿全书的示范曲
   * E 小调 148 BPM。各章按需取用整首或某几段，保证第 3、5、12、13 章
   * 讨论的是同一段音乐，读者的听觉参照系不会中途改变。
   * ================================================================ */
  var SEC = {
    intro:  { name: "前奏",   role: "intro",  bars: 2, energy: 0.30 },
    verse:  { name: "主歌",   role: "verse",  bars: 4, energy: 0.45 },
    pre:    { name: "预副歌", role: "pre",    bars: 2, energy: 0.68 },
    chorus: { name: "副歌",   role: "chorus", bars: 4, energy: 1.00 },
    bridge: { name: "桥段",   role: "bridge", bars: 2, energy: 0.35 }
  };
  /* 每段每个声部的素材：roots 是相对主音的半音偏移，一格一拍 */
  var MAT = {
    intro:  { gtr: [0, null, 0, null], rhy: "half",    drums: null,      bass: null,        oct2: null },
    verse:  { gtr: [0, 0, 3, 5],       rhy: "gallop",  drums: "basic",   bass: [0, 0, 3, 5], oct2: null },
    pre:    { gtr: [0, 3, 5, 7],       rhy: "eighth",  drums: "driving", bass: [0, 3, 5, 7], oct2: null },
    chorus: { gtr: [8, 3, 10, 0],      rhy: "quarter", drums: "basic",   bass: [8, 3, 10, 0], oct2: [8, 3, 10, 0] },
    bridge: { gtr: [0, null, 8, null], rhy: "half",    drums: "half",    bass: [0, null, 8, null], oct2: null }
  };
  KBB.song = {
    bpm: 148,
    SEC: SEC,
    MAT: MAT,
    /* order: 段落 key 数组，默认整首。返回 {tracks, lengthBeats, sections} */
    build: function (order, opts) {
      opts = opts || {};
      order = order || ["intro", "verse", "pre", "chorus", "bridge"];
      var reps = opts.reps || 1;
      var gtr = [], gtr2 = [], bass = [], drums = [], sections = [], t = 0;
      order.forEach(function (key) {
        var sec = SEC[key], m = MAT[key];
        for (var r = 0; r < reps; r++) {
          var beats = sec.bars * 4;
          /* 一段内把素材铺满 bars 小节 */
          var rounds = Math.max(1, Math.round(beats / m.gtr.length));
          for (var q = 0; q < rounds; q++) {
            var off = t + q * m.gtr.length;
            var mute = (key !== "intro" && key !== "chorus");
            var base = KBB.riff.events(m.gtr, m.rhy, { mute: mute });
            base.forEach(function (e) { gtr.push(Object.assign({}, e, { t: e.t + off })); });
            /* 吉他 R 默认加倍吉他 L；只有定义了 oct2 的段落（副歌）改弹高八度 */
            if (m.oct2) {
              KBB.riff.events(m.oct2, m.rhy, { octave: 1, mute: false })
                .forEach(function (e) { gtr2.push(Object.assign({}, e, { t: e.t + off })); });
            } else {
              base.forEach(function (e) { gtr2.push(Object.assign({}, e, { t: e.t + off })); });
            }
            if (m.bass) {
              m.bass.forEach(function (r2, i) {
                if (r2 === null) return;
                bass.push({ t: off + i, midi: KBB.riff.ROOT - 12 + r2, dur: 1, gain: 0.9 });
              });
            }
          }
          if (m.drums) {
            KBB.riff.drumPattern(sec.bars, m.drums)
              .forEach(function (e) { drums.push(Object.assign({}, e, { t: e.t + t })); });
            if (key === "chorus") drums.push({ t: t, piece: "crash", gain: 0.55 });
          }
          sections.push({ name: sec.name, role: sec.role, beats: beats, energy: sec.energy, at: t });
          t += beats;
        }
      });
      return {
        lengthBeats: t,
        sections: sections,
        tracks: [
          { id: "dr", name: "鼓",     inst: "drums",  gain: 1.0,  pan: 0,     events: drums },
          { id: "ba", name: "贝斯",   inst: "bass",   gain: 0.95, pan: 0,     drive: 0.25, events: bass },
          { id: "g1", name: "吉他 L", inst: "guitar", gain: 0.85, pan: -0.6,  drive: 0.82, events: gtr },
          { id: "g2", name: "吉他 R", inst: "guitar", gain: 0.8,  pan: 0.6,   drive: 0.82, events: gtr2 }
        ]
      };
    }
  };
})();
