#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 Markdown / TXT / DOCX / PPTX（可选 PDF）转换为 MindCard 卡组 JSON。

用法：
  python tools/convert.py notes.md -o decks/notes.json
  python tools/convert.py 复习文档.docx --title "微机原理" --id microcomputer
  python tools/convert.py slides.pptx --mode outline

规则：
  · 标题（# / ##，或 "第 1 章"）→ 章节
  · Q: / 问： 与 A: / 答： → 问答卡
  · 两列表格（问题|答案、术语|定义）→ 问答卡
  · "术语：定义" 的要点 → 问答卡
  · 其余段落默认忽略，避免生成低质量卡片

依赖：python-docx、python-pptx（按需）；PDF 需要 pypdf。
"""
import argparse
import hashlib
import json
import os
import re
import sys
import unicodedata

VERSION = 1

CHAPTER_RE = re.compile(r'^第\s*[0-9一二三四五六七八九十百]+\s*[章讲节篇]')
HEADING_RE = re.compile(r'^(#{1,6})\s+(.+?)\s*$')
BULLET_RE = re.compile(r'^\s*(?:[-*+•·]|\d+[.、)])\s+(.+?)\s*$')
Q_RE = re.compile(r'^(?:Q|问|问题)\s*[:：]\s*(.+)$', re.I)
A_RE = re.compile(r'^(?:A|答|答案)\s*[:：]\s*(.+)$', re.I)
DEF_RE = re.compile(r'^(.{2,40}?)\s*[:：]\s*(.{6,})$')
TABLE_SEP_RE = re.compile(r'^\s*\|?[\s:|-]+\|[\s:|-]*$')

STOP_TERMS = {'注意', '提示', '说明', '例如', '比如', '总结', '补充', '考点', '重点'}


def log(msg):
    print(msg)


def slugify(text, fallback='deck'):
    text = unicodedata.normalize('NFKD', text)
    ascii_text = text.encode('ascii', 'ignore').decode('ascii').lower()
    ascii_text = re.sub(r'[^a-z0-9]+', '-', ascii_text).strip('-')
    if len(ascii_text) >= 2:
        return ascii_text[:60]
    return fallback + '-' + hashlib.md5(text.encode('utf-8')).hexdigest()[:8]


class Block:
    def __init__(self, kind, text='', level=0, rows=None):
        self.kind = kind      # heading | paragraph | bullet | table
        self.text = text
        self.level = level
        self.rows = rows or []


# ---------------- 提取：纯文本 / Markdown ----------------

def extract_text(path):
    with open(path, encoding='utf-8-sig', errors='replace') as f:
        raw = f.read()
    lines = raw.splitlines()
    blocks = []
    para = []
    table = []

    def flush_para():
        if para:
            blocks.append(Block('paragraph', '\n'.join(para).strip()))
            para.clear()

    def flush_table():
        if table:
            rows = []
            for line in table:
                if TABLE_SEP_RE.match(line):
                    continue
                cells = [c.strip() for c in line.strip().strip('|').split('|')]
                rows.append(cells)
            if rows:
                blocks.append(Block('table', rows=rows))
            table.clear()

    for line in lines:
        if line.strip().startswith('|') and line.count('|') >= 2:
            flush_para()
            table.append(line)
            continue
        flush_table()

        if not line.strip():
            flush_para()
            continue
        m = HEADING_RE.match(line)
        if m:
            flush_para()
            blocks.append(Block('heading', m.group(2), len(m.group(1))))
            continue
        if CHAPTER_RE.match(line.strip()) and len(line.strip()) <= 60:
            flush_para()
            blocks.append(Block('heading', line.strip(), 2))
            continue
        m = BULLET_RE.match(line)
        if m:
            flush_para()
            blocks.append(Block('bullet', m.group(1)))
            continue
        if Q_RE.match(line.strip()) or A_RE.match(line.strip()):
            # Q/A 必须单独成块，否则会和后续行合并成一段而识别失败
            flush_para()
            blocks.append(Block('paragraph', line.strip()))
            continue
        para.append(line.strip())
    flush_para()
    flush_table()
    return blocks


# ---------------- 提取：DOCX ----------------

def extract_docx(path):
    try:
        from docx import Document
        from docx.table import Table
        from docx.text.paragraph import Paragraph
        from docx.oxml.ns import qn
    except ImportError:
        raise SystemExit('缺少 python-docx，请先运行：pip install python-docx')

    doc = Document(path)
    blocks = []

    def walk(parent):
        for child in parent.element.body.iterchildren():
            if child.tag == qn('w:p'):
                p = Paragraph(child, parent)
                text = p.text.strip()
                if not text:
                    continue
                style = (p.style.name or '').lower()
                level = 0
                if 'heading' in style or '标题' in style:
                    m = re.search(r'(\d+)', style)
                    level = int(m.group(1)) if m else 2
                elif CHAPTER_RE.match(text) and len(text) <= 60:
                    level = 2
                if level:
                    blocks.append(Block('heading', text, min(level, 3)))
                else:
                    blocks.append(Block('paragraph', text))
            elif child.tag == qn('w:tbl'):
                t = Table(child, parent)
                rows = []
                for row in t.rows:
                    rows.append([c.text.strip() for c in row.cells])
                if rows:
                    blocks.append(Block('table', rows=rows))

    walk(doc)
    return blocks


# ---------------- 提取：PPTX ----------------

def extract_pptx(path):
    try:
        from pptx import Presentation
    except ImportError:
        raise SystemExit('缺少 python-pptx，请先运行：pip install python-pptx')

    prs = Presentation(path)
    blocks = []
    for idx, slide in enumerate(prs.slides, 1):
        title = ''
        try:
            if slide.shapes.title and slide.shapes.title.text.strip():
                title = slide.shapes.title.text.strip()
        except Exception:
            pass
        if title:
            level = 2 if CHAPTER_RE.match(title) else 3
            blocks.append(Block('heading', title, level))
        for shape in slide.shapes:
            if not shape.has_text_frame:
                continue
            for p in shape.text_frame.paragraphs:
                text = ''.join(r.text for r in p.runs).strip()
                if not text or text == title:
                    continue
                lvl = p.level or 0
                if len(text) <= 40 and not text.endswith(('。', '；', '，')):
                    blocks.append(Block('bullet', text))
                else:
                    blocks.append(Block('bullet', text))
    return blocks


# ---------------- 提取：PDF（可选） ----------------

def extract_pdf(path):
    try:
        from pypdf import PdfReader
    except ImportError:
        raise SystemExit('缺少 pypdf，请先运行：pip install pypdf')
    reader = PdfReader(path)
    blocks = []
    for page_no, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ''
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            if CHAPTER_RE.match(line) and len(line) <= 60:
                blocks.append(Block('heading', line, 2))
            else:
                blocks.append(Block('paragraph', line))
    return blocks


def extract(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in ('.md', '.markdown', '.txt'):
        return extract_text(path), 'md' if ext != '.txt' else 'txt'
    if ext == '.docx':
        return extract_docx(path), 'docx'
    if ext == '.pptx':
        return extract_pptx(path), 'pptx'
    if ext == '.pdf':
        return extract_pdf(path), 'pdf'
    raise SystemExit('暂不支持 %s，请先用 Markdown / TXT / DOCX / PPTX。' % ext)


# ---------------- 生成卡片 ----------------

class Builder:
    def __init__(self, title):
        self.title = title
        self.chapters = []
        self.cards = []
        self.seen = set()
        self.current = None
        self.warnings = []

    def start_chapter(self, name):
        name = re.sub(r'\s+', ' ', name).strip()
        if not name:
            return
        if self.current and self.current['name'] == name:
            return
        cid = 'ch-%02d' % (len(self.chapters) + 1)
        self.chapters.append({
            'id': cid, 'order': len(self.chapters) + 1,
            'name': name, 'short': name[:12]
        })
        self.current = self.chapters[-1]

    def ensure_chapter(self):
        if not self.current:
            self.start_chapter('全部内容')
        return self.current

    def add(self, q, a, tag='', ctype='recall'):
        q = re.sub(r'\s+', ' ', str(q)).strip()
        a = re.sub(r'\s+', ' ', str(a)).strip()
        if len(q) < 2 or len(a) < 3:
            return
        if ctype == 'recall' and a == q:
            return
        key = re.sub(r'[\s，。；：、,.!?！？]', '', q).lower()
        if key in self.seen:
            return
        self.seen.add(key)
        ch = self.ensure_chapter()
        self.cards.append({
            'id': 'c-%04d' % (len(self.cards) + 1),
            'chapter': ch['id'],
            'type': ctype,
            'tag': tag[:24],
            'question': q,
            'answer': a
        })

    def add_table(self, rows):
        if len(rows) < 2:
            return
        header = [c.lower() for c in rows[0]]
        q_col, a_col = 0, 1
        data_rows = rows[1:]
        if any('答案' in c or '解释' in c or '说明' in c for c in header):
            data_rows = rows[1:]
        for row in data_rows:
            if len(row) <= max(q_col, a_col):
                continue
            q, a = row[q_col], row[a_col]
            if not q or not a:
                continue
            if q in ('问题', '知识点', '术语', '项目') and a in ('答案', '解释', '定义', '说明'):
                continue
            self.add(q, a, '表格')

    def build(self):
        return {
            'schemaVersion': VERSION,
            'id': '',
            'title': self.title,
            'language': 'zh-CN',
            'chapters': self.chapters or [{'id': 'ch-01', 'order': 1, 'name': '全部内容'}],
            'cards': self.cards
        }


def convert_blocks(blocks, title, mode='auto', source_type='md'):
    b = Builder(title)
    pending_q = None

    for blk in blocks:
        if blk.kind == 'heading':
            pending_q = None
            if blk.level == 1:
                # 第一个一级标题当卡组标题，避免出现“只有一个标题”的章节
                if not b.chapters and not b.cards:
                    b.title = blk.text
                    continue
                b.start_chapter(blk.text)
                continue
            if CHAPTER_RE.match(blk.text):
                b.start_chapter(blk.text)
                continue
            if source_type in ('md', 'txt') and blk.level == 2:
                b.start_chapter(blk.text)
                continue
            # docx/pptx 的二级标题视为小节，不单独成章
            continue

        if blk.kind == 'table':
            pending_q = None
            b.add_table(blk.rows)
            continue

        text = blk.text.strip()
        if not text:
            continue

        mq = Q_RE.match(text)
        if mq:
            pending_q = mq.group(1).strip()
            continue
        ma = A_RE.match(text)
        if ma and pending_q:
            b.add(pending_q, ma.group(1), '问答')
            pending_q = None
            continue
        if pending_q and blk.kind != 'bullet':
            b.add(pending_q, text, '问答')
            pending_q = None
            continue

        if blk.kind == 'bullet' or mode == 'outline':
            m = DEF_RE.match(text)
            if m:
                term, definition = m.group(1).strip(), m.group(2).strip()
                if term and term not in STOP_TERMS and 2 <= len(term) <= 30:
                    b.add(term, definition, '要点')
    return b


# ---------------- 命令行 ----------------

def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    ap = argparse.ArgumentParser(description='文档 → MindCard 卡组 JSON')
    ap.add_argument('input', help='输入文件：.md / .txt / .docx / .pptx / .pdf')
    ap.add_argument('-o', '--output', help='输出 JSON 路径，默认同名 .json')
    ap.add_argument('--title', help='卡组标题')
    ap.add_argument('--id', help='卡组 id（小写字母/数字/短横线）')
    ap.add_argument('--mode', choices=['auto', 'outline'], default='auto',
                    help='auto=只提取结构化内容；outline=把要点也生成卡片')
    ap.add_argument('--author', default='')
    ap.add_argument('--license', default='')
    ap.add_argument('--max-cards', type=int, default=0, help='限制卡片数量，0 为不限制')
    args = ap.parse_args()

    if not os.path.exists(args.input):
        raise SystemExit('找不到文件：%s' % args.input)

    blocks, source_type = extract(args.input)
    title = args.title or os.path.splitext(os.path.basename(args.input))[0]
    builder = convert_blocks(blocks, title, args.mode, source_type)
    deck = builder.build()
    deck['id'] = args.id or slugify(deck['title'])
    deck['author'] = args.author
    deck['license'] = args.license
    deck['source'] = {'type': source_type, 'name': os.path.basename(args.input)}

    if args.max_cards and len(deck['cards']) > args.max_cards:
        deck['cards'] = deck['cards'][:args.max_cards]

    if not deck['cards']:
        raise SystemExit('没有提取到卡片。请检查文档是否有 Q:/A:、两列表格或“术语：定义”格式。')

    out = args.output or os.path.splitext(args.input)[0] + '.json'
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(deck, f, ensure_ascii=False, indent=2)

    log('已生成：%s' % out)
    log('章节 %d 个，卡片 %d 张' % (len(deck['chapters']), len(deck['cards'])))
    if len(deck['cards']) < 5:
        log('提示：卡片较少。可以在文档里用“Q: …”“A: …”或两列表格组织内容，识别率更高。')


if __name__ == '__main__':
    main()
