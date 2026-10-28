/* FileReader · 文件夹速览 —— 前端逻辑 */
'use strict';

/* ---------------- 工具 ---------------- */
const $ = s => document.querySelector(s);
const SVGNS = 'http://www.w3.org/2000/svg';
const canvasEl = $('#canvas'), svg = $('#tree'), world = $('#world');

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
  return el;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function humanSize(b) {
  if (b == null) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
function fmtDate(ts) {
  const d = new Date(ts * 1000), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
async function api(url, opts) {
  const r = await fetch(url, opts);
  let data = null;
  try { data = await r.json(); } catch (e) { /* ignore */ }
  if (!r.ok) throw new Error((data && data.error) || `请求失败（${r.status}）`);
  return data;
}

/* ---------------- 类型配色（与后端 extractor 一致） ---------------- */
const KIND_COLOR = { pdf: '#e5484d', word: '#2f6fed', 'word-legacy': '#2f6fed', excel: '#2f9e44', ppt: '#f76707', text: '#667085', image: '#ae3ec9', zip: '#ad6800', archive: '#ad6800', media: '#0c8599', binary: '#98a2b3' };
const KIND_LABEL = { pdf: 'PDF 文档', word: 'Word 文档', 'word-legacy': 'Word 97-2003', excel: 'Excel 表格', ppt: 'PPT 演示', text: '文本文件', image: '图片', zip: 'ZIP 压缩包', archive: '压缩包', media: '音视频', binary: '其他文件' };
const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'log', 'json', 'xml', 'html', 'htm', 'srt', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'js', 'ts', 'py', 'c', 'cpp', 'h', 'java', 'css', 'bat', 'sh', 'sql', 'r', 'm']);
function kindOfExt(e) {
  if (e === 'pdf') return 'pdf';
  if (e === 'docx' || e === 'doc') return e === 'doc' ? 'word-legacy' : 'word';
  if (e === 'xlsx' || e === 'xlsm' || e === 'xls' || e === 'et') return 'excel';
  if (e === 'pptx' || e === 'ppt') return 'ppt';
  if (TEXT_EXTS.has(e)) return 'text';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tif', 'tiff', 'heic'].includes(e)) return 'image';
  if (e === 'zip') return 'zip';
  if (['rar', '7z', 'gz', 'tar', 'bz2'].includes(e)) return 'archive';
  if (['mp3', 'wav', 'flac', 'aac', 'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'm4a'].includes(e)) return 'media';
  return 'binary';
}
const kindColorOf = n => KIND_COLOR[kindOfExt(n.e || '')];

/* ---------------- 状态 ---------------- */
const S = {
  rootPath: '', rootNode: null, stats: null,
  byPath: new Map(), parent: new Map(),
  expanded: new Set(), selected: null,
  visibleList: [],
  q: '', matchSet: new Set(), matchList: [], matchIdx: -1,
  view: { k: 1, tx: 40, ty: 40 },
  suppressClick: false,
};
const ROW = 30, MX = 26, MY = 30, NAME_MAX = 210, GAPX = 26;

function indexTree() {
  S.byPath.clear(); S.parent.clear();
  (function walk(n, parent) {
    S.byPath.set(n.p, n);
    if (parent) S.parent.set(n.p, parent);
    if (n.c) for (const c of n.c) walk(c, n);
  })(S.rootNode, null);
}

/* ---------------- 布局 ---------------- */
/* 缩进跟随每个节点胶囊的实际宽度：子节点 x = 父节点 x + 父宽 + GAPX。
   这样连线只会落在父子之间的空白带里，从结构上杜绝连线/胶囊互相压线。 */
function layout() {
  let cursor = MY;
  const list = [];
  const visit = (n, x, depth) => {
    n._x = x;
    n._d = depth;
    n._w = nodeWidth(n);
    const ch = (n.t === 'd' && n.c && S.expanded.has(n.p)) ? n.c : null;
    n._ch = ch;
    if (!ch || !ch.length) { n._y = cursor; cursor += ROW; }
    else {
      const cx = x + n._w + GAPX;
      for (const c of ch) visit(c, cx, depth + 1);
      n._y = (ch[0]._y + ch[ch.length - 1]._y) / 2;
    }
    list.push(n);
  };
  visit(S.rootNode, MX, 0);
  S.visibleList = list;
}

/* 预计算节点绘制所需的文本与宽度（layout 与 buildNode 共用，保证度量一致） */
function nodeWidth(n) {
  const fit = fitText(n.n, NAME_MAX);
  const nameW = measure(fit);
  let aux, w;
  if (n.t === 'd') {
    aux = n.fc ? `${n.fc} 项` : '空';
    w = 30 + nameW + measure(aux) + 12;
  } else {
    aux = humanSize(n.s);
    w = 13 + nameW + measure(aux) + 8;
  }
  n._fitName = fit;
  n._nameW = nameW;
  n._auxText = aux;
  return w;
}

/* ---------------- 文本测量 ---------------- */
const measCtx = document.createElement('canvas').getContext('2d');
measCtx.font = '13.5px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
function measure(t) { return measCtx.measureText(t).width; }
function fitText(t, max) {
  if (measure(t) <= max) return t;
  // 过长时保留"头部 + … + 尾部"：公司名在头、材料类型常在尾，两者都有区分度
  const headMax = max * 0.6, tailMax = max * 0.3;
  let h = t;
  while (h.length > 1 && measure(h) > headMax) h = h.slice(0, -1);
  let tl = t;
  while (tl.length > 1 && measure(tl) > tailMax) tl = tl.slice(1);
  return h + '…' + tl;
}

/* ---------------- 渲染 ---------------- */
function render() {
  if (!S.rootNode) return;
  layout();
  world.innerHTML = '';
  const linksG = svgEl('g'), nodesG = svgEl('g');
  world.append(linksG, nodesG);

  const q = S.q;
  const parentVisible = new Set();
  for (const n of S.visibleList) {
    if (n._ch) for (const c of n._ch) parentVisible.add(c.p);
  }

  for (const n of S.visibleList) {
    const par = S.parent.get(n.p);
    if (par && parentVisible.has(n.p)) {
      const x0 = par._x + par._w + 6, y0 = par._y, x1 = n._x, y1 = n._y;
      const mid = (x0 + x1) / 2;
      const dim = q && !(S.matchSet.has(n.p) || S.matchSet.has(par.p));
      linksG.append(svgEl('path', {
        d: `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1}`,
        class: 'link' + (dim ? ' dim' : ''),
      }));
    }
    nodesG.append(buildNode(n));
  }
  applyView();
  updateBreadcrumb();
}

function buildNode(n) {
  const g = svgEl('g', {
    class: 'node' + (S.selected === n.p ? ' sel' : '') +
      (S.q && !S.matchSet.has(n.p) ? ' dim' : '') +
      (S.q && S.matchSet.has(n.p) ? ' match' : ''),
    transform: `translate(${n._x},${n._y})`,
    'data-p': n.p,
  });
  const isDir = n.t === 'd';
  const name = n._fitName, nameW = n._nameW;
  const w = n._w;

  if (isDir) {
    const open = S.expanded.has(n.p);
    const cnt = n._auxText;
    if (S.selected === n.p) g.append(svgEl('rect', { x: 0, y: -13, width: w + 4, height: 26, rx: 9, class: 'sel-rect' }));
    g.append(svgEl('rect', { x: 0, y: -13, width: w, height: 26, rx: 9, class: 'chip-rect' }));
    // 折叠箭头（可点击切换）
    const chev = svgEl('path', { d: 'M-1.2,-4.2 L4.4,0 L-1.2,4.2 Z', class: 'chev', transform: `translate(9,0)${open ? ' rotate(90)' : ''}` });
    g.append(chev);
    g.append(svgEl('rect', { x: 1, y: -12, width: 18, height: 24, fill: 'transparent', class: 'chev-hit' }));
    // 文件夹图标
    const ic = svgEl('path', {
      d: 'M1.8,3.2 A1.4,1.4 0 0 1 3.2,1.8 h3 l1.4,1.4 h7.6 a1.4,1.4 0 0 1 1.4,1.4 v7 a1.4,1.4 0 0 1 -1.4,1.4 H3.2 a1.4,1.4 0 0 1 -1.4,-1.4 Z',
      class: 'folder-ic', transform: 'translate(17,-6.8) scale(0.86)',
    });
    g.append(ic);
    const t1 = svgEl('text', { x: 32, y: 4.5, class: 'name', 'font-weight': '500' });
    t1.textContent = name;
    const t2 = svgEl('text', { x: 32 + nameW + 7, y: 4.5, class: 'aux' });
    t2.textContent = cnt;
    g.append(t1, t2);
  } else {
    const size = n._auxText;
    if (S.selected === n.p) g.append(svgEl('rect', { x: -4, y: -12, width: w + 6, height: 24, rx: 8, class: 'sel-rect' }));
    g.append(svgEl('circle', { cx: 3, cy: 0, r: 4, fill: kindColorOf(n) }));
    const t1 = svgEl('text', { x: 13, y: 4.5, class: 'name' });
    t1.textContent = name;
    const t2 = svgEl('text', { x: 13 + nameW + 8, y: 4.5, class: 'aux' });
    t2.textContent = size;
    g.append(t1, t2);
  }

  const tip = svgEl('title');
  tip.textContent = isDir ? `${n.n} · ${n.fc} 项 · ${humanSize(n.s)}` : `${n.n} · ${humanSize(n.s)} · ${fmtDate(n.m)}`;
  g.append(tip);
  const hit = svgEl('rect', { x: isDir ? -2 : -6, y: -14, width: w + 10, height: 28, fill: 'transparent' });
  g.append(hit);
  return g;
}

/* ---------------- 视图（缩放 / 平移） ---------------- */
function applyView() {
  world.setAttribute('transform', `translate(${S.view.tx},${S.view.ty}) scale(${S.view.k})`);
  $('#zoomPct').textContent = Math.round(S.view.k * 100) + '%';
}
function canvasSize() { return { W: canvasEl.clientWidth, H: canvasEl.clientHeight }; }
function zoomAt(px, py, factor) {
  const { k, tx, ty } = S.view;
  const k2 = Math.min(2.5, Math.max(0.15, k * factor));
  S.view.k = k2;
  S.view.tx = px - (px - tx) * (k2 / k);
  S.view.ty = py - (py - ty) * (k2 / k);
  applyView();
}
function fit() {
  if (!S.visibleList.length) return;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const n of S.visibleList) {
    minX = Math.min(minX, n._x - 8); maxX = Math.max(maxX, n._x + (n._w || 60) + 8);
    minY = Math.min(minY, n._y - 18); maxY = Math.max(maxY, n._y + 18);
  }
  const { W, H } = canvasSize();
  const k = Math.min(1.35, Math.max(0.15, Math.min((W - 70) / (maxX - minX), (H - 90) / (maxY - minY))));
  S.view.k = k;
  S.view.tx = (W - (maxX + minX) * k) / 2;
  S.view.ty = (H - (maxY + minY) * k) / 2 + 14;
  applyView();
}
function animateTo(tx, ty, k, dur = 240) {
  const s = { ...S.view }, t0 = performance.now();
  const ease = p => 1 - Math.pow(1 - p, 3);
  (function step(now) {
    const p = Math.min(1, (now - t0) / dur), e = ease(p);
    S.view.k = s.k + (k - s.k) * e;
    S.view.tx = s.tx + (tx - s.tx) * e;
    S.view.ty = s.ty + (ty - s.ty) * e;
    applyView();
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}
function panToNode(n, dur) {
  const { W, H } = canvasSize();
  const k = Math.max(S.view.k, 0.65);
  animateTo(W * 0.42 - n._x * k, H / 2 - n._y * k, k, dur);
}

/* 画布拖拽 / 滚轮
   注意：不能用 setPointerCapture——它会把 pointerup/click 重定向到 svg，
   导致节点点击与双击失效。改为 window 级监听跟踪拖拽。 */
let drag = null;
svg.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, tx: S.view.tx, ty: S.view.ty, moved: false };
});
window.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 5) {
    drag.moved = true;
    svg.classList.add('panning');
    S.view.tx = drag.tx + dx;
    S.view.ty = drag.ty + dy;
    applyView();
  }
});
window.addEventListener('pointerup', () => {
  if (drag && drag.moved) S.suppressClick = true;
  drag = null;
  svg.classList.remove('panning');
});
window.addEventListener('pointercancel', () => { drag = null; svg.classList.remove('panning'); });
svg.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = svg.getBoundingClientRect();
  zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.16 : 1 / 1.16);
}, { passive: false });

