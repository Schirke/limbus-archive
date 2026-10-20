"""The interface's English strings, read from the pages' source (ui/*.js): every string and template literal cut into
the pieces a page shows (tags dropped, ${...} -> {n}), with file, line and function. Used by the interface languages
(uilang.status) and scripts/ui_langcheck.py."""
from __future__ import annotations

import html as htmllib
import os
import re

# not interface pages: big games translate themselves, admin pages stay English
SKIP_FILES = {"i18n.js", "beta.js"}
ATTR = re.compile(r"""\b(title|placeholder|aria-label|alt)\s*=\s*(?:"([^"]*)"|'([^']*)')""")
ATTRS_ONLY = re.compile(r"""^\s*[\w-]+=["']|["']\s+[\w-]+=["']""")  # 'data-k="-" title="…"' handed to a tag maker
TAG = re.compile(r"<[^>]*>")
PH = re.compile(r"\{\d+\}")
# code, not text: selectors, paths, css, keys, urls
CODE = re.compile(r"^[#.\[/]|^\w+[:=](?=\S)|\w[\w-]*=[\"']|/api/|://|\bvar\(|&\w+;$|\.(png|jpe?g|json|js|css|webp|mp4|webm|gif|zip|wav|ogg)\b"
                  r"|^[a-z-]+:\s*[^\s;]+(\s+[^\s;]+){0,2};?$|^[\w-]+\s*\{(?!\d+\})|^(rgba?|hsla?|url|calc|translate|scale|rotate|linear-gradient)\(|=>|\$\{|;\s*$|^\{\d+\}(px|%|s|ms|deg)\b")
WORD = re.compile(r"[A-Za-z]{2}")
FN = re.compile(r"^(?:async\s+)?function\s*\*?\s*([\w$]+)|^(?:const|let|var)\s+([\w$]+)\s*=|^(routes\.[\w$]+)\s*=|^\s{0,2}([\w$.]+)\s*=\s*(?:async\s*)?(?:function|\()")
REGEX_BEFORE = set("(,=:[!&|?{};+-*%<>~^") | {""}
KEYWORDS_BEFORE = {"return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"}


def literals(src: str):
    """[(text, line, kind)] of a JS source: kind "str" (quotes) or "tpl" (template, ${} -> {n})."""
    out, n = [], len(src)
    prev = ""  # last significant token (for regex vs division)

    def string(q, i):
        buf, i = [], i + 1
        while i < n and src[i] != q:
            if src[i] == "\\" and i + 1 < n:
                c = src[i + 1]
                buf.append({"n": "\n", "t": "\t", "'": "'", '"': '"', "\\": "\\", "`": "`", "$": "$"}.get(c, "\\" + c if c not in "\n" else ""))
                i += 2
                continue
            if src[i] == "\n" and q != "`":
                break
            buf.append(src[i])
            i += 1
        return "".join(buf), i + 1

    def template(i):
        """reads a template from its backtick; nested ${} are walked as code. Returns (text, next index)."""
        i, k = i + 1, 0
        buf = []
        while i < n:
            c = src[i]
            if c == "\\" and i + 1 < n:
                buf.append({"n": "\n", "t": "\t", "`": "`", "$": "$", "\\": "\\"}.get(src[i + 1], src[i + 1]))
                i += 2
                continue
            if c == "`":
                return "".join(buf), i + 1
            if c == "$" and i + 1 < n and src[i + 1] == "{":
                buf.append("{%d}" % k)
                k += 1
                i = code(i + 2, inner=True)
                continue
            buf.append(c)
            i += 1
        return "".join(buf), i

    def code(i, inner=False):
        nonlocal prev
        depth = 0
        while i < n:
            c = src[i]
            if c == "\n":
                i += 1
                continue
            if c in " \t\r":
                i += 1
                continue
            if src.startswith("//", i):
                j = src.find("\n", i)
                i = n if j < 0 else j
                continue
            if src.startswith("/*", i):
                j = src.find("*/", i + 2)
                i = n if j < 0 else j + 2
                continue
            if c in "'\"":
                ln = src.count("\n", 0, i) + 1
                s, i = string(c, i)
                out.append((s, ln, "str"))
                prev = "s"
                continue
            if c == "`":
                ln = src.count("\n", 0, i) + 1
                s, i = template(i)
                out.append((s, ln, "tpl"))
                prev = "s"
                continue
            if c == "/" and (prev in REGEX_BEFORE or prev in KEYWORDS_BEFORE):
                j, cls = i + 1, False
                while j < n and src[j] != "\n":
                    if src[j] == "\\":
                        j += 2
                        continue
                    if src[j] == "[":
                        cls = True
                    elif src[j] == "]":
                        cls = False
                    elif src[j] == "/" and not cls:
                        break
                    j += 1
                j += 1
                while j < n and (src[j].isalnum()):
                    j += 1
                i, prev = j, "r"
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                if inner and depth == 0:
                    prev = "}"
                    return i + 1
                depth -= 1
            m = re.compile(r"[\w$]+").match(src, i)
            if m:
                prev = m.group(0)
                i = m.end()
                continue
            prev = c
            i += 1
        return i

    code(0)
    return out


