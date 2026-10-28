# -*- coding: utf-8 -*-
"""目录树扫描：递归构建整棵树的紧凑 JSON 结构，并汇总全局统计。"""
import os
import re

# 纯噪音文件，扫描时直接跳过
SKIP_NAMES = {'.ds_store', 'thumbs.db', 'desktop.ini', '.localized'}
SKIP_PREFIXES = ('~$', '.')   # ~$ 开头是 Office 锁文件，. 开头是隐藏文件

MAX_NODES = 200_000


def _natural_key(name):
    """自然排序键：'文件2' 排在 '文件10' 之前。"""
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r'(\d+)', name)]


def build_tree(root_path):
    """返回 {root, name, node, stats}；node 字段刻意用短键减小体积。

    node: n 名称 / p 绝对路径 / t 'd'|'f' / s 字节大小(目录为子树累计)
          / m 修改时间戳 / e 扩展名(小写无点, 仅文件)
          / c 子节点数组(仅目录) / fc 子树文件数 / dc 子树目录数
    """
    root = os.path.realpath(root_path)
    stats = {'files': 0, 'dirs': 0, 'size': 0, 'skipped': 0, 'errors': 0, 'by_ext': {}}
    node_count = [0]

    def walk(dir_path):
        if node_count[0] > MAX_NODES:
            raise RuntimeError('节点过多（超过 %d），请选择更小的子目录' % MAX_NODES)
        dirs, files = [], []
        try:
            it = os.scandir(dir_path)
        except OSError:
            stats['errors'] += 1
            return [], 0, 0
        with it:
            for entry in it:
                name = entry.name
                if name.lower() in SKIP_NAMES or name.startswith(SKIP_PREFIXES):
                    stats['skipped'] += 1
                    continue
                try:
                    st = entry.stat(follow_symlinks=False)
                except OSError:
                    stats['errors'] += 1
                    continue
                node_count[0] += 1
                if entry.is_dir(follow_symlinks=False):
                    node = {'n': name, 'p': os.path.join(dir_path, name),
                            't': 'd', 'm': int(st.st_mtime), 's': 0}
                    dirs.append(node)
                else:
                    ext = os.path.splitext(name)[1][1:].lower()
                    node = {'n': name, 'p': os.path.join(dir_path, name),
                            't': 'f', 'e': ext, 'm': int(st.st_mtime), 's': st.st_size}
                    files.append(node)
                    stats['files'] += 1
                    stats['size'] += st.st_size
                    stats['by_ext'][ext or '（无扩展名）'] = stats['by_ext'].get(ext or '（无扩展名）', 0) + 1

        dirs.sort(key=lambda d: _natural_key(d['n']))
        files.sort(key=lambda f: _natural_key(f['n']))

        children = dirs + files
        fc_total, dc_total = 0, 0
        for d in dirs:
            sub, fc, dc = walk(d['p'])
            d['c'] = sub
            d['fc'] = fc
            d['dc'] = dc
            d['s'] = sum(c.get('s', 0) for c in sub)
            stats['dirs'] += 1
            fc_total += fc
            dc_total += dc + 1
        fc_total += len(files)
        for f in files:
            f['fc'] = f['dc'] = 0
        return children, fc_total, dc_total

    children, fc, dc = walk(root)
    root_node = {
        'n': os.path.basename(root) or root,
        'p': root, 't': 'd', 'm': int(os.stat(root).st_mtime),
        'c': children, 'fc': fc, 'dc': dc,
        's': sum(c.get('s', 0) for c in children),
    }
    stats['by_ext'] = dict(sorted(stats['by_ext'].items(), key=lambda kv: -kv[1])[:12])
    return {'root': root, 'name': root_node['n'], 'node': root_node, 'stats': stats}