/* ---------------- 节点交互 ---------------- */
/* 注意：单击选中会重建树的 DOM，浏览器原生 dblclick 在新元素上不再触发，
   所以双击在这里用「同一节点 + 时间间隔」自行判定。 */
let lastNodeClick = { path: '', t: 0 };
world.addEventListener('click', e => {
  if (S.suppressClick) { S.suppressClick = false; return; }
  const g = e.target.closest && e.target.closest('g.node');
  if (!g) return;
  const n = S.byPath.get(g.getAttribute('data-p'));
  if (!n) return;
  if (e.target.classList && e.target.classList.contains('chev-hit')) { toggleFolder(n); return; }
  const now = performance.now();
  const isDouble = lastNodeClick.path === n.p && now - lastNodeClick.t < 420;
  lastNodeClick = { path: n.p, t: now };
  if (isDouble) {
    if (n.t === 'd') toggleFolder(n);
    else openFile(n.p);
    return;
  }
  selectNode(n);
});

function toggleFolder(n) {
  if (S.expanded.has(n.p)) S.expanded.delete(n.p);
  else S.expanded.add(n.p);
  render();
}
function selectNode(n, pan) {
  S.selected = n.p;
  render();
  showDetails(n);
  if (pan !== false && document.activeElement === $('#searchInput')) panToNode(n);
}

