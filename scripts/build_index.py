#!/usr/bin/env python3
"""build_index.py — 扫描 content/ 生成导航与搜索索引 assets/generated/site-index.js

用法：python3 scripts/build_index.py   （任意 cwd 均可）

规则：
- 只索引 content/**/*.html；名字以 "_" 或 "." 开头的目录/文件跳过（_media/ 因此天然排除）。
- 每页提取 title、h2/h3 标题、正文纯文本、meta（kb:summary / kb:tags / kb:created）。
- 汉字转拼音首字母（GBK 区位表法，零依赖），供前端拼音模糊搜索。
- 输出 window.KB_INDEX = {...}（JS 全局变量而非 JSON 文件，file:// 协议下也能加载）。

一致性约束：
- slugify() 必须与 assets/js/toc.js 中的 slugify() 逐字一致（两处互相引用）。
- 拼音串与原文的字符对齐规则必须与 assets/js/search.js 中 pyMap 的构建规则一致：
  每个 U+4E00–U+9FFF 汉字恒贡献 1 个字符（查不到首字母用 "_" 占位），
  每个 ASCII 字母/数字贡献其小写自身，其余字符跳过。
"""

import json
import re
import sys
import unicodedata
from bisect import bisect_right
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT_DIR = ROOT / "content"
OUT_FILE = ROOT / "assets" / "generated" / "site-index.js"
BODY_LIMIT = 6000

warnings: list[str] = []


def warn(msg: str) -> None:
    warnings.append(msg)
    print(f"warning: {msg}", file=sys.stderr)


# ---------------------------------------------------------------- 拼音首字母
# GBK 一级汉字区（B0A1–D7F9）按拼音排序，经典声母分界表。
# 二级汉字区按部首排序无法映射，返回 None。多音字取表中默认音（已知局限）。
_GBK_BOUNDS = [
    (0xB0A1, "a"), (0xB0C5, "b"), (0xB2C1, "c"), (0xB4EE, "d"),
    (0xB6EA, "e"), (0xB7A2, "f"), (0xB8C1, "g"), (0xB9FE, "h"),
    (0xBBF7, "j"), (0xBFA6, "k"), (0xC0AC, "l"), (0xC2E8, "m"),
    (0xC4C3, "n"), (0xC5B6, "o"), (0xC5BE, "p"), (0xC6DA, "q"),
    (0xC8BB, "r"), (0xC8F6, "s"), (0xCBFA, "t"), (0xCDDA, "w"),
    (0xCEF4, "x"), (0xD1B9, "y"), (0xD4D1, "z"),
]
_GBK_STARTS = [b[0] for b in _GBK_BOUNDS]


def pinyin_initial(ch: str):
    try:
        b = ch.encode("gbk")
    except UnicodeEncodeError:
        return None
    if len(b) != 2:
        return None
    code = (b[0] << 8) | b[1]
    if not (0xB0A1 <= code <= 0xD7F9):
        return None
    return _GBK_BOUNDS[bisect_right(_GBK_STARTS, code) - 1][1]


def py_of(text: str) -> str:
    """拼音首字母串。对齐规则见文件头注释，与 search.js 的 pyMap 构建保持一致。"""
    out = []
    for ch in text:
        if "一" <= ch <= "鿿":
            out.append(pinyin_initial(ch) or "_")
        elif ch.isascii() and ch.isalnum():
            out.append(ch.lower())
    return "".join(out)


# ---------------------------------------------------------------- slug
def slugify(text: str, used: set) -> str:
    """标题锚点 id。必须与 assets/js/toc.js 的 slugify() 逐字一致。"""
    s = unicodedata.normalize("NFC", text).strip().lower()
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"[^a-z0-9_一-鿿-]", "", s)
    if not s:
        s = "section"
    base, n = s, 2
    while s in used:
        s = f"{base}-{n}"
        n += 1
    used.add(s)
    return s


# ---------------------------------------------------------------- HTML 解析
_IGNORED_TAGS = {"script", "style", "template", "noscript", "header",
                 "aside", "nav", "footer", "svg"}


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.meta = {}
        self.headings = []          # [{"l": 2, "t": "...", "id": str|None}]
        self.body_parts = []
        self.h1_count = 0
        self.css_hrefs = []
        self.script_srcs = []
        self.media_refs = []        # 页面引用的 ./_media/ 资源
        self.imgs_missing_alt = 0
        self.uses_model_viewer = False
        self._in_title = False
        self._ignore_depth = 0
        self._heading = None        # 正在收集的标题 (level, id, parts)

    def _collect_ref(self, val):
        if val and (val.startswith("./_media/") or val.startswith("_media/")):
            self.media_refs.append(val)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in _IGNORED_TAGS:
            if tag == "script":
                src = a.get("src") or ""
                self.script_srcs.append(src)
                self._collect_ref(src)
            self._ignore_depth += 1
            return
        if self._ignore_depth:
            return
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            name = a.get("name") or ""
            if name.startswith("kb:"):
                self.meta[name[3:]] = (a.get("content") or "").strip()
        elif tag == "link":
            if "stylesheet" in (a.get("rel") or ""):
                self.css_hrefs.append(a.get("href") or "")
        elif tag in ("h1", "h2", "h3"):
            level = int(tag[1])
            if level == 1:
                self.h1_count += 1
            self._heading = (level, a.get("id"), [])
        elif tag == "img":
            if not (a.get("alt") or "").strip():
                self.imgs_missing_alt += 1
            self._collect_ref(a.get("src"))
        elif tag == "model-viewer":
            self.uses_model_viewer = True
            self._collect_ref(a.get("src"))
            self._collect_ref(a.get("poster"))
        elif tag in ("video", "source", "audio"):
            self._collect_ref(a.get("src"))

    def handle_startendtag(self, tag, attrs):
        if tag not in _IGNORED_TAGS:
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag in _IGNORED_TAGS:
            self._ignore_depth = max(0, self._ignore_depth - 1)
            return
        if tag == "title":
            self._in_title = False
        elif tag in ("h1", "h2", "h3") and self._heading:
            level, hid, parts = self._heading
            text = _squash(" ".join(parts))
            if text and level >= 2:  # h1 由 title 承担，headings 只收 h2/h3
                self.headings.append({"l": level, "t": text, "id": hid})
            self._heading = None

    def handle_data(self, data):
        if self._ignore_depth:
            return
        if self._in_title:
            self.title += data
        elif self._heading is not None:
            self._heading[2].append(data)
        else:
            self.body_parts.append(data)


