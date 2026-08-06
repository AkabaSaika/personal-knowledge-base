/* interactive.js — 页内交互演示的通用辅助：高分屏画布、滑块联动、动画循环。
 * 页面专属逻辑放各页 _media/*.js 或页尾内联 <script>，只依赖这里的 KB.* 辅助。 */
(function () {
  "use strict";
  var KB = (window.KB = window.KB || {});

  /* 用户偏好减少动态效果时为 false；演示应据此默认暂停（用户手动点播放仍可运行） */
  KB.motionOK = !(window.matchMedia &&
    matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* 按容器宽度 + devicePixelRatio 适配画布，返回 2D context。
   * 后续窗口缩放会自动重设尺寸并回调 onResize(width, height)（重设会清空画布，
   * 调用方应在回调里重绘）。初始适配不触发回调（此时调用方多半尚未初始化完毕）。 */
  KB.fitCanvas = function (canvas, cssHeight, onResize) {
    var ctx = canvas.getContext("2d");
    function resize(fireCallback) {
      var dpr = window.devicePixelRatio || 1;
      var w = canvas.clientWidth || canvas.parentNode.clientWidth || 600;
      canvas.style.height = cssHeight + "px";
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (fireCallback && onResize) onResize(w, cssHeight);
    }
    resize(false);
    window.addEventListener("resize", function () { resize(true); });
    return ctx;
  };

  /* 滑块与数值显示联动。format(value) 返回显示文本；onChange(value) 立即回调一次。
   * 返回读取当前值的函数。 */
  KB.bindRange = function (rangeEl, valueEl, format, onChange) {
    function fire() {
      var v = parseFloat(rangeEl.value);
      if (valueEl) valueEl.textContent = format ? format(v) : String(v);
      if (onChange) onChange(v);
    }
    rangeEl.addEventListener("input", fire);
    fire();
    return function () { return parseFloat(rangeEl.value); };
  };

  /* 画布拖拽辅助（Pointer Events，鼠标/触屏通用）。
   * hitTest(x, y) 返回被抓取的对象（null/undefined 表示未命中）；
   * onMove(target, x, y) 拖动中回调；onEnd() 松手回调（可选）。
   * 坐标均为相对画布左上角的 CSS 像素。配合 .kb-canvas-drag 类禁用触屏滚动手势。 */
  KB.enableDrag = function (canvas, hitTest, onMove, onEnd) {
    var active = null;
    canvas.addEventListener("pointerdown", function (e) {
      var r = canvas.getBoundingClientRect();
      var t = hitTest(e.clientX - r.left, e.clientY - r.top);
      if (t !== null && t !== undefined) {
        active = t;
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    });
    canvas.addEventListener("pointermove", function (e) {
      if (active === null) return;
      var r = canvas.getBoundingClientRect();
      onMove(active, e.clientX - r.left, e.clientY - r.top);
    });
    function release() {
      if (active === null) return;
      active = null;
      if (onEnd) onEnd();
    }
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
  };

  /* requestAnimationFrame 循环封装。step(dt, t)：dt 为秒（限幅防后台切回跳变）。
   * 返回 {start, stop, toggle, running}。 */
  KB.makeLoop = function (step) {
    var running = false;
    var last = null;
    var elapsed = 0;

    function frame(now) {
      if (!running) return;
      if (last === null) last = now;
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += dt;
      step(dt, elapsed);
      requestAnimationFrame(frame);
    }

    return {
      start: function () {
        if (running) return;
        running = true;
        last = null;
        requestAnimationFrame(frame);
      },
      stop: function () {
        running = false;
        last = null;
      },
      toggle: function () {
        this.running() ? this.stop() : this.start();
      },
      running: function () { return running; }
    };
  };
})();
