# -*- coding: utf-8 -*-
"""FileLens · 文件夹速览 —— 本地服务

用法：
    python server.py [文件夹路径] [端口]

启动后自动打开浏览器。仅监听 127.0.0.1，供本机使用。
"""
import json
import hashlib
import os
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

import extractor
import scanner

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')
MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
        '.ico': 'image/x-icon', '.pdf': 'application/pdf'}
RAW_MAX = 64 * 1024 * 1024   # /api/raw 单文件上限

# 本会话内明确加载过的根目录；打开文件 / 预览图等操作只允许访问这些目录之下
ALLOWED_ROOTS = []
_cache = {}                  # (path, mtime, size, full) -> 抽取结果
_cache_lock = threading.Lock()

# 原生“选择文件夹”对话框：放在独立子进程里跑，避免 tkinter 的线程/主循环问题
PICK_SNIPPET = r'''
import sys
import tkinter as tk
from tkinter import filedialog
root = tk.Tk()
root.withdraw()
root.attributes('-topmost', True)
path = filedialog.askdirectory(parent=root, title='选择要浏览的文件夹')
root.destroy()
sys.stdout.write(path or '')
'''


def register_root(path):
    real = os.path.realpath(path)
    if real not in ALLOWED_ROOTS:
        ALLOWED_ROOTS.append(real)


def _warmup_parsers():
    """后台预导入重型解析库。

    pymupdf 在部分系统上冷导入可达数秒（杀软扫描 + 磁盘冷缓存），
    提前在启动阶段完成，避免用户第一次点击 PDF 时卡顿。"""
    try:
        import pymupdf  # noqa: F401
    except Exception:
        pass


def is_allowed(path):
    real = os.path.realpath(path)
    return any(real == r or real.startswith(r + os.sep) for r in ALLOWED_ROOTS)


