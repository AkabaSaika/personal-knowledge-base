# 📚 个人知识库

把想学的知识做成**图文并茂的 HTML 页面**，按文件夹分类存放，一键启动、随存随查。

纯静态、零依赖：不需要 Node、不需要构建工具，只要 macOS 自带的 python3 和一个浏览器。

## 快速开始

**双击根目录的 `start.command`** 即可：它会自动重建索引 → 启动本地服务（端口 8923）→ 打开浏览器。

也可以在终端运行：

```bash
./start.sh
```

> 为什么不直接双击 HTML 文件？直接以 file:// 打开时，文字、导航、搜索都能用，但 Chrome 会拦截 3D 模型等二进制资源的加载。通过 start.command 启动则一切正常。

## 目录结构

```
├── index.html            # 首页：搜索 + 分类总览 + 最近更新
├── start.command         # 一键启动（macOS 双击）
├── content/              # 知识正文，文件夹 = 分类层级
│   └── 数学/线性代数/矩阵.html
│       └── _media/       # 该目录页面共用的图片/3D 模型/视频
├── assets/               # 共享样式、脚本、生成的索引、vendor 库
├── scripts/build_index.py  # 扫描 content/ 生成导航与搜索索引
├── templates/page-template.html  # 新页面骨架
└── CLAUDE.md             # 供 Claude Code 使用的内容创作约定
```

## 如何新增知识页

推荐直接让 Claude Code 做（项目约定都写在 `CLAUDE.md` 里，Claude 会照着执行）：

> 帮我新增一篇《傅里叶变换》的知识页面，要有图示和交互演示

手动新增也可以：复制 `templates/page-template.html` 到 `content/` 下合适的分类目录，替换 `{{ROOT}}` 等占位符，然后运行 `python3 scripts/build_index.py` 重建索引。

**改动 content/ 后记得重跑索引**（start.command 每次启动会自动重跑）。

## 搜索用法

- 按 **`/`** 快速聚焦搜索框，**↑↓** 选择结果，**Enter** 打开，**Esc** 关闭。
- 默认**智能模式**，支持四种匹配（按优先级）：
  | 匹配方式 | 示例 |
  |---|---|
  | 精确子串 | `矩阵` → 矩阵 |
  | 拼音首字母 | `jz` → 矩阵，`xxds` → 线性代数 |
  | 字符子序列 | `矩乘` → 矩阵乘法 |
  | 英文拼写纠错 | `matirx` → matrix |
- 点搜索框旁的 chip 可切换**精确模式**（只按原文子串匹配）。
- 命中小节标题时会直接深链到该小节。

## 页面能力

知识页可以自由组合这些表达手段（种子内容各有一篇示例）：

- **图文**：正文排版、内联 SVG 图示、表格、提示框 → `数学/线性代数/矩阵`
- **CSS 动画**：纯 CSS 的动态演示 → `物理/波与振动/简谐波`
- **交互演示**：滑块调参 + canvas 实时模拟 → `物理/力学/单摆`
- **3D 模型**：可拖拽旋转的 glb 模型 → `数学/立体几何/正方体`

另有一套完整的**线性代数系统教材**（三篇十二章，由浅入深，每章配交互演示与分层习题）：入口在 `数学/线性代数/教材/00-大纲与学习路线`。多章成套的教材编写约定见 CLAUDE.md「系列教材约定」。

深浅色主题自动跟随系统，也可点顶栏按钮手动切换；窄屏下右侧导航收纳为右下角的抽屉按钮。

## FAQ

**启动后浏览器没打开 / 端口被占？** `start.sh` 会检测 8923 端口：已有本知识库服务则直接复用；被其他程序占用则自动顺延端口。

**搜索不到新写的页面？** 索引过期了，重跑 `python3 scripts/build_index.py`（或重启 start.command）。首页页脚会显示索引生成时间。

**3D 模型不显示？** ① 确认通过 start.command 访问而非双击 HTML；② 确认 `assets/vendor/model-viewer-umd.min.js` 存在，缺失时可重新下载：

```bash
curl -L -o assets/vendor/model-viewer-umd.min.js \
  https://cdn.jsdelivr.net/npm/@google/model-viewer/dist/model-viewer-umd.min.js
```

**拼音搜索偶尔不准？** 拼音首字母用的是零依赖的 GBK 区位表法，多音字取默认音（如“重”固定映射一个声母）。可在页面 `kb:tags` 里补写别名兜底。
