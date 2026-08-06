/* app.js — 页面编排：注入页头/右侧栏/面包屑，渲染首页，绑定全局快捷键。
 * 必须最后加载（依赖 theme/nav/toc/search 已注册到 window.KB）。 */
(function () {
  "use strict";
  var KB = (window.KB = window.KB || {});

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  /* 由 data-kb-root 的 ../ 数量推出当前页相对根目录的 url（与索引中的 url 同格式） */
  function detectCurrentUrl(root) {
    var depth = (root.match(/\.\.\//g) || []).length;
    if (!depth) return null; // 根目录只有 index.html
    var segs = decodeURIComponent(window.location.pathname)
      .split("/")
      .filter(function (s) { return s.length; });
    return segs.slice(-(depth + 1)).join("/").normalize("NFC");
  }

  function findPage(pages, url) {
    if (!url) return null;
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].url === url) return pages[i];
    }
    return null;
  }

  // ---------------------------------------------------------- 页头
  function injectHeader(ctx) {
    var header = document.getElementById("kb-header");
    if (!header) return;
    header.innerHTML =
      '<div class="kb-header-inner">' +
      '  <a class="kb-logo" href="' + ctx.root + 'index.html">' +
      '    <span aria-hidden="true">📚</span><span class="kb-logo-text">个人知识库</span></a>' +
      '  <div class="kb-header-search">' +
      '    <div class="kb-search">' +
      '      <span class="kb-search-icon" aria-hidden="true">🔍</span>' +
      '      <input class="kb-search-input" type="search" placeholder="搜索知识库（按 / 聚焦）" aria-label="搜索知识库">' +
      '      <button class="kb-search-mode" type="button"></button>' +
      '      <div class="kb-search-panel"></div>' +
      '    </div>' +
      '  </div>' +
      '  <div class="kb-header-actions">' +
      '    <button class="kb-btn kb-icon-btn kb-theme-btn" type="button" aria-label="切换深浅色主题"></button>' +
      '  </div>' +
      "</div>";

    var themeBtn = header.querySelector(".kb-theme-btn");
    themeBtn.textContent = KB.currentTheme() === "dark" ? "☀️" : "🌙";
    themeBtn.addEventListener("click", KB.toggleTheme);

    KB.setupSearch(
      header.querySelector(".kb-search-input"),
      header.querySelector(".kb-search-panel"),
      header.querySelector(".kb-search-mode"),
      ctx
    );

    if (!window.KB_INDEX) {
      var notice = document.createElement("div");
      notice.className = "kb-notice";
      notice.textContent = "⚠️ 搜索索引未生成：请双击 start.command 启动（会自动重建索引），或手动运行 python3 scripts/build_index.py";
      header.insertAdjacentElement("afterend", notice); // header 高度固定，通知条放在其下方
    }
  }

  // ---------------------------------------------------------- 面包屑
  function injectBreadcrumb(ctx) {
    var main = document.getElementById("kb-content");
    var article = main && main.querySelector("article");
    if (!article || !ctx.currentUrl) return;

    var page = findPage(ctx.pages, ctx.currentUrl);
    var cats = page
      ? page.category
      : ctx.currentUrl.split("/").slice(1, -1); // 索引没有本页时退回路径推断
    var title = page
      ? page.title
      : (document.querySelector("h1") || {}).textContent || "本页";

    var nav = document.createElement("nav");
    nav.className = "kb-breadcrumb";
    nav.setAttribute("aria-label", "位置");

    var home = document.createElement("a");
    home.href = ctx.root + "index.html";
    home.textContent = "首页";
    nav.appendChild(home);

    (cats || []).forEach(function (name) {
      var sep = document.createElement("span");
      sep.className = "kb-bc-sep";
      sep.textContent = "›";
      nav.appendChild(sep);
      var a = document.createElement("a");
      a.href = ctx.root + "index.html#cat-" + encodeURIComponent(name);
      a.textContent = name;
      nav.appendChild(a);
    });

    var sep2 = document.createElement("span");
    sep2.className = "kb-bc-sep";
    sep2.textContent = "›";
    nav.appendChild(sep2);
    var cur = document.createElement("span");
    cur.className = "kb-bc-current";
    cur.textContent = title;
    nav.appendChild(cur);

    main.insertBefore(nav, article);
  }

  // ---------------------------------------------------------- 右侧栏
  function injectSidebar(ctx) {
    var aside = document.getElementById("kb-sidebar");
    if (!aside) return;

    // 本页目录
    var tocSection = document.createElement("section");
    tocSection.className = "kb-side-section";
    var tocTitle = document.createElement("h2");
    tocTitle.className = "kb-side-title";
    tocTitle.textContent = "本页目录";
    tocSection.appendChild(tocTitle);
    if (KB.renderToc && KB.renderToc(tocSection)) {
      aside.appendChild(tocSection);
    }

    // 知识树
    var treeSection = document.createElement("section");
    treeSection.className = "kb-side-section";
    var treeTitle = document.createElement("h2");
    treeTitle.className = "kb-side-title";
    treeTitle.textContent = "知识树";
    treeSection.appendChild(treeTitle);
    var treeBox = document.createElement("div");
    treeBox.className = "kb-tree";
    if (window.KB_INDEX && KB.renderNav) {
      KB.renderNav(treeBox, ctx);
    } else {
      var hint = document.createElement("p");
      hint.textContent = "索引未生成，知识树暂不可用。";
      treeBox.appendChild(hint);
    }
    treeSection.appendChild(treeBox);
    aside.appendChild(treeSection);

    // 窄屏抽屉开关
    var fab = document.createElement("button");
    fab.className = "kb-sidebar-fab";
    fab.type = "button";
    fab.textContent = "☰";
    fab.setAttribute("aria-label", "打开目录与知识树");
    var backdrop = document.createElement("div");
    backdrop.className = "kb-sidebar-backdrop";

    function setDrawer(open) {
      aside.classList.toggle("kb-open", open);
      backdrop.classList.toggle("kb-open", open);
    }
    fab.addEventListener("click", function () {
      setDrawer(!aside.classList.contains("kb-open"));
    });
    backdrop.addEventListener("click", function () { setDrawer(false); });
    aside.addEventListener("click", function (e) {
      if (e.target.closest("a")) setDrawer(false);
    });
    document.body.appendChild(fab);
    document.body.appendChild(backdrop);
  }

  // ---------------------------------------------------------- 首页
  function categoryOf(p) {
    return (p.category && p.category[0]) || "未分类";
  }

  function renderHome(ctx) {
    var catBox = document.getElementById("kb-home-categories");
    var recentBox = document.getElementById("kb-home-recent");
    var metaBox = document.getElementById("kb-home-meta");
    if (!catBox && !recentBox) return;

    var heroInput = document.getElementById("kb-hero-search");
    if (heroInput) {
      KB.setupSearch(
        heroInput,
        document.getElementById("kb-hero-panel"),
        document.getElementById("kb-hero-mode"),
        ctx
      );
    }

    if (!window.KB_INDEX) {
      if (catBox) {
        var p = document.createElement("p");
        p.textContent = "索引未生成。请双击 start.command，或运行 python3 scripts/build_index.py 后刷新。";
        catBox.appendChild(p);
      }
      return;
    }

    var pages = ctx.pages;
    var collator = new Intl.Collator("zh-Hans-CN", { numeric: true });

    if (catBox) {
      var groups = new Map();
      pages.forEach(function (p) {
        var c = categoryOf(p);
        if (!groups.has(c)) groups.set(c, []);
        groups.get(c).push(p);
      });
      Array.from(groups.keys()).sort(collator.compare).forEach(function (name) {
        var list = groups.get(name).slice().sort(function (a, b) {
          return collator.compare(a.url, b.url);
        });
        var card = document.createElement("div");
        card.className = "kb-cat-card";
        card.id = "cat-" + name;

        var head = document.createElement("div");
        head.className = "kb-cat-head";
        var avatar = document.createElement("div");
        avatar.className = "kb-cat-avatar";
        avatar.textContent = name.slice(0, 1);
        head.appendChild(avatar);
        var nameBox = document.createElement("div");
        var nm = document.createElement("div");
        nm.className = "kb-cat-name";
        nm.textContent = name;
        var meta = document.createElement("div");
        meta.className = "kb-cat-meta";
        meta.textContent = list.length + " 篇";
        nameBox.appendChild(nm);
        nameBox.appendChild(meta);
        head.appendChild(nameBox);
        card.appendChild(head);

        function pageItem(p) {
          var li = document.createElement("li");
          var sub = p.category.slice(1).join(" / ");
          if (sub) {
            var subEl = document.createElement("span");
            subEl.className = "kb-cat-sub";
            subEl.textContent = sub;
            li.appendChild(subEl);
          }
          var a = document.createElement("a");
          a.href = encodeURI(ctx.root + p.url);
          a.textContent = p.title;
          li.appendChild(a);
          return li;
        }

        var ul = document.createElement("ul");
        ul.className = "kb-cat-pages";
        list.slice(0, 5).forEach(function (p) { ul.appendChild(pageItem(p)); });
        card.appendChild(ul);

        if (list.length > 5) {
          var more = document.createElement("details");
          more.className = "kb-cat-more";
          var sum = document.createElement("summary");
          sum.textContent = "展开全部 " + list.length + " 篇";
          more.appendChild(sum);
          var ul2 = document.createElement("ul");
          ul2.className = "kb-cat-pages";
          list.slice(5).forEach(function (p) { ul2.appendChild(pageItem(p)); });
          more.appendChild(ul2);
          card.appendChild(more);
        }
        catBox.appendChild(card);
      });
    }

    if (recentBox) {
      var recent = pages.slice().sort(function (a, b) {
        return (b.updated || "").localeCompare(a.updated || "") ||
          collator.compare(a.title, b.title);
      }).slice(0, 10);
      recent.forEach(function (p) {
        var li = document.createElement("li");
        var a = document.createElement("a");
        a.href = encodeURI(ctx.root + p.url);
        var t = document.createElement("span");
        t.textContent = p.title;
        var path = document.createElement("span");
        path.className = "kb-recent-path";
        path.textContent = (p.category || []).join(" › ");
        var d = document.createElement("span");
        d.className = "kb-recent-date";
        d.textContent = p.updated || "";
        a.appendChild(t);
        a.appendChild(path);
        a.appendChild(d);
        li.appendChild(a);
        recentBox.appendChild(li);
      });
    }

    if (metaBox && window.KB_INDEX) {
      var ts = (window.KB_INDEX.generatedAt || "").replace("T", " ").slice(0, 16);
      metaBox.textContent = "共 " + window.KB_INDEX.pageCount + " 篇 · 索引生成于 " + ts;
    }
  }

  // ---------------------------------------------------------- 启动
  ready(function () {
    var root = document.documentElement.getAttribute("data-kb-root") || "";
    var pages = (window.KB_INDEX && window.KB_INDEX.pages) || [];
    var ctx = {
      root: root,
      pages: pages,
      currentUrl: detectCurrentUrl(root)
    };

    injectHeader(ctx);
    if (document.getElementById("kb-sidebar")) {
      injectBreadcrumb(ctx);
      injectSidebar(ctx);
    }
    renderHome(ctx);

    // 全局快捷键：/ 聚焦搜索
    document.addEventListener("keydown", function (e) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      var input = document.getElementById("kb-hero-search") ||
        document.querySelector(".kb-header-search .kb-search-input");
      if (input) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });
  });
})();
