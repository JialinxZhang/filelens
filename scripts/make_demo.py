# -*- coding: utf-8 -*-
"""生成 demo/ 下的示例数据集（虚构内容，无任何真实信息）。

用途：开源仓库自带一套可立即浏览的演示数据，也用于 CI 冒烟测试。
运行：python scripts/make_demo.py
"""
import json
import os
import shutil
import struct
import zipfile
import zlib

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'demo', '示例项目资料库')


def w(path, text):
    full = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(text)


# ---------------------------------------------------------------- 纯文本类
def make_texts():
    w('使用说明.md', '''# 示例项目资料库

这是一套用于演示 FileReader 的虚构项目资料，包含 PDF / Word / Excel / PPT /
图片 / 压缩包等常见格式，可以直接体验"点击节点看摘要与内容"的效果。

## 目录结构

- 青屿智能-智慧园区平台：申报类材料（多层级）
- 远帆数据-分析系统：验收类材料
- 星野文创-品牌设计：交付类材料

> 所有公司、人物、数据均为虚构，如有雷同纯属巧合。
''')
    w('青屿智能-智慧园区平台/附件/系统架构说明.md', '''# 系统架构说明

## 一、总体设计

平台采用"云-边-端"三层架构，云端负责模型训练与调度，边端网关做协议转换，
终端设备即插即用。

## 二、核心模块

1. 接入网关：支持 MQTT / Modbus / BACnet 三类协议
2. 规则引擎：可视化配置告警与联动策略
3. 数据中台：统一物模型与时序存储

## 三、部署要求

- 服务器：4 核 8G 起步
- 数据库：PostgreSQL 14+
- 浏览器：Chrome / Edge 最新版
''')
    w('远帆数据-分析系统/团队名单.csv',
      '姓名,角色,负责模块\n张三,项目经理,整体统筹\n李四,算法工程师,指标计算\n王五,前端工程师,可视化\n')
    w('青屿智能-智慧园区平台/附件/接口清单.json', json.dumps({
        'name': '园区开放接口',
        'version': '1.2.0',
        'apis': [
            {'method': 'GET', 'path': '/v1/devices', 'desc': '设备列表'},
            {'method': 'POST', 'path': '/v1/alarms', 'desc': '上报告警'},
        ],
    }, ensure_ascii=False, indent=2))
    w('星野文创-品牌设计/设计说明.txt', '''品牌设计说明（初稿）

一、设计理念
以"山与海"为核心意象，主色采用深海蓝与晨雾灰，传达稳定与信赖感。

二、应用规范
标准字在浅色与深色背景下的最小尺寸为 24px；主标志四周留白不小于标志高度的二分之一。

三、交付物清单
标志源文件、标准色卡、应用样机、发布会主视觉各一份。
''')


# ---------------------------------------------------------------- PDF
def make_pdf(path, lines):
    import pymupdf as pm
    doc = pm.open()
    page = doc.new_page()
    y = 80
    for size, text in lines:
        try:
            page.insert_text((72, y), text, fontname='china-s', fontsize=size)
        except Exception:
            page.insert_text((72, y), text.encode('gbk', 'replace').decode('latin-1'), fontsize=size)
        y += size + 16
    page2 = doc.new_page()
    page2.insert_text((72, 80), '第二页：本文件由脚本生成，仅用于功能演示。', fontname='china-s', fontsize=12)
    full = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    doc.save(full)


# ---------------------------------------------------------------- 最小 Office XML
def make_docx(path, paragraphs):
    full = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    body = ''.join(f'<w:p><w:r><w:t>{p}</w:t></w:r></w:p>' for p in paragraphs)
    with zipfile.ZipFile(full, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                   '</Types>')
        z.writestr('_rels/.rels',
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
                   '</Relationships>')
        z.writestr('word/document.xml',
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                   f'<w:body>{body}</w:body></w:document>')