/* ---------------- 展开 / 收起 ---------------- */
function dirsAtDepthLess(d) {
  const set = new Set();
  (function walk(n, depth) {
    if (n.t !== 'd' || !n.c) return;
    if (depth < d) { set.add(n.p); n.c.forEach(c => walk(c, depth + 1)); }
  })(S.rootNode, 0);
  return set;
}
function expandDepth(d) {
  if (d === 'all') {
    const set = new Set();
    (function walk(n) { if (n.t === 'd' && n.c) { set.add(n.p); n.c.forEach(walk); } })(S.rootNode);
    S.expanded = set;
  } else {
    S.expanded = dirsAtDepthLess(d);
  }
  document.querySelectorAll('.tool.seg').forEach(b => {
    b.classList.toggle('active', b.dataset.depth === String(d));
  });
  render();
  requestAnimationFrame(fit);
}

/* ---------------- 搜索 ---------------- */
const searchInput = $('#searchInput');
let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 160);
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') { searchInput.value = ''; runSearch(); searchInput.blur(); }
});
function runSearch() {
  const q = searchInput.value.trim().toLowerCase();
  S.q = q;
  S.matchSet = new Set(); S.matchList = []; S.matchIdx = -1;
  if (q && S.rootNode) {
    (function walk(n) {
      if (n.n.toLowerCase().includes(q)) {
        S.matchList.push(n); S.matchSet.add(n.p);
        for (let p = S.parent.get(n.p); p; p = S.parent.get(p.p)) S.expanded.add(p.p);
      }
      if (n.c) n.c.forEach(walk);
    })(S.rootNode);
  } else if (!q) {
    $('#matchChip').hidden = true;
    render();
    return;
  }
  const chip = $('#matchChip');
  chip.hidden = false;
  chip.innerHTML = S.matchList.length
    ? `<b>${S.matchList.length}</b> 个结果 · Enter 逐个跳转`
    : '没有找到匹配的文件';
  render();
  if (S.matchList.length) stepMatch(1, true);
}
function stepMatch(dir, first) {
  if (!S.matchList.length) return;
  S.matchIdx = (S.matchIdx + (first && dir > 0 ? 0 : dir) + S.matchList.length) % S.matchList.length;
  const n = S.matchList[S.matchIdx];
  S.selected = n.p;
  render();
  showDetails(n);
  panToNode(n);
}