def _squash(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


# ---------------------------------------------------------------- 单页处理
def parse_page(path: Path) -> dict:
    rel = path.relative_to(ROOT).as_posix()
    depth = len(path.relative_to(ROOT).parts) - 1  # 相对根目录的目录层数

    parser = PageParser()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()

    title = _squash(parser.title)
    title = re.sub(r"\s*[·|—-]\s*知识库\s*$", "", title)
    if not title:
        title = path.stem
        warn(f"{rel}: 缺少 <title>，退回文件名作标题")

    if parser.h1_count != 1:
        warn(f"{rel}: 应恰有 1 个 <h1>，实际 {parser.h1_count} 个")

    # 校验 css 引用的 ../ 数量与目录深度一致
    theme_href = next((h for h in parser.css_hrefs if "assets/css/theme.css" in h), None)
    if theme_href is None:
        warn(f"{rel}: 未引用 assets/css/theme.css")
    elif theme_href.count("../") != depth:
        warn(f"{rel}: 样式引用前缀 ../ 数量({theme_href.count('../')})与目录深度({depth})不符")

    # 校验 _media 引用存在
    for ref in parser.media_refs:
        target = (path.parent / ref).resolve()
        if not target.exists():
            warn(f"{rel}: 引用的资源不存在 {ref}")

    if parser.uses_model_viewer and not any("model-viewer" in s for s in parser.script_srcs):
        warn(f"{rel}: 使用了 <model-viewer> 但未引入 vendor/model-viewer-umd.min.js")

    # h2/h3 锚点 id：文档序处理，与 toc.js 运行时逻辑一致
    used: set = set()
    headings = []
    for h in parser.headings:
        text = nfc(h["t"])
        if h["id"]:
            hid = h["id"]
            used.add(hid)
        else:
            hid = slugify(text, used)
        headings.append({"l": h["l"], "t": text, "id": hid, "py": py_of(text)})

    body = _squash(" ".join(parser.body_parts))[:BODY_LIMIT]
    summary = parser.meta.get("summary") or body[:120]
    tags = [t.strip() for t in re.split(r"[,，]", parser.meta.get("tags", "")) if t.strip()]
    mtime = datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d")

    category = [nfc(p) for p in path.relative_to(CONTENT_DIR).parts[:-1]]
    return {
        "url": nfc(rel),
        "title": nfc(title),
        "titlePy": py_of(nfc(title)),
        "category": category,
        # 拼接串必须与 search.js 中 cats 字段的 join(" / ") 完全一致，pyMap 对齐才成立
        "categoryPy": py_of(" / ".join(category)),
        "headings": headings,
        "summary": nfc(summary),
        "tags": [nfc(t) for t in tags],
        "body": nfc(body),
        "created": parser.meta.get("created") or mtime,
        "updated": mtime,
    }


# ---------------------------------------------------------------- 主流程
def collect_pages() -> list:
    if not CONTENT_DIR.is_dir():
        warn("content/ 目录不存在")
        return []
    pages = []
    files = sorted(CONTENT_DIR.rglob("*.html"), key=lambda p: p.as_posix())
    for f in files:
        parts = f.relative_to(CONTENT_DIR).parts
        if any(p.startswith(("_", ".")) for p in parts):
            continue
        try:
            pages.append(parse_page(f))
        except Exception as e:  # 单页失败不拖垮整个索引
            warn(f"{f.relative_to(ROOT).as_posix()}: 解析失败 {e}")
    for i, p in enumerate(pages):
        p["id"] = i
    return pages


def main() -> int:
    pages = collect_pages()
    index = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "pageCount": len(pages),
        "pages": pages,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = "// 本文件由 scripts/build_index.py 自动生成，勿手改。\nwindow.KB_INDEX = " \
        + json.dumps(index, ensure_ascii=False, indent=1) + ";\n"
    tmp = OUT_FILE.with_suffix(".js.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(OUT_FILE)
    print(f"已索引 {len(pages)} 页 → {OUT_FILE.relative_to(ROOT)}"
          + (f"（{len(warnings)} 条警告）" if warnings else "，无警告"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