def make_pptx(path, slides):
    full = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with zipfile.ZipFile(full, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   + ''.join(
                       f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
                       for i in range(1, len(slides) + 1))
                   + '</Types>')
        z.writestr('_rels/.rels',
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>'
                   '</Relationships>')
        z.writestr('ppt/presentation.xml',
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>')
        for i, texts in enumerate(slides, 1):
            runs = ''.join(f'<a:p><a:r><a:t>{t}</a:t></a:r></a:p>' for t in texts)
            z.writestr(f'ppt/slides/slide{i}.xml',
                       '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                       '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
                       'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                       f'<p:cSld><p:spTree>{runs}</p:spTree></p:cSld></p:sld>')


def make_xlsx(path):
    import openpyxl
    full = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = '预算明细'
    for row in [['科目', '金额（万元）', '说明'],
                ['设备采购', '36.0', '边端网关与服务器'],
                ['软件开发', '28.5', '平台功能开发'],
                ['实施部署', '12.0', '三个园区试点'],
                ['合计', '76.5', '']]:
        ws.append(row)
    ws2 = wb.create_sheet('汇总')
    ws2.append(['项目', '数值'])
    ws2.append(['总预算（万元）', 76.5])
    ws2.append(['周期（月）', 12])
    wb.save(full)


def make_zip(path):
    full = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with zipfile.ZipFile(full, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('资料清单.txt', '1. 营业执照副本扫描件\n2. 审计报告\n3. 知识产权证书\n')
        z.writestr('联系人.txt', ' fictional@example.com（虚构）\n')


def make_png(path, w=320, h=200):
    """纯 Python 生成棋盘格 PNG。"""
    colors = [(76, 110, 245), (233, 238, 252)]
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw.extend(colors[((x // 20) + (y // 20)) % 2])

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 6))
           + chunk(b'IEND', b''))
    full = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'wb') as f:
        f.write(png)


def main():
    if os.path.isdir(BASE):
        shutil.rmtree(BASE)
    os.makedirs(BASE, exist_ok=True)
    make_texts()
    make_pdf('青屿智能-智慧园区平台/01 项目申报书.pdf', [
        (18, '智慧园区管理平台项目申报书'),
        (12, '（示例文件 · 内容纯属虚构）'),
        (12, '一、项目概述'),
        (11, '本项目面向中型园区的设备接入与能耗管理。'),
        (11, '目标：运维人力降低三成，告警响应缩短到八分钟内。'),
        (12, '二、建设内容'),
        (11, '1. 边端接入网关：支持三类工业协议；'),
        (11, '2. 规则引擎：可视化配置告警与联动；'),
        (11, '3. 数据中台：统一物模型与时序存储。'),
        (12, '三、预期效益'),
        (11, '试点园区平均告警响应时间从四十五分钟缩短到八分钟。'),
    ])
    make_pdf('远帆数据-分析系统/验收报告.pdf', [
        (16, '数据分析系统验收报告'),
        (12, '一、验收结论：通过'),
        (11, '各项功能指标均达到合同要求，性能压测满足 500 并发。'),
    ])
    make_xlsx('青屿智能-智慧园区平台/02 预算明细.xlsx')
    make_pptx('青屿智能-智慧园区平台/03 产品方案介绍.pptx', [
        ['智慧园区管理平台', '产品方案介绍', '（示例文件）'],
        ['核心能力一：设备接入', '三类协议 · 即插即用'],
        ['核心能力二：规则引擎', '可视化编排 · 秒级联动'],
    ])
    make_docx('青屿智能-智慧园区平台/04 补充材料.docx', [
        '补充材料：实施计划',
        '一、第一阶段（第 1-2 月）',
        '完成接入网关部署与协议适配。',
        '二、第二阶段（第 3-5 月）',
        '完成规则引擎与数据中台联调。',
        '三、第三阶段（第 6 月）',
        '三个试点园区上线试运行。',
    ])
    make_zip('青屿智能-智慧园区平台/附件/打包资料.zip')
    make_png('远帆数据-分析系统/截图/界面示意.png')
    w('星野文创-品牌设计/交付清单/初稿说明.md', '# 初稿说明\n\n- 标志：两版方向\n- 色卡：主色 + 辅助色\n- 样机：名片与工牌\n')
    count = sum(len(fs) for _, _, fs in os.walk(BASE))
    print(f'示例数据已生成：{BASE}（{count} 个文件）')


if __name__ == '__main__':
    main()
