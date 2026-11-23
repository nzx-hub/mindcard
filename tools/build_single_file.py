#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 app/ 的多文件版本打包成一个可单独打开的 HTML。

用法：
  python tools/build_single_file.py
  python tools/build_single_file.py --deck ../MindCard-private/microcomputer-stc15.json \
      --out ../MindCard-private/MindCard_课程单文件版.html

默认只打包 app/decks.js 里的公开示例卡组；指定 --deck 时把该卡组作为唯一内置卡组。
"""
import argparse
import io
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(BASE, "app")


def read(path):
    if not os.path.exists(path):
        raise SystemExit("找不到文件：%s" % path)
    return io.open(path, encoding="utf-8").read()


def build(deck_path=None, out_path=None):
    index = read(os.path.join(APP, "index.html"))
    css = read(os.path.join(APP, "styles.css"))

    if deck_path:
        deck = json.loads(read(deck_path))
        if not isinstance(deck, dict) or not deck.get("id"):
            raise SystemExit("卡组 JSON 不合法：缺少 id")
        decks_js = "/* 单文件版内置卡组 */\nwindow.MC_BUILTIN = " + \
            json.dumps([deck], ensure_ascii=False, indent=2) + ";\n"
    else:
        decks_js = read(os.path.join(APP, "decks.js"))

    css = css.replace("</style", "<\\/style")
    html = index.replace(
        '<link rel="stylesheet" href="styles.css">',
        "<style>\n" + css + "\n</style>",
        1,
    )

    inlined = []

    def inline_script(match):
        src = match.group(1)
        js = decks_js if src == "decks.js" else read(os.path.join(APP, src))
        js = js.replace("</script", "<\\/script")
        inlined.append(src)
        return "<script>\n" + js + "\n</script>"

    html = re.sub(r'<script src="([^"]+)"></script>', inline_script, html)

    if "<script src=" in html:
        raise SystemExit("仍有未内联的 script 标签，请检查 index.html")
    if 'href="styles.css"' in html:
        raise SystemExit("仍有未内联的 styles.css")

    if not out_path:
        out_path = os.path.join(APP, "MindCard.html")
    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    io.open(out_path, "w", encoding="utf-8", newline="\n").write(html)
    print("已内联：%s" % "、".join(inlined))
    print("已生成：%s（%d 字符）" % (out_path, len(html)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--deck", help="可选：指定要内置的卡组 JSON")
    parser.add_argument("--out", help="可选：输出 HTML 路径")
    args = parser.parse_args()
    build(args.deck, args.out)
