# CLAUDE.md — 个人知识库内容创作约定

本项目是纯静态个人知识库：用户让你新增/修改某主题的知识页面，你按本文约定生成 HTML 并重建索引。**页面质量目标：图文并茂、讲透原理、现代易读**——优先用图示/动画/交互演示帮助理解，而不是堆文字。

## 铁律

1. **纯静态零依赖**：不引入 npm、构建工具、ES module、外部 CDN/网络资源。前端只用 classic `<script defer>`（ES module 在 file:// 下会被浏览器拦截）。
2. **改动 content/ 后必须重跑** `python3 scripts/build_index.py`，并确认输出“无警告”。
3. **不得手改 `assets/generated/`**（由脚本生成）。
4. slug 算法在 `scripts/build_index.py` 与 `assets/js/toc.js` 双实现，**改一处必须同步另一处**，否则搜索深链锚点会失效。

## 新增页面标准流程

1. **定分类路径**：先看 `content/` 现有目录树，能归入既有分类就不新建；层级不超过 3 层目录。文件夹名 = 简短中文分类名（不含空格和 `/`），文件名 = `主题名.html`。
2. **复制模板** `templates/page-template.html` 到目标路径。
3. **替换 `{{ROOT}}`** 为 `../` × 目录深度：
   | 路径 | ROOT |
   |---|---|
   | `content/分类/页面.html` | `../../` |
   | `content/分类/子分类/页面.html` | `../../../` |
   | `content/分类/子分类/系列/页面.html` | `../../../../` |
4. **填 meta**：`<title>标题 · 知识库</title>`、`kb:summary`（120 字内摘要）、`kb:tags`（逗号分隔，可放拼音别名）、`kb:created`（当天日期 YYYY-MM-DD）。
5. **写正文**（排版约定见下）。媒体文件放同级 `_media/` 目录（`_` 前缀目录不会被索引）。
6. **按需追加库**：在页尾脚本区（`app.js` 之后）按需追加，注意先后顺序：

   | 需要什么 | 追加的脚本 | 暴露 |
   |---|---|---|
   | 3D 模型 `<model-viewer>` | `{{ROOT}}assets/vendor/model-viewer-umd.min.js` | — |
   | 发声、指板图、和弦图、TAB | `{{ROOT}}assets/js/guitar-kit.js` | `window.KBG` |
   | 鼓、贝斯、多轨混音、段落时间轴、频段图 | 先 guitar-kit，再 `{{ROOT}}assets/js/band-kit.js` | `window.KBB` |
7. **重建索引**：`python3 scripts/build_index.py`，warning 必须清零（脚本会检查 h1 数量、ROOT 深度、img alt、_media 引用是否存在等）。
8. **抽查**：`curl -s "http://127.0.0.1:8923/<url编码路径>"` 返回 200，或浏览器打开确认导航树/搜索可见本页。

## 正文排版约定

- 一页**恰好一个 `<h1>`**；小节用 `<h2>`/`<h3>`，语义分层不跳级；开头写一段 `<p class="kb-lead">` 导语。
- **图片必须有 `alt` 和 `width`/`height`**，加 `loading="lazy"`。示意图优先手写**内联 SVG**（颜色用 `var(--kb-fg)` / `var(--kb-accent)` 等令牌以适配深浅色；强调色可用固定值如 `#16a34a`/`#ef4444`）。
- 图示包 `<figure>` + `<figcaption>`；表格包 `<div class="kb-table-wrap">`；行内数学量用 `<em class="kb-math">x</em>`，公式块用 `<pre><code>`。
- 提示框：`<div class="kb-callout kb-info|kb-tip|kb-warn|kb-danger"><p class="kb-callout-title">…</p><p>…</p></div>`。页尾放一个 kb-tip 的“本页要点”。
- 习题：`<section class="kb-exercise"><p class="kb-exercise-title">✏️ 习题 N.N <span class="kb-exercise-badge">基础</span></p><p>题目</p><details class="kb-answer"><summary>查看答案与解析</summary>…</details></section>`。难度徽章：基础（默认）/ `kb-adv` 进阶 / `kb-hard` 挑战；答案默认折叠且必须含**解析**而不只是结果。
- 动画优先级：**CSS 动画 >** `<video muted loop playsinline>` **> GIF**。页面专属 CSS 写在该页 `<head>` 的 `<style>` 里。

## 交互演示约定

- 结构：`.kb-interactive` > `.kb-interactive-header`（标题）+ `.kb-interactive-body`（canvas/SVG + `.kb-interactive-controls` 控件行）。容器内放 `<noscript>` 兜底文案（写明演示的核心结论）。
- 页面专属 JS 放页尾内联 `<script>` 或同级 `_media/*.js`，**必须包在 `DOMContentLoaded` 回调里**（defer 脚本此时已就绪，可安全用 `KB.*`）。
- 用 `assets/js/interactive.js` 的辅助：`KB.fitCanvas(canvas, 高度)`（高分屏适配）、`KB.bindRange(滑块, 数值元素, format, onChange)`、`KB.makeLoop(step)`（动画循环）、`KB.enableDrag(canvas, hitTest, onMove, onEnd)`（画布拖拽，配 `kb-canvas-drag` 类）、`KB.motionOK`（false 时默认暂停动画，仅允许用户手动播放）。
- 画布取色用 `getComputedStyle` 读 CSS 变量（`--kb-fg`、`--kb-accent` 等），保证深浅色主题都可读。
- 参考实现：`content/物理/力学/单摆.html`。

## 音乐类页面约定（guitar-kit / band-kit）