def cached_inspect(path, full):
    st = os.stat(path)
    key = (path, st.st_mtime, st.st_size, full)
    with _cache_lock:
        if key in _cache:
            return _cache[key]
    result = extractor.inspect(path, full)
    with _cache_lock:
        if len(_cache) > 200:
            _cache.clear()
        _cache[key] = result
    return result


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    # ------------------------------------------------------------ 基础工具
    def log_message(self, fmt, *args):
        pass   # 静默访问日志，控制台只保留关键信息

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _error(self, message, status=400):
        self._json({'error': message}, status)

    def _param(self, name):
        qs = parse_qs(urlparse(self.path).query)
        vals = qs.get(name)
        return unquote(vals[0]) if vals else None

    # ------------------------------------------------------------ 路由
    def do_GET(self):
        route = urlparse(self.path).path
        try:
            if route.startswith('/api/tree'):
                return self.api_tree()
            if route.startswith('/api/file'):
                return self.api_file()
            if route.startswith('/api/raw'):
                return self.api_raw()
            if route.startswith('/api/thumb'):
                return self.api_thumb()
            if route.startswith('/api/roots'):
                return self.api_roots()
            if route.startswith('/api/'):
                return self._error('未知接口', 404)
            return self.serve_static(route)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass
        except Exception as e:
            try:
                self._error(f'服务器内部错误：{e}', 500)
            except Exception:
                pass

    def do_POST(self):
        route = urlparse(self.path).path
        try:
            length = int(self.headers.get('Content-Length') or 0)
            payload = json.loads(self.rfile.read(length) or b'{}') if length else {}
        except Exception:
            return self._error('请求体不是合法 JSON')
        try:
            if route == '/api/open':
                return self.api_shell_action(payload, 'open')
            if route == '/api/reveal':
                return self.api_shell_action(payload, 'reveal')
            if route == '/api/pick-folder':
                return self.api_pick_folder()
            return self._error('未知接口', 404)
        except Exception as e:
            return self._error(f'服务器内部错误：{e}', 500)

    def api_pick_folder(self):
        """弹出系统原生目录选择框；用户取消时返回空路径。"""
        try:
            kwargs = {'capture_output': True, 'text': True, 'timeout': 600,
                      'input': '', 'encoding': 'utf-8'}
            if sys.platform == 'win32':
                kwargs['creationflags'] = 0x08000000   # CREATE_NO_WINDOW
            r = subprocess.run([sys.executable, '-c', PICK_SNIPPET], **kwargs)
            path = (r.stdout or '').strip().strip('"')
            if r.returncode != 0 or not path:
                return self._json({'path': '', 'cancelled': True})
            if not os.path.isdir(path):
                return self._json({'path': '', 'cancelled': True})
            register_root(path)
            return self._json({'path': path, 'cancelled': False})
        except subprocess.TimeoutExpired:
            return self._json({'path': '', 'cancelled': True})

    # ------------------------------------------------------------ API
    def api_tree(self):
        root = self._param('root')
        if not root:
            return self._error('缺少 root 参数')
        root = os.path.expandvars(os.path.expanduser(root.strip('"')))
        if not os.path.isdir(root):
            return self._error(f'文件夹不存在或无法访问：{root}', 404)
        register_root(root)
        data = scanner.build_tree(root)
        self._json(data)

    def api_file(self):
        path = self._param('path')
        full = self._param('full') in ('1', 'true')
        if not path:
            return self._error('缺少 path 参数')
        if not is_allowed(path):
            return self._error('该路径不在已加载的文件夹范围内', 403)
        if not os.path.isfile(path):
            return self._error('文件不存在', 404)
        st = os.stat(path)
        result = cached_inspect(path, full)
        result = dict(result)
        result['size'] = st.st_size
        result['mtime'] = int(st.st_mtime)
        self._json(result)

    def api_raw(self):
        path = self._param('path')
        if not path or not is_allowed(path) or not os.path.isfile(path):
            return self._error('文件不可访问', 403)
        if os.path.getsize(path) > RAW_MAX:
            return self._error('文件过大，不支持在线预览', 413)
        ext = os.path.splitext(path)[1].lower()
        with open(path, 'rb') as f:
            body = f.read()
        self.send_response(200)
        self.send_header('Content-Type', MIME.get(ext, 'application/octet-stream'))
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_thumb(self):
        """PDF 首页渲染为 PNG（结果缓存到临时目录）。"""
        path = self._param('path')
        if not path or not is_allowed(path) or not os.path.isfile(path):
            return self._error('文件不可访问', 403)
        if os.path.splitext(path)[1].lower() != '.pdf':
            return self._error('仅支持 PDF 缩略图', 400)
        st = os.stat(path)
        key = hashlib.sha1(f'{path}|{st.st_mtime}|{st.st_size}'.encode('utf-8')).hexdigest()[:24]
        cache_dir = os.path.join(tempfile.gettempdir(), 'filereader_thumbs')
        os.makedirs(cache_dir, exist_ok=True)
        cache_file = os.path.join(cache_dir, key + '.png')
        if not os.path.exists(cache_file):
            try:
                try:
                    import pymupdf as pm
                except ImportError:
                    import fitz as pm
                with pm.open(path) as doc:
                    page = doc[0]
                    zoom = min(2.0, 1100 / max(page.rect.width, 1))
                    pix = page.get_pixmap(matrix=pm.Matrix(zoom, zoom))
                    pix.save(cache_file)
            except Exception as e:
                return self._error(f'渲染首页失败：{e}', 500)
        with open(cache_file, 'rb') as f:
            body = f.read()
        self.send_response(200)
        self.send_header('Content-Type', 'image/png')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'max-age=3600')
        self.end_headers()
        self.wfile.write(body)

    def api_roots(self):
        self._json({'roots': ALLOWED_ROOTS})

    def api_shell_action(self, payload, action):
        path = payload.get('path', '')
        if not is_allowed(path):
            return self._error('该路径不在已加载的文件夹范围内', 403)
        if not os.path.exists(path):
            return self._error('路径不存在', 404)
        if sys.platform == 'win32':
            if action == 'open':
                os.startfile(path)   # noqa: S606 本地工具，用户主动触发
            else:
                subprocess.Popen(['explorer', '/select,', os.path.normpath(path)])
        else:
            subprocess.Popen(['xdg-open', os.path.dirname(path) or '.'])
        self._json({'ok': True})

    # ------------------------------------------------------------ 静态资源
    def serve_static(self, route):
        if route == '/':
            route = '/index.html'
        rel = route.lstrip('/')
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            return self._error('页面不存在', 404)
        with open(full, 'rb') as f:
            body = f.read()
        ext = os.path.splitext(full)[1].lower()
        if ext in ('.html', '.js'):
            default = json.dumps(DEFAULT_ROOT, ensure_ascii=False)
            body = body.replace(b'__DEFAULT_ROOT__', default.encode('utf-8'))
        self.send_response(200)
        self.send_header('Content-Type', MIME.get(ext, 'application/octet-stream'))
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


def main():
    global DEFAULT_ROOT
    root = None
    port = 8710
    args = [a for a in sys.argv[1:] if a]
    for a in args:
        if a.isdigit():
            port = int(a)
        else:
            root = a
    if root:
        root = os.path.abspath(os.path.expanduser(os.path.expandvars(root.strip('"'))))
        if not os.path.isdir(root):
            print(f'[错误] 文件夹不存在：{root}')
            sys.exit(1)
        register_root(root)
    DEFAULT_ROOT = root or ''

    server = None
    for p in range(port, port + 10):
        try:
            server = ThreadingHTTPServer(('127.0.0.1', p), Handler)
            port = p
            break
        except OSError:
            continue
    if not server:
        print('[错误] 8710-8719 端口均被占用')
        sys.exit(1)
    server.daemon_threads = True

    url = f'http://127.0.0.1:{port}'
    print('┌─────────────────────────────────────────────┐')
    print('│          FileLens · 文件夹速览               │')
    print('└─────────────────────────────────────────────┘')
    if root:
        print(f'  根目录  {root}')
    print(f'  地址    {url}')
    print('  退出    Ctrl + C')
    threading.Thread(target=_warmup_parsers, daemon=True).start()
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n已退出。')


if __name__ == '__main__':
    DEFAULT_ROOT = ''
    main()