def pieces(text: str, kind: str):
    """the visible text pieces of a literal: attribute values, then the text between tags; placeholders renumbered."""
    res = []
    html = bool(re.search(r"<[a-zA-Z/!]", text))
    for m in ATTR.finditer(text):
        if html or ATTRS_ONLY.search(text):
            res.append((m.group(2) if m.group(2) is not None else m.group(3), "attr"))
    for p in TAG.sub("\0", text).split("\0") if html else [text]:
        res.append((p, "html" if html else kind))
    out = []
    for t, k in res:
        t = " ".join((htmllib.unescape(t) if k in ("html", "attr") else t).split())
        c = iter(range(99))
        t = PH.sub(lambda _: "{%d}" % next(c), t)
        if is_text(t, k):
            out.append((t, k))
    return out


def is_text(t: str, kind: str) -> bool:
    if len(t) < 2 or len(t) > 600 or not WORD.search(t) or CODE.search(t):
        return False
    bare = PH.sub("", t)
    if not WORD.search(bare):
        return False
    if " " not in t.strip():
        w = t.strip(".,:;!?…()·-–— ")
        # one word: only a Capitalized one, or any in markup / attributes
        if re.search(r"[a-z][A-Z]|_|\d[a-z]|[a-z]\d", w) or (kind in ("str", "tpl") and not re.match(r"^[A-Z][a-z]+$|^[A-Z]{2,}$|^[A-Z]\.", w) and not t.endswith("…")):
            return False
    if re.fullmatch(r"[A-Z0-9_]{2,}", t.strip()) and kind in ("str", "tpl"):
        return False
    return True


def functions(src: str):
    """{line: name of the top-level function / const it is in}"""
    names, cur = {}, ""
    for i, l in enumerate(src.split("\n"), 1):
        m = FN.match(l)
        if m:
            cur = next(g for g in m.groups() if g)
        names[i] = cur
    return names


def scan(ui_dir: str) -> dict:
    """{English template: [{"file", "line", "fn", "kind"}, …]} of every page script in ui/ (not ui/big, ui/site's worker)."""
    files = sorted(f for f in os.listdir(ui_dir) if f.endswith(".js") and f not in SKIP_FILES)
    files += ["site/site.js"] if os.path.exists(os.path.join(ui_dir, "site", "site.js")) else []
    out: dict = {}
    page = os.path.join(ui_dir, "index.html")  # the menus
    if os.path.exists(page):
        with open(page, encoding="utf-8") as fh:
            body = fh.read().split("<body>", 1)[-1].split("<script", 1)[0]
        for t, k in pieces(body, "html"):
            out.setdefault(t, []).append({"file": "index.html", "line": 0, "fn": "", "kind": k})
    for f in files:
        with open(os.path.join(ui_dir, f), encoding="utf-8") as fh:
            src = fh.read()
        fns = functions(src)
        for text, line, kind in literals(src):
            for t, k in pieces(text, kind):
                out.setdefault(t, []).append({"file": f, "line": line, "fn": fns.get(line, ""), "kind": k})
    return out


_cache: dict = {}


def strings(ui_dir: str) -> dict:
    """scan() kept until a script changes"""
    sig = []
    for f in sorted(os.listdir(ui_dir)):
        if f.endswith(".js"):
            sig.append((f, os.path.getmtime(os.path.join(ui_dir, f))))
    sig = tuple(sig)
    if _cache.get("sig") != sig or _cache.get("dir") != ui_dir:
        _cache.update(sig=sig, dir=ui_dir, data=scan(ui_dir))
    return _cache["data"]
