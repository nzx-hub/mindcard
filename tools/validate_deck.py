#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验 MindCard 卡组 JSON 的结构、引用与重复项。

用法：
  python tools/validate_deck.py decks/*.json
  python tools/validate_deck.py decks/foo.json --strict

退出码：0 通过；1 有错误。
"""
import argparse
import glob
import json
import os
import re
import sys

ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]{1,63}$')
CH_RE = re.compile(r'^ch-[a-z0-9-]{1,48}$')
CARD_ID_RE = re.compile(r'^[a-zA-Z0-9_-]{1,64}$')
TYPES = {'recall', 'cloze', 'choice', 'judge', 'code'}


def norm_text(s):
    return re.sub(r'[\s，。；：、,.!?！？（）()]', '', str(s)).lower()


def validate(path, strict=False):
    errors, warnings = [], []
    try:
        with open(path, encoding='utf-8') as f:
            deck = json.load(f)
    except Exception as e:
        return ['无法读取 JSON：%s' % e], []

    for key in ('schemaVersion', 'id', 'title', 'chapters', 'cards'):
        if key not in deck:
            errors.append('缺少必填字段：%s' % key)
    if deck.get('schemaVersion') != 1:
        warnings.append('schemaVersion 不是 1')

    did = deck.get('id', '')
    if not ID_RE.match(did):
        errors.append('卡组 id 不合规：%r（小写字母/数字/短横线，2-64 位）' % did)

    chapters = deck.get('chapters') or []
    if not chapters:
        errors.append('chapters 为空')
    ch_ids = set()
    for ch in chapters:
        cid = ch.get('id', '')
        if not CH_RE.match(cid):
            errors.append('章节 id 不合规：%r' % cid)
        if cid in ch_ids:
            errors.append('章节 id 重复：%s' % cid)
        ch_ids.add(cid)
        if not ch.get('name'):
            errors.append('章节 %s 缺少 name' % cid)

    cards = deck.get('cards') or []
    if not cards:
        errors.append('cards 为空')
    card_ids = set()
    questions = {}
    refs = {}

    for i, card in enumerate(cards):
        where = 'cards[%d]' % i
        cid = card.get('id', '')
        if not CARD_ID_RE.match(str(cid)):
            errors.append('%s 的 id 不合规：%r' % (where, cid))
        if cid in card_ids:
            errors.append('卡片 id 重复：%s' % cid)
        card_ids.add(cid)

        ch = card.get('chapter')
        if ch not in ch_ids:
            errors.append('%s 引用了不存在的章节：%r' % (where, ch))
        refs[ch] = refs.get(ch, 0) + 1

        ctype = card.get('type')
        if ctype not in TYPES:
            errors.append('%s 的类型不合规：%r' % (where, ctype))
        if not str(card.get('question', '')).strip() and not card.get('questionImage'):
            errors.append('%s 缺少 question 或 questionImage' % where)
        if not str(card.get('answer', '')).strip() and not card.get('answerImage'):
            errors.append('%s 缺少 answer 或 answerImage' % where)
        for img_key in ('questionImage', 'answerImage'):
            img = card.get(img_key)
            if img and not re.match(r'^data:image/(png|jpeg|webp|gif);base64,', str(img)):
                errors.append('%s 的 %s 格式不合规' % (where, img_key))

        if ctype == 'choice':
            opts = card.get('options')
            if not isinstance(opts, list) or len(opts) < 2:
                errors.append('%s 选择题缺少 options' % where)
            ai = card.get('answerIndex')
            if not isinstance(ai, int) or (isinstance(opts, list) and not (0 <= ai < len(opts))):
                errors.append('%s 的 answerIndex 越界' % where)
        if ctype == 'judge' and not isinstance(card.get('correct'), bool):
            errors.append('%s 判断题缺少 correct 布尔值' % where)
        if ctype == 'cloze':
            acc = card.get('accept')
            if not isinstance(acc, list) or not acc:
                errors.append('%s 填空题缺少 accept' % where)

        q = norm_text(card.get('question', ''))
        if q and q in questions:
            warnings.append('题目重复：%s 与 %s' % (cid, questions[q]))
        elif q:
            questions[q] = cid

    empty_ch = [c for c in ch_ids if c not in refs]
    if empty_ch:
        warnings.append('有章节没有卡片：%s' % ', '.join(sorted(empty_ch)))

    if strict:
        for w in warnings:
            errors.append('[strict] ' + w)

    return errors, warnings


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    ap = argparse.ArgumentParser(description='校验 MindCard 卡组')
    ap.add_argument('files', nargs='+', help='deck JSON 文件或 glob')
    ap.add_argument('--strict', action='store_true', help='把警告也当作错误')
    args = ap.parse_args()

    paths = []
    for pattern in args.files:
        matched = glob.glob(pattern)
        paths.extend(matched if matched else [pattern])
    paths = sorted(set(paths))
    if not paths:
        raise SystemExit('没有找到文件')

    failed = 0
    for path in paths:
        if os.path.basename(path) == 'index.json':
            print('· index.json（卡组注册表，跳过）')
            continue
        errors, warnings = validate(path, args.strict)
        name = os.path.basename(path)
        if errors:
            failed += 1
            print('✗ %s' % name)
            for e in errors:
                print('   ERROR  ' + e)
        else:
            print('✓ %s' % name)
        for w in warnings:
            print('   WARN   ' + w)
    print('\n%d 个文件，%d 个失败' % (len(paths), failed))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
