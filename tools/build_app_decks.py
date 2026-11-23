#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 decks/*.json 打包成 app/decks.js（window.MC_BUILTIN）。

这样应用在 file:// 直接打开、以及 GitHub Pages 上都能加载内置卡组，
不依赖 fetch，也不会受浏览器 CORS 限制。

用法：python tools/build_app_decks.py
"""
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECKS = os.path.join(BASE, 'decks')
OUT = os.path.join(BASE, 'app', 'decks.js')


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    with open(os.path.join(DECKS, 'index.json'), encoding='utf-8') as f:
        index = json.load(f)

    decks = []
    for entry in index.get('decks', []):
        path = os.path.join(DECKS, entry['file'])
        if not os.path.exists(path):
            raise SystemExit('缺少卡组文件：%s' % path)
        with open(path, encoding='utf-8') as f:
            deck = json.load(f)
        if deck.get('id') != entry.get('id'):
            raise SystemExit('index.json 与 %s 的 id 不一致' % entry['file'])
        decks.append(deck)
        print('· %s：%d 章节，%d 卡片' % (deck['id'], len(deck['chapters']), len(deck['cards'])))

    payload = json.dumps(decks, ensure_ascii=False, indent=2)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('/* 由 tools/build_app_decks.py 自动生成，请勿手改。 */\n')
        f.write('window.MC_BUILTIN = ')
        f.write(payload)
        f.write(';\n')
    print('已生成 %s（%d 个卡组）' % (OUT, len(decks)))


if __name__ == '__main__':
    main()
