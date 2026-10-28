# -*- coding: utf-8 -*-
"""API 冒烟测试：临时起一个服务实例，遍历核心接口并断言。

运行：python tests/smoke_test.py
退出码 0 表示全部通过。不依赖 pytest，方便在 CI 与本地直接跑。
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEMO = os.path.join(ROOT, 'demo', '示例项目资料库')
PORT = 8791
BASE_URL = f'http://127.0.0.1:{PORT}'

PASS, FAIL = 0, 0


def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'  ✓ {name}')
    else:
        FAIL += 1
        print(f'  ✗ {name}  {detail}')


def get(path, expect_error=False, timeout=10):
    url = BASE_URL + path
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
        try:
            body = json.loads(body)
        except Exception:
            pass
        if expect_error:
            return e.code, body
        raise


def wait_ready(proc, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f'服务进程提前退出，code={proc.returncode}')
        try:
            get('/api/roots')
            return
        except Exception:
            time.sleep(0.3)
    raise RuntimeError('服务未在超时内就绪')


def main():
    if not os.path.isdir(DEMO):
        print('示例数据不存在，请先运行: python scripts/make_demo.py')
        sys.exit(1)

    print(f'启动服务: python server.py "{DEMO}" {PORT}')
    proc = subprocess.Popen(
        [sys.executable, os.path.join(ROOT, 'server.py'), DEMO, str(PORT)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_ready(proc)
        run_tests()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    print(f'\n结果: {PASS} 通过, {FAIL} 失败')
    sys.exit(1 if FAIL else 0)


def run_tests():
    print('[1] 目录树')
    status, tree = get('/api/tree?root=' + urllib.parse.quote(DEMO))
    check('HTTP 200', status == 200)
    stats = tree.get('stats', {})
    check(f"统计: {stats.get('files')} 文件 / {stats.get('dirs')} 目录", stats.get('files') == 13 and stats.get('dirs') == 6,
          f"实际 {stats}")
    names = []

    def walk(n):
        names.append(n['n'])
        for c in n.get('c', []):
            walk(c)

    walk(tree['node'])
    check('包含 PDF', any(n.endswith('.pdf') for n in names))

    pdf = _find(tree['node'], '.pdf')
    xlsx = _find(tree['node'], '.xlsx')
    pptx = _find(tree['node'], '.pptx')
    docx = _find(tree['node'], '.docx')
    zipped = _find(tree['node'], '.zip')
    md = _find(tree['node'], '.md')
    png = _find(tree['node'], '.png')

    print('[2] 文件抽取')
    # 首个 PDF 请求包含 pymupdf 冷导入（部分机器可达数秒），放宽超时
    for path, kind, must_contain in [
        (pdf, 'pdf', '验收结论'),
        (md, 'text', '色卡'),
        (png, 'image', None),
    ]:
        st, d = get('/api/file?path=' + urllib.parse.quote(path), timeout=60)
        label = os.path.basename(path)
        check(f'{label}: kind={kind}', d.get('kind') == kind, f"实际 {d.get('kind')}")
        check(f'{label}: 有标题', bool(d.get('title')))
        if must_contain:
            check(f'{label}: 内容包含"{must_contain}"', must_contain in (d.get('content') or ''),
                  (d.get('content') or '')[:60])
    for path, expect in [(xlsx, 'sheets'), (pptx, 'slides'), (zipped, 'entries')]:
        st, d = get('/api/file?path=' + urllib.parse.quote(path))
        label = os.path.basename(path)
        check(f'{label}: stats.{expect}', expect in (d.get('stats') or {}), str(d.get('stats')))
    st, d = get('/api/file?path=' + urllib.parse.quote(docx))
    check('补充材料.docx: 要点提取', len(d.get('points') or []) >= 2, str(d.get('points')))

    print('[3] PDF 首页缩略图')
    url = BASE_URL + '/api/thumb?path=' + urllib.parse.quote(pdf)
    with urllib.request.urlopen(url, timeout=15) as r:
        body = r.read()
    check('返回 PNG', r.headers['Content-Type'] == 'image/png' and body[:8] == b'\x89PNG\r\n\x1a\n')

    print('[4] 边界与安全')
    st, d = get('/api/tree?root=' + urllib.parse.quote('C:/__not_exists__'), expect_error=True)
    check('不存在路径 -> 404', st == 404 and 'error' in d)
    st, d = get('/api/file?path=' + urllib.parse.quote(os.path.join(os.path.expanduser('~'), 'desktop.ini')), expect_error=True)
    check('越权路径 -> 403', st == 403, f'实际 {st}')
    st, d = get('/api/file', expect_error=True)
    check('缺少参数 -> 400', st == 400)

    print('[5] 静态页面')
    with urllib.request.urlopen(BASE_URL + '/', timeout=10) as r:
        html = r.read().decode('utf-8')
    check('index.html 可访问且注入了默认根目录', '__DEFAULT_ROOT__' not in html and 'FileReader' in html)


def _find(node, ext):
    if node['t'] == 'f' and node['n'].endswith(ext):
        return node['p']
    for c in node.get('c', []):
        r = _find(c, ext)
        if r:
            return r
    return None


if __name__ == '__main__':
    main()