/* ---------------- 键盘导航 ---------------- */
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); searchInput.focus(); searchInput.select(); return; }
  if (typing) return;
  if (!S.rootNode) return;
  const idx = S.visibleList.findIndex(n => n.p === S.selected);
  const cur = idx >= 0 ? S.visibleList[idx] : null;
  if (e.key === 'ArrowDown' && idx < S.visibleList.length - 1) { e.preventDefault(); selectNode(S.visibleList[idx + 1]); }
  else if (e.key === 'ArrowUp' && idx > 0) { e.preventDefault(); selectNode(S.visibleList[idx - 1]); }
  else if (e.key === 'ArrowRight' && cur && cur.t === 'd' && !S.expanded.has(cur.p)) { e.preventDefault(); toggleFolder(cur); }
  else if (e.key === 'ArrowLeft' && cur) {
    e.preventDefault();
    if (cur.t === 'd' && S.expanded.has(cur.p)) toggleFolder(cur);
    else { const p = S.parent.get(cur.p); if (p) selectNode(p); }
  }
  else if (e.key === 'Enter' && cur && cur.t === 'd') { e.preventDefault(); toggleFolder(cur); }
});

/* ---------------- 面包屑 ---------------- */
function updateBreadcrumb() {
  const bc = $('#breadcrumb');
  if (!S.selected) { bc.hidden = true; return; }
  bc.hidden = false;
  const chain = [];
  for (let n = S.byPath.get(S.selected); n; n = S.parent.get(n.p)) chain.unshift(n);
  let show = chain;
  if (chain.length > 5) show = [chain[0], null, ...chain.slice(-3)];
  bc.innerHTML = '';
  show.forEach((n, i) => {
    if (!n) {
      const s = document.createElement('span');
      s.className = 'crumb-sep'; s.textContent = '…';
      bc.append(s);
      return;
    }
    const c = document.createElement('span');
    c.className = 'crumb' + (i === show.length - 1 ? ' cur' : '');
    c.textContent = n.n.length > 26 ? n.n.slice(0, 25) + '…' : n.n;
    c.title = n.p;
    c.onclick = () => selectNode(n);
    bc.append(c);
    if (i < show.length - 1) {
      const s = document.createElement('span');
      s.className = 'crumb-sep'; s.textContent = '/';
      bc.append(s);
    }
  });
}

/* ---------------- 详情面板 ---------------- */
const details = $('#details');
const fileCache = new Map();

