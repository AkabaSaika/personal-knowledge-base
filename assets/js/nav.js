/* nav.js — 从 KB_INDEX.pages 的 category 数组重建分类树，渲染右侧栏"知识树"。
 * 由 app.js 调用：KB.renderNav(container, ctx)，ctx = {root, pages, currentUrl}。 */
(function () {
  "use strict";
  var KB = (window.KB = window.KB || {});
  var collator = new Intl.Collator("zh-Hans-CN", { numeric: true });

  function buildTree(pages) {
    var root = { name: "", children: new Map(), pages: [] };
    pages.forEach(function (p) {
      var node = root;
      (p.category || []).forEach(function (name) {
        if (!node.children.has(name)) {
          node.children.set(name, { name: name, children: new Map(), pages: [] });
        }
        node = node.children.get(name);
      });
      node.pages.push(p);
    });
    return root;
  }

  function sortedChildren(node) {
    return Array.from(node.children.values()).sort(function (a, b) {
      return collator.compare(a.name, b.name);
    });
  }

  function sortedPages(node) {
    return node.pages.slice().sort(function (a, b) {
      return collator.compare(a.title, b.title);
    });
  }

  // 记忆手动展开/收起状态（会话内）
  function loadState() {
    try {
      return JSON.parse(sessionStorage.getItem("kbNavOpen") || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveState(state) {
    try {
      sessionStorage.setItem("kbNavOpen", JSON.stringify(state));
    } catch (e) { /* ignore */ }
  }

  function containsCurrent(node, currentUrl) {
    if (!currentUrl) return false;
    if (node.pages.some(function (p) { return p.url === currentUrl; })) return true;
    var found = false;
    node.children.forEach(function (child) {
      if (containsCurrent(child, currentUrl)) found = true;
    });
    return found;
  }

  function renderNode(node, ctx, state, pathKey) {
    var frag = document.createDocumentFragment();

    sortedChildren(node).forEach(function (child) {
      var key = pathKey + "/" + child.name;
      var details = document.createElement("details");
      var hasCurrent = containsCurrent(child, ctx.currentUrl);
      details.open = key in state ? !!state[key] : hasCurrent;
      details.addEventListener("toggle", function () {
        state[key] = details.open;
        saveState(state);
      });

      var summary = document.createElement("summary");
      summary.textContent = child.name;
      details.appendChild(summary);

      var box = document.createElement("div");
      box.className = "kb-tree-children";
      box.appendChild(renderNode(child, ctx, state, key));
      details.appendChild(box);
      frag.appendChild(details);
    });

    sortedPages(node).forEach(function (p) {
      var a = document.createElement("a");
      a.className = "kb-tree-page";
      a.textContent = p.title;
      a.href = encodeURI(ctx.root + p.url);
      if (ctx.currentUrl && p.url === ctx.currentUrl) {
        a.setAttribute("aria-current", "page");
      }
      frag.appendChild(a);
    });

    return frag;
  }

  KB.renderNav = function (container, ctx) {
    var tree = buildTree(ctx.pages);
    container.textContent = "";
    if (!ctx.pages.length) {
      var p = document.createElement("p");
      p.textContent = "暂无内容";
      container.appendChild(p);
      return;
    }
    container.appendChild(renderNode(tree, ctx, loadState(), ""));
  };
})();
