/* theme.js — 深浅色主题切换。首帧主题由各页 <head> 内联脚本设置，这里只负责切换与记忆。 */
(function () {
  "use strict";
  var KB = (window.KB = window.KB || {});

  KB.currentTheme = function () {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  };

  KB.toggleTheme = function () {
    var next = KB.currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("kbTheme", next);
    } catch (e) { /* 隐私模式下静默失败 */ }
    var btn = document.querySelector(".kb-theme-btn");
    if (btn) btn.textContent = next === "dark" ? "☀️" : "🌙";
    return next;
  };
})();