function skeletonDetails(name) {
  details.innerHTML = `
    <div class="d-head"><div class="d-icon" style="background:#f0f1f3"></div>
    <div class="d-titlebox"><div class="d-title">${esc(name)}</div><div class="d-kind">正在读取…</div></div></div>
    <div style="padding:6px 20px 20px"><div class="sk-line" style="width:88%"></div><div class="sk-line" style="width:70%"></div><div class="sk-line" style="width:80%"></div><div class="sk-line" style="width:55%"></div></div>`;
}

async function showDetails(n) {
  if (n.t === 'd') { renderFolderDetails(n); return; }
  skeletonDetails(n.n);
  const key = n.p + ':' + n.m + ':' + n.s;
  let d;
  try {
    if (fileCache.has(key)) d = fileCache.get(key);
    else { d = await api('/api/file?path=' + encodeURIComponent(n.p)); fileCache.set(key, d); }
  } catch (err) {
    details.innerHTML = `<div class="d-sec" style="border:none;padding-top:26px"><div class="warn">读取失败：${esc(err.message)}</div></div>`;
    return;
  }
  if (S.selected !== n.p) return;   // 已切换到别的节点
  renderFileDetails(n, d);
}

function iconStyle(color) { return `background:${color}14;color:${color};border:1px solid ${color}38`; }

function renderFileDetails(n, d) {
  const kind = d.kind || kindOfExt(n.e);
  const color = KIND_COLOR[kind] || '#98a2b3';
  const extText = (n.e || 'file').toUpperCase().slice(0, 5);
  const stem = n.n.replace(/\.[^.]+$/, '');
  const chips = [];
  chips.push(`大小 ${humanSize(d.size ?? n.s)}`);
  chips.push(`修改于 ${fmtDate(d.mtime ?? n.m)}`);
  const st = d.stats || {};
  if (st.pages) chips.push(`${st.pages} 页`);
  if (st.slides) chips.push(`${st.slides} 张幻灯片`);
  if (st.sheets) chips.push(`${st.sheets} 个工作表`);
  if (st.entries) chips.push(`${st.entries} 个条目`);
  if (st.uncompressed) chips.push(`解压后 ${humanSize(st.uncompressed)}`);
  if (d.image_size) chips.push(`${d.image_size[0]} × ${d.image_size[1]}`);
  if (st.chars > 100) chips.push(`约 ${st.chars.toLocaleString()} 字`);

  let summary = '';
  const hasSummary = (d.gist || (d.points && d.points.length) || (d.title && d.title !== stem));
  if (hasSummary) {
    summary = `<div class="d-sec"><h4>摘要 <span style="font-weight:400;color:#b6bcc5">· 自动提取自正文</span></h4>`;
    if (d.title && d.title !== stem) summary += `<div class="d-title-line">${esc(d.title)}</div>`;
    if (d.gist) summary += `<div class="gist">${esc(d.gist.slice(0, 600))}${d.gist.length > 600 ? '…' : ''}</div>`;
    if (d.points && d.points.length) summary += `<ul class="points">${d.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`;
    summary += `</div>`;
  }
  const warns = (d.warnings || []).map(w => `<div class="warn">${esc(w)}</div>`).join('');

  let contentSec = '';
  const thumb = kind === 'pdf'
    ? `<div class="d-sec"><h4>首页预览</h4><img class="img-preview" src="/api/thumb?path=${encodeURIComponent(n.p)}" alt="首页" loading="lazy"></div>`
    : '';
  if (kind === 'image') {
    contentSec = `<div class="d-sec"><h4>图片预览</h4><img class="img-preview" src="/api/raw?path=${encodeURIComponent(n.p)}" alt="${esc(n.n)}" loading="lazy"></div>`;
  } else if (d.content) {
    contentSec = thumb + `<div class="d-sec"><h4>内容预览</h4><div class="content">${esc(d.content)}</div>` +
      (d.full_available ? `<button class="expand-btn" id="expandFull">展开全文（最多 6 万字）↓</button>` : '') + `</div>`;
  } else if (kind === 'pdf') {
    contentSec = thumb;
  } else if (!warns) {
    contentSec = `<div class="d-sec"><h4>内容预览</h4><div class="empty-note">没有可提取的文本内容。</div></div>`;
  }

  details.innerHTML = `
    <div class="d-head">
      <div class="d-icon" style="${iconStyle(color)}">${esc(extText)}</div>
      <div class="d-titlebox">
        <div class="d-title" title="${esc(n.n)}">${esc(n.n)}</div>
        <div class="d-kind">${esc(d.kind_label || KIND_LABEL[kind] || '')}</div>
      </div>
    </div>
    <div class="d-path"><span title="${esc(n.p)}">${esc(n.p)}</span><button class="copy-btn" data-copy="${esc(n.p)}">复制</button></div>
    <div class="d-actions">
      <button class="btn-primary" data-open="${esc(n.p)}">打开文件</button>
      <button class="btn" data-reveal="${esc(n.p)}">所在文件夹</button>
    </div>
    ${summary}
    <div class="stat-chips" style="padding:0 20px 16px;${chips.length ? '' : 'display:none'}">${chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>
    ${contentSec}
    <div style="padding:0 20px 18px">${warns}</div>`;

  const ex = $('#expandFull');
  if (ex) ex.onclick = async () => {
    ex.textContent = '正在展开…';
    try {
      const full = await api('/api/file?path=' + encodeURIComponent(n.p) + '&full=1');
      fileCache.delete(n.p + ':' + n.m + ':' + n.s);
      renderFileDetails(n, full);
      const box = details.querySelector('.content');
      if (box) box.classList.add('full');
    } catch (err) { toast(err.message); ex.textContent = '展开全文（最多 6 万字）↓'; }
  };
  bindDetailsEvents();
}

