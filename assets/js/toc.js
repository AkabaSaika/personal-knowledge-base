/* toc.js — 扫描本页 h2/h3 生成"本页目录"，缺失 id 时按 slug 规则补齐，滚动高亮当前小节。
 * 由 app.js 调用：KB.renderToc(container) → 返回是否有目录项。 */
(function () {
  "use strict";
  var KB = (window.KB = window.KB || {});

  /* 标题锚点 id。必须与 scripts/build_index.py 的 slugify() 逐字一致，
   * 否则搜索结果的 #深链 会与页面实际 id 对不上。 */
  function slugify(text, used) {
    var s = text.normalize("NFC").trim().toLowerCase();
    s = s.replace(/\s+/g, "-").replace(/[^a-z0-9_一-鿿-]/g, "");
    if (!s) s = "section";
    var base = s, n = 2;
    while (used.has(s)) {
      s = base + "-" + n;
      n++;
    }
    used.add(s);
    return s;
  }

  KB.renderToc = function (container) {
    var headings = Array.prototype.slice.call(
      document.querySelectorAll("#kb-content h2, #kb-content h3")
    );
    if (!headings.length) return false;

    // 文档序补齐 id（与 build_index.py 的处理顺序一致）
    var used = new Set();
    headings.forEach(function (h) {
      if (h.id) {
        used.add(h.id);
      } else {
        h.id = slugify(h.textContent, used);
      }
    });

    var list = document.createElement("ul");
    list.className = "kb-toc";
    var links = new Map(); // heading element -> link
    headings.forEach(function (h) {
      var li = document.createElement("li");
      li.className = h.tagName === "H3" ? "kb-toc-h3" : "kb-toc-h2";
      var a = document.createElement("a");
      a.textContent = h.textContent;
      a.href = "#" + encodeURIComponent(h.id);
      li.appendChild(a);
      list.appendChild(li);
      links.set(h, a);
    });
    container.appendChild(list);

    // 滚动高亮：取视口上部最近的标题
    var active = null;
    function setActive(h) {
      if (active === h) return;
      if (active && links.get(active)) links.get(active).classList.remove("kb-active");
      active = h;
      if (h && links.get(h)) links.get(h).classList.add("kb-active");
    }
    if ("IntersectionObserver" in window) {
      var visible = new Set();
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) visible.add(e.target);
            else visible.delete(e.target);
          });
          if (visible.size) {
            // 取文档序最靠前的可见标题
            var first = headings.find(function (h) { return visible.has(h); });
            setActive(first);
          }
        },
        { rootMargin: "-60px 0px -60% 0px" }
      );
      headings.forEach(function (h) { io.observe(h); });
      setActive(headings[0]);
    }
    return true;
  };
})();