音乐教材的发声与图形能力集中在两个共享库里，**不要在页面里重复实现**：

- **`assets/js/guitar-kit.js`（`KBG`）**
  - `KBG.theory`：音名/音程/音阶/和弦/顺阶/五度圈/CAGED 与横按形状推导——**全书的乐理真值来源**，习题与控件共用，避免各页各写一份而互相矛盾。
  - `KBG.audio`：Karplus–Strong 拨弦合成 + 可调失真链、推弦/揉弦、`sequence`/`metronome`。**只在首次用户手势时创建 AudioContext，绝不自动播放**；页面隐藏时自动 `stopAll()`。
  - `KBG.audio.channel({drive,gain,pan,lp,hp})`：独立通道，多轨编曲每个声部走一条；`pluck/strum/sequence` 都可传 `channel`。
  - `KBG.fretboard / chordbox / tab`：SVG 指板、和弦指法图、六线谱与播放光标。
  - `KBG.soundToggle(host)`：页面级 🔊 开关 + 音量，每章第一个演示上方放一个。
- **`assets/js/band-kit.js`（`KBB`，依赖 KBG）**
  - `KBB.drums` / `KBB.bass`：离线渲染并缓存的鼓组与贝斯音色。`KBB.drums.PIECES` 里的频段数字是**对合成结果的实测值**，改音色必须重测并同步该表。
  - `KBB.tracks(spec)`：多轨播放器，静音/独奏靠改通道音量**实时生效**，不打断循环。每轨可传 `lp`/`hp` 覆盖通道滤波（贝斯双轨分频、吉他高通 A/B 靠它）。
  - `KBB.mixer / KBB.timeline / KBB.spectrum`：混音台 UI、段落时间轴、频段占位图。三者都返回 `redraw()`——**页面必须挂一个监听 `data-theme` 的 MutationObserver 调它**，否则切主题后 canvas 不重绘（颜色取自 CSS 变量）。
- 合成参数改动后要做**数值验证**（无法靠耳朵时的替代手段）：用 node 打桩 Web Audio 抓出波形，测音高（细粒度 DFT）、扫频轨迹（过零点法）、能量频段。

## 媒体资源约定

- 图片 SVG/WebP/PNG；视频 MP4(H.264)；3D 模型 **.glb ≤ 10MB 且必须配 `poster` 图**（file:// 降级显示）。
- 一律本地存放于页面同级 `_media/`，**不引用外链**。
- 简单几何体 glb 可参考会话生成脚本的思路用 python 手工生成（见 `content/数学/立体几何/_media/cube.glb`）。

## 系列教材约定

多章成套的教材（如线性代数教材）放 `content/<分类>/<子分类>/教材/`，遵守：

- **大纲先行**：`00-大纲与学习路线.html` 是教材总纲，规定章节划分、每章固定结构与习题配比。写任何一章之前先读它。
- **编号命名**：文件名与页面标题都用 `NN 章名` 前缀（`01-向量从箭头到数组.html` / 标题 `01 向量：从箭头到数组`），保证导航树按学习顺序排序。
- **每章固定结构**：学习目标 → 直觉引入 → 正文（图示/交互演示）→ 例题（带完整解答）→ 习题（基础 3–4 / 进阶 2–3 / 挑战 1–2，全部折叠详解）→ 要点回顾（kb-tip，含下一章预告）。
- **写完一章的收尾动作**：① 在大纲页把该章状态改为“已上线”并加链接；② 章末加“下一章”链接（若已存在）；③ 重跑索引。
- 现行教材：线性代数（`content/数学/线性代数/教材/`）、上流工程、游戏设计、**电吉他乐理**（`content/音乐/吉他乐理/教材/`，三篇十六章，全部完成）、**摇滚与金属的作曲与编曲**（`content/音乐/作曲与编曲/教材/`，电吉他乐理的续篇，三篇十六章，全部完成）。
- 音乐类教材之间**互相链接**：续篇直接指向前一本的具体章节与小节锚点，不重复讲解乐理。

## 修改共享层（assets/、scripts/、模板）时

- 改 CSS 优先复用 `theme.css` 设计令牌，新组件类加 `kb-` 前缀。
- 改搜索/导航逻辑后，跑一遍验证清单。
- 搜索结果渲染必须用 `createTextNode`/`createElement` 拼装，禁止用 innerHTML 拼接索引/用户文本（XSS）。

## 验证清单

1. `python3 scripts/build_index.py` → “无警告”。
2. `./start.sh` 启动后：新页出现在右侧知识树；首页分类卡片计数正确。
3. 搜索：标题原文、拼音首字母（如 `jz`）、小节标题各搜一次都能命中；小节命中可深链跳转。
4. 切换深浅色主题：页面内 SVG/canvas/交互演示仍清晰可读。
5. 窄屏（≤900px）：右侧栏收为右下角 ☰ 抽屉。

## 种子示例（各能力的参考页）

| 能力 | 参考页 |
|---|---|
| 图文 + 内联 SVG + 表格 + callout | `content/数学/线性代数/矩阵.html` |
| 纯 CSS 动画 | `content/物理/波与振动/简谐波.html` |
| 滑块 + canvas 交互模拟 | `content/物理/力学/单摆.html` |
| 3D 模型 (model-viewer + glb) | `content/数学/立体几何/正方体.html` |
| 发声 + 指板 + TAB (guitar-kit) | `content/音乐/吉他乐理/教材/01-音律与指板.html` |
| 鼓 + 多轨混音 (band-kit) | `content/音乐/作曲与编曲/教材/`（见该书大纲页） |