function subtreeStats(n) {
  let files = 0, dirs = 0, size = 0, count = 0;
  const byKind = new Map(), arr = [];
  (function walk(x) {
    if (++count > 60000) return;
    if (x.t === 'f') {
      files++; size += x.s || 0;
      const k = kindOfExt(x.e || '');
      byKind.set(k, (byKind.get(k) || 0) + 1);
      arr.push(x);
    } else dirs++;
    if (x.c) x.c.forEach(walk);
  })(n);
  const largest = arr.slice().sort((a, b) => b.s - a.s).slice(0, 5);
  const recent = arr.slice().sort((a, b) => b.m - a.m).slice(0, 5);
  return { files, dirs: Math.max(0, dirs - 1), size, byKind, largest, recent };
}

function renderFolderDetails(n) {
  const st = subtreeStats(n);
  const kinds = [...st.byKind.entries()].sort((a, b) => b[1] - a[1]);
  const top = kinds.slice(0, 6);
  const otherKinds = kinds.slice(6);
  const otherN = otherKinds.reduce((s, [, v]) => s + v, 0);
  const otherLabel = otherKinds.length ? `其他（${otherKinds.slice(0, 3).map(([k]) => KIND_LABEL[k]).join('、')}${otherKinds.length > 3 ? ' 等' : ''}）` : '其他';
  const segs = top.map(([k, v]) => `<i style="width:${(v / st.files * 100).toFixed(1)}%;background:${KIND_COLOR[k]}" title="${KIND_LABEL[k]} ${v} 个"></i>`).join('') +
    (otherN ? `<i style="width:${(otherN / st.files * 100).toFixed(1)}%;background:#ced4dd" title="${otherLabel} ${otherN} 个"></i>` : '');
  const legend = top.map(([k, v]) =>
    `<div class="lrow"><span class="ldot" style="background:${KIND_COLOR[k]}"></span><span class="lname">${KIND_LABEL[k]}</span><span class="lnum">${v} 个 · ${Math.round(v / st.files * 100)}%</span></div>`).join('') +
    (otherN ? `<div class="lrow"><span class="ldot" style="background:#ced4dd"></span><span class="lname">${otherLabel}</span><span class="lnum">${otherN} 个 · ${Math.round(otherN / st.files * 100)}%</span></div>` : '');

  const rowHtml = f => {
    const node = S.byPath.get(f.p);
    if (!node) return '';
    return `<div class="row" data-p="${esc(f.p)}"><span class="rdot" style="background:${kindColorOf(f)}"></span><span class="rname" title="${esc(f.n)}">${esc(f.n)}</span><span class="rval">${humanSize(f.s)}</span></div>`;
  };
  const recentHtml = f => {
    const node = S.byPath.get(f.p);
    if (!node) return '';
    return `<div class="row" data-p="${esc(f.p)}"><span class="rdot" style="background:${kindColorOf(f)}"></span><span class="rname" title="${esc(f.n)}">${esc(f.n)}</span><span class="rval">${fmtDate(f.m).slice(5)}</span></div>`;
  };

  details.innerHTML = `
    <div class="d-head">
      <div class="d-icon folder-ic">📂</div>
      <div class="d-titlebox">
        <div class="d-title" title="${esc(n.n)}">${esc(n.n)}</div>
        <div class="d-kind">文件夹</div>
      </div>
    </div>
    <div class="d-path"><span title="${esc(n.p)}">${esc(n.p)}</span><button class="copy-btn" data-copy="${esc(n.p)}">复制</button></div>
    <div class="d-actions">
      <button class="btn-primary" data-open="${esc(n.p)}">打开文件夹</button>
      <button class="btn" data-reveal="${esc(n.p)}">在资源管理器中显示</button>
    </div>
    <div class="stat-chips" style="padding:0 20px 16px">
      <span class="chip">${st.files} 个文件</span>
      <span class="chip">${st.dirs} 个子文件夹</span>
      <span class="chip">共 ${humanSize(st.size)}</span>
    </div>
    ${st.files ? `<div class="d-sec"><h4>文件构成</h4><div class="typebar">${segs}</div><div class="legend">${legend}</div></div>` : '<div class="d-sec"><h4>文件构成</h4><div class="empty-note">这是一个空文件夹。</div></div>'}
    ${st.largest.length ? `<div class="d-sec"><h4>最大的文件</h4><div class="mini-list">${st.largest.map(rowHtml).join('')}</div></div>` : ''}
    ${st.recent.length ? `<div class="d-sec"><h4>最近修改</h4><div class="mini-list">${st.recent.map(recentHtml).join('')}</div></div>` : ''}
  `;
  bindDetailsEvents();
}

