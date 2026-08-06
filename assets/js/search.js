/* search.js — 顶栏/首页搜索：精确 + 模糊（拼音首字母 / 字符子序列 / 编辑距离纠错）。
 *
 * 匹配层级（智能模式依次尝试，取各字段最高分；精确模式只用第 1 层）：
 *   1. 精确子串           100 分（命中字段开头 +15）
 *   2. 拼音首字母子串/子序列  70 / 45 分（纯字母数字 query 时启用，"xxds"→线性代数）
 *   3. 字符子序列           40 × 紧凑度（"矩乘"→"矩阵乘法"，窗口 ≤ 4×query 长度）
 *   4. 编辑距离纠错         30 − 10×距离（≥4 字符英文词，"matirx"→"matrix"）
 * 页面得分 = max(字段得分 × 权重)，权重 title×3 heading×2 category/tags×1.5 body×1，
 * 命中 ≥2 个字段再 +10。
 *
 * 拼音串与原文的对齐规则（pyMapOf）必须与 scripts/build_index.py 的 py_of() 一致：
 * 每个汉字（U+4E00–U+9FFF）恒占 1 位，ASCII 字母数字占其自身，其余字符跳过。
 * 渲染全部使用 createTextNode / createElement，不拼 HTML 字符串。 */
(function () {
  "use strict";
  var KB = (window.KB = window.KB || {});
  var collator = new Intl.Collator("zh-Hans-CN");
  var MAX_RESULTS = 20;

  // ---------------------------------------------------------- 基础工具
  function pyMapOf(text) {
    var map = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if ((ch >= "一" && ch <= "鿿") || /[A-Za-z0-9]/.test(ch)) map.push(i);
    }
    return map;
  }

  function asciiTokens(lower) {
    var re = /[a-z0-9]+/g, m, out = [];
    while ((m = re.exec(lower))) out.push({ t: m[0], start: m.index });
    return out;
  }

  function rangePositions(start, len) {
    var out = [];
    for (var i = 0; i < len; i++) out.push(start + i);
    return out;
  }

  function span(positions) {
    return positions[positions.length - 1] - positions[0] + 1;
  }

  /* 子序列匹配：先正向找最早可行终点，再从终点反向回收，得到该终点下最小窗口 */
  function subseqFrom(hay, q, from) {
    var idx = from, end = -1;
    for (var i = 0; i < q.length; i++) {
      idx = hay.indexOf(q[i], idx);
      if (idx < 0) return null;
      end = idx;
      idx++;
    }
    var pos = new Array(q.length);
    var j = end;
    for (var k = q.length - 1; k >= 0; k--) {
      j = hay.lastIndexOf(q[k], j);
      pos[k] = j;
      j--;
    }
    return pos;
  }

  /* 在整个 hay 中找第一个满足窗口约束的子序列 */
  function subseqBest(hay, q, maxSpan) {
    var from = 0;
    for (;;) {
      var pos = subseqFrom(hay, q, from);
      if (!pos) return null;
      if (span(pos) <= maxSpan) return pos;
      from = pos[0] + 1;
    }
  }

  /* 编辑距离（提前剪枝，超过 maxD 返回 maxD+1） */
  function editDistance(a, b, maxD) {
    if (Math.abs(a.length - b.length) > maxD) return maxD + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      var rowMin = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > maxD) return maxD + 1;
      var t = prev; prev = cur; cur = t;
    }
    return prev[b.length];
  }

  // ---------------------------------------------------------- 字段与匹配
  function fieldInfo(text, py, withTokens) {
    var lower = (text || "").toLowerCase();
    return {
      text: text || "",
      lower: lower,
      py: py || null,
      pyMap: py ? pyMapOf(text || "") : null,
      tokens: withTokens ? asciiTokens(lower) : null
    };
  }

  /* 返回 {score, positions, layer} 或 null。positions 是命中字符在原文中的下标。 */
  function matchField(info, q, opts) {
    if (!info.lower) return null;

    var idx = info.lower.indexOf(q);
    if (idx >= 0) {
      return {
        score: 100 + (idx === 0 ? 15 : 0),
        positions: rangePositions(idx, q.length),
        layer: "exact"
      };
    }
    if (opts.mode === "exact" || q.length < 2) return null;

    // 拼音首字母
    if (opts.qIsAlnum && info.py) {
      var pidx = info.py.indexOf(q);
      if (pidx >= 0) {
        return { score: 70, positions: info.pyMap.slice(pidx, pidx + q.length), layer: "pinyin" };
      }
      var ppos = subseqBest(info.py, q, q.length * 4);
      if (ppos) {
        return {
          score: 45,
          positions: ppos.map(function (i) { return info.pyMap[i]; }),
          layer: "pinyin"
        };
      }
    }

    // 字符子序列
    var spos = subseqBest(info.lower, q, q.length * 4);
    if (spos) {
      return { score: 40 * (q.length / span(spos)), positions: spos, layer: "subseq" };
    }

    // 英文纠错
    if (opts.qIsAlnum && q.length >= 4 && info.tokens) {
      var maxD = Math.floor(q.length / 4) + 1;
      var best = null;
      info.tokens.forEach(function (tok) {
        var d = editDistance(q, tok.t, maxD);
        if (d <= maxD && (!best || d < best.d)) best = { d: d, tok: tok };
      });
      if (best) {
        return {
          score: 30 - 10 * best.d,
          positions: rangePositions(best.tok.start, best.tok.t.length),
          layer: "typo"
        };
      }
    }
    return null;
  }

  // ---------------------------------------------------------- 索引准备与查询
  var prepared = null;

  function prepare(pages) {
    prepared = pages.map(function (p) {
      return {
        page: p,
        title: fieldInfo(p.title, p.titlePy, true),
        cats: fieldInfo((p.category || []).join(" / "), p.categoryPy, false),
        tags: fieldInfo((p.tags || []).join(" "), null, false),
        body: fieldInfo(p.body || "", null, false),
        headings: (p.headings || []).map(function (h) {
          return { h: h, info: fieldInfo(h.t, h.py, true) };
        })
      };
    });
  }

  KB.searchQuery = function (rawQuery, mode) {
    if (!window.KB_INDEX) return null;
    if (!prepared) prepare(window.KB_INDEX.pages || []);
    var q = rawQuery.normalize("NFC").trim().toLowerCase();
    if (!q) return [];
    var opts = { mode: mode, qIsAlnum: /^[a-z0-9]+$/.test(q) };

    var results = [];
    prepared.forEach(function (e) {
      var fields = [];
      var m = matchField(e.title, q, opts);
      if (m) fields.push({ kind: "title", w: 3, m: m });

      var bh = null;
      e.headings.forEach(function (hh) {
        var hm = matchField(hh.info, q, opts);
        if (hm && (!bh || hm.score > bh.m.score)) bh = { kind: "heading", w: 2, m: hm, hh: hh };
      });
      if (bh) fields.push(bh);

      m = matchField(e.cats, q, opts);
      if (m) fields.push({ kind: "category", w: 1.5, m: m });
      m = matchField(e.tags, q, opts);
      if (m) fields.push({ kind: "tags", w: 1.5, m: m });
      m = matchField(e.body, q, opts);
      if (m) fields.push({ kind: "body", w: 1, m: m });

      if (!fields.length) return;
      var score = 0;
      fields.forEach(function (f) { score = Math.max(score, f.m.score * f.w); });
      if (fields.length >= 2) score += 10;
      results.push({ entry: e, score: score, fields: fields });
    });

    results.sort(function (a, b) {
      return b.score - a.score || collator.compare(a.entry.page.title, b.entry.page.title);
    });
    return results.slice(0, MAX_RESULTS);
  };

  // ---------------------------------------------------------- 渲染
  /* 把 text 追加进 el，positions 下标处的字符用 <mark> 包裹（相邻位置合并） */
  function appendHighlighted(el, text, positions) {
    if (!positions || !positions.length) {
      el.appendChild(document.createTextNode(text));
      return;
    }
    var ranges = [];
    var start = positions[0], prev = positions[0];
    for (var i = 1; i < positions.length; i++) {
      if (positions[i] === prev + 1) {
        prev = positions[i];
      } else {
        ranges.push([start, prev]);
        start = prev = positions[i];
      }
    }
    ranges.push([start, prev]);

    var cursor = 0;
    ranges.forEach(function (r) {
      if (r[0] > cursor) el.appendChild(document.createTextNode(text.slice(cursor, r[0])));
      var mark = document.createElement("mark");
      mark.textContent = text.slice(r[0], r[1] + 1);
      el.appendChild(mark);
      cursor = r[1] + 1;
    });
    if (cursor < text.length) el.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function findField(res, kind) {
    for (var i = 0; i < res.fields.length; i++) {
      if (res.fields[i].kind === kind) return res.fields[i];
    }
    return null;
  }

  function buildResultLink(res, ctx) {
    var p = res.entry.page;
    var a = document.createElement("a");
    a.className = "kb-search-result";
    a.setAttribute("role", "option");

    var headingField = findField(res, "heading");
    var href = encodeURI(ctx.root + p.url);
    if (headingField) href += "#" + encodeURIComponent(headingField.hh.h.id);
    a.href = href;

    var titleEl = document.createElement("div");
    titleEl.className = "kb-r-title";
    var titleField = findField(res, "title");
    appendHighlighted(titleEl, p.title, titleField ? titleField.m.positions : null);
    a.appendChild(titleEl);

    var pathEl = document.createElement("div");
    pathEl.className = "kb-r-path";
    var path = (p.category || []).join(" › ") || "未分类";
    if (headingField) path += "　§ " + headingField.hh.h.t;
    pathEl.textContent = path;
    a.appendChild(pathEl);

    var snippetEl = document.createElement("div");
    snippetEl.className = "kb-r-snippet";
    var bodyField = findField(res, "body");
    if (bodyField) {
      var pos = bodyField.m.positions;
      var text = res.entry.body.text;
      var from = Math.max(0, pos[0] - 40);
      var to = Math.min(text.length, pos[pos.length - 1] + 41);
      var shifted = pos
        .filter(function (i) { return i >= from && i < to; })
        .map(function (i) { return i - from; });
      if (from > 0) snippetEl.appendChild(document.createTextNode("…"));
      appendHighlighted(snippetEl, text.slice(from, to), shifted);
      if (to < text.length) snippetEl.appendChild(document.createTextNode("…"));
    } else if (headingField) {
      appendHighlighted(snippetEl, headingField.hh.h.t, headingField.m.positions);
    } else if (p.summary) {
      snippetEl.textContent = p.summary.slice(0, 90);
    }
    if (snippetEl.childNodes.length) a.appendChild(snippetEl);

    return a;
  }

  // ---------------------------------------------------------- 交互接线
  /* input / panel / modeBtn 接线；页面里可有多个实例（顶栏 + 首页 hero） */
  KB.setupSearch = function (input, panel, modeBtn, ctx) {
    var mode = "smart";
    try {
      mode = localStorage.getItem("kbSearchMode") === "exact" ? "exact" : "smart";
    } catch (e) { /* ignore */ }
    var selected = -1;
    var items = [];
    var timer = null;

    function syncModeBtn() {
      if (!modeBtn) return;
      modeBtn.textContent = mode === "exact" ? "精确" : "智能";
      modeBtn.setAttribute("data-mode", mode);
      modeBtn.title = mode === "exact"
        ? "精确模式：只按原文子串匹配（点击切换）"
        : "智能模式：支持拼音首字母、乱序缩写、拼写纠错（点击切换）";
    }

    function close() {
      panel.classList.remove("kb-open");
      input.setAttribute("aria-expanded", "false");
      selected = -1;
      items = [];
    }

    function select(i) {
      if (selected >= 0 && items[selected]) items[selected].removeAttribute("aria-selected");
      selected = i;
      if (selected >= 0 && items[selected]) {
        items[selected].setAttribute("aria-selected", "true");
        items[selected].scrollIntoView({ block: "nearest" });
      }
    }

    function render() {
      var q = input.value;
      panel.textContent = "";
      items = [];
      selected = -1;
      if (!q.trim()) { close(); return; }

      var results = KB.searchQuery(q, mode);
      panel.classList.add("kb-open");
      input.setAttribute("aria-expanded", "true");

      if (results === null) {
        var warn = document.createElement("div");
        warn.className = "kb-search-empty";
        warn.textContent = "索引未生成：请先运行 start.command（或 python3 scripts/build_index.py）";
        panel.appendChild(warn);
        return;
      }

      var status = document.createElement("div");
      status.className = "kb-search-status";
      status.setAttribute("aria-live", "polite");
      status.textContent = results.length
        ? results.length + " 条结果 · " + (mode === "exact" ? "精确模式" : "智能模式")
        : "";
      if (results.length) panel.appendChild(status);

      if (!results.length) {
        var empty = document.createElement("div");
        empty.className = "kb-search-empty";
        empty.textContent = mode === "exact"
          ? "无精确匹配。可点搜索框旁的「精确」切回「智能」试试拼音或模糊搜索。"
          : "没有找到相关内容。";
        panel.appendChild(empty);
        return;
      }

      results.forEach(function (res) {
        var link = buildResultLink(res, ctx);
        link.addEventListener("mouseenter", function () {
          select(items.indexOf(link));
        });
        panel.appendChild(link);
        items.push(link);
      });
    }

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("autocomplete", "off");
    panel.setAttribute("role", "listbox");

    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(render, 150);
    });
    input.addEventListener("focus", function () {
      if (input.value.trim()) render();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length) select((selected + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length) select((selected - 1 + items.length) % items.length);
      } else if (e.key === "Enter") {
        var target = items[selected >= 0 ? selected : 0];
        if (target) {
          e.preventDefault();
          window.location.href = target.href;
        }
      } else if (e.key === "Escape") {
        close();
        input.blur();
      }
    });
    if (modeBtn) {
      modeBtn.addEventListener("click", function () {
        mode = mode === "exact" ? "smart" : "exact";
        try { localStorage.setItem("kbSearchMode", mode); } catch (e) { /* ignore */ }
        syncModeBtn();
        if (input.value.trim()) render();
        input.focus();
      });
    }
    document.addEventListener("click", function (e) {
      if (!panel.contains(e.target) && e.target !== input && e.target !== modeBtn) close();
    });

    syncModeBtn();
  };
})();