function bindDetailsEvents() {
  details.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('路径已复制'); }
    catch (e) { toast('复制失败，请手动复制'); }
  });
  details.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openFile(b.dataset.open));
  details.querySelectorAll('[data-reveal]').forEach(b => b.onclick = () => revealFile(b.dataset.reveal));
  details.querySelectorAll('.mini-list .row').forEach(r => r.onclick = () => {
    const node = S.byPath.get(r.dataset.p);
    if (node) {
      for (let p = S.parent.get(node.p); p; p = S.parent.get(p.p)) S.expanded.add(p.p);
      selectNode(node);
      panToNode(node);
    }
  });
}
async function openFile(path) {
  try { await api('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }); }
  catch (err) { toast(err.message); }
}
async function revealFile(path) {
  try { await api('/api/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }); }
  catch (err) { toast(err.message); }
}

/* ---------------- 加载根目录 ---------------- */
function showLoading(on, path) {
  $('#loading').hidden = !on;
  if (on) $('#loadingText').textContent = `正在扫描 ${path || '文件夹'} …`;
}
function showWelcome(err) {
  $('#welcome').hidden = false;
  if (err) $('#welcomeNote').textContent = err;
}
function updateHeader(data) {
  $('#rootChipText').textContent = data.name;
  $('#rootChip').title = data.root;
  const s = data.stats;
  $('#topStats').textContent =
    `${s.files} 个文件 · ${s.dirs} 个文件夹 · ${humanSize(s.size)}` +
    (s.skipped ? ` · 已忽略 ${s.skipped} 个系统文件` : '');
}

async function loadRoot(path) {
  path = (path || '').trim().replace(/^"+|"+$/g, '');
  if (!path) { toast('请先输入文件夹路径'); return; }
  showLoading(true, path);
  try {
    const data = await api('/api/tree?root=' + encodeURIComponent(path));
    S.rootPath = data.root;
    S.rootNode = data.node;
    S.stats = data.stats;
    indexTree();
    S.expanded = dirsAtDepthLess(2);
    S.selected = data.root;
    S.q = ''; S.matchSet = new Set(); S.matchList = [];
    searchInput.value = '';
    $('#matchChip').hidden = true;
    updateHeader(data);
    $('#welcome').hidden = true;
    $('#toolbar').hidden = false;
    $('#hintPill').hidden = false;
    document.querySelectorAll('.tool.seg').forEach(b => b.classList.toggle('active', b.dataset.depth === '2'));
    render();
    // 支持 ?select=<路径> 深链：载入后自动展开并选中指定节点
    const selParam = new URLSearchParams(location.search).get('select');
    if (selParam) {
      const target = S.byPath.get(selParam);
      if (target) {
        for (let p = S.parent.get(target.p); p; p = S.parent.get(p.p)) S.expanded.add(p.p);
        render();
        selectNode(target);
        requestAnimationFrame(() => panToNode(target));
      }
    }
    requestAnimationFrame(() => fit());
    showDetails(S.byPath.get(S.selected) || data.node);
    history.replaceState(null, '', '?root=' + encodeURIComponent(data.root));
    $('#rootPop').hidden = true;
  } catch (err) {
    showWelcome(err.message);
    toast(err.message);
  } finally {
    showLoading(false);
  }
}

/* ---------------- 更换文件夹弹层 ---------------- */
const rootPop = $('#rootPop');
$('#rootChip').addEventListener('click', async e => {
  e.stopPropagation();
  rootPop.hidden = !rootPop.hidden;
  if (!rootPop.hidden) {
    $('#popPath').value = S.rootPath || '';
    try {
      const { roots } = await api('/api/roots');
      const box = $('#popRoots');
      box.innerHTML = roots.map(r => `
        <div class="prow" data-r="${esc(r)}">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2a1.5 1.5 0 0 1 1 .4L8.4 3.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z"/></svg>
          <span>${esc(r)}</span>
        </div>`).join('');
      box.querySelectorAll('.prow').forEach(r => r.onclick = () => loadRoot(r.dataset.r));
    } catch (e) { /* 忽略 */ }
    $('#popPath').focus();
  }
});
document.addEventListener('click', e => {
  if (!rootPop.hidden && !rootPop.contains(e.target)) rootPop.hidden = true;
});
$('#popGo').addEventListener('click', () => loadRoot($('#popPath').value));
$('#popPath').addEventListener('keydown', e => { if (e.key === 'Enter') loadRoot($('#popPath').value); });

/* 系统原生文件夹选择框 */
async function pickFolder() {
  toast('正在打开文件夹选择框…');
  try {
    const d = await api('/api/pick-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (d.cancelled || !d.path) return;
    loadRoot(d.path);
  } catch (err) {
    toast(err.message);
  }
}
$('#popBrowse').addEventListener('click', pickFolder);

/* ---------------- 工具栏 ---------------- */
$('#zoomIn').addEventListener('click', () => { const { W, H } = canvasSize(); zoomAt(W / 2, H / 2, 1.25); });
$('#zoomOut').addEventListener('click', () => { const { W, H } = canvasSize(); zoomAt(W / 2, H / 2, 0.8); });
$('#fitBtn').addEventListener('click', fit);
document.querySelectorAll('.tool.seg').forEach(b => b.addEventListener('click', () => expandDepth(b.dataset.depth)));

/* ---------------- 自定义布局：面板宽度 + 浮动条位置 ---------------- */
const detailsEl = $('#details');

/* 画布 / 详情面板分隔条：拖动调整宽度，记忆到 localStorage */
(() => {
  const bar = $('#vsplit');
  let sz = null;
  bar.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    sz = { x: e.clientX, w: detailsEl.getBoundingClientRect().width };
    bar.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('pointermove', e => {
    if (!sz) return;
    const maxW = Math.max(320, Math.min(760, window.innerWidth - 460));
    const w = Math.max(300, Math.min(sz.w + (sz.x - e.clientX), maxW));
    detailsEl.style.width = w + 'px';
  });
  window.addEventListener('pointerup', () => {
    if (!sz) return;
    try { localStorage.setItem('fr:detailsW', detailsEl.style.width); } catch (e) { /* 忽略 */ }
    sz = null;
    bar.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
  try {
    const w = localStorage.getItem('fr:detailsW');
    if (w) detailsEl.style.width = w;
  } catch (e) { /* 忽略 */ }
})();

/* 浮动条（工具栏 / 面包屑 / 提示）可拖动、双击复位、位置记忆 */
function makeDraggable(el, id) {
  if (!el) return;
  let dz = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('button, .crumb, input, a, kbd')) return;   // 这些留给点击
    const r = el.getBoundingClientRect();
    dz = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, moved: false };
    el.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('pointermove', e => {
    if (!dz) return;
    const c = canvasEl.getBoundingClientRect();
    const x = Math.max(4, Math.min(e.clientX - c.left - dz.dx, c.width - dz.w - 4));
    const y = Math.max(4, Math.min(e.clientY - c.top - dz.dy, c.height - dz.h - 4));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    dz.moved = true;
  });
  window.addEventListener('pointerup', () => {
    if (!dz) return;
    if (dz.moved) {
      try { localStorage.setItem('fr:pos:' + id, JSON.stringify({ left: el.style.left, top: el.style.top })); } catch (e) { /* 忽略 */ }
    }
    dz = null;
    el.classList.remove('dragging');
  });
  el.addEventListener('dblclick', e => {
    if (e.target.closest('button, .crumb, input, a, kbd')) return;
    try { localStorage.removeItem('fr:pos:' + id); } catch (err) { /* 忽略 */ }
    el.style.left = el.style.top = el.style.right = el.style.bottom = '';
    toast('已恢复默认位置');
  });
  try {
    const s = JSON.parse(localStorage.getItem('fr:pos:' + id) || 'null');
    if (s && s.left && s.top) {
      el.style.left = s.left;
      el.style.top = s.top;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
  } catch (e) { /* 忽略 */ }
}
makeDraggable($('#toolbar'), 'toolbar');
makeDraggable($('#breadcrumb'), 'breadcrumb');
makeDraggable($('#hintPill'), 'hint');

/* ---------------- 欢迎页 ---------------- */
$('#welcomeGo').addEventListener('click', () => loadRoot($('#welcomePath').value));
$('#welcomePath').addEventListener('keydown', e => { if (e.key === 'Enter') loadRoot($('#welcomePath').value); });
$('#welcomeBrowse').addEventListener('click', pickFolder);

/* ---------------- 启动 ---------------- */
const DEFAULT_ROOT = __DEFAULT_ROOT__;
const urlRoot = new URLSearchParams(location.search).get('root');
if (urlRoot || DEFAULT_ROOT) {
  loadRoot(urlRoot || DEFAULT_ROOT);
} else {
  $('#welcome').hidden = false;
}
document.fonts && document.fonts.ready.then(() => { if (S.rootNode) render(); });
