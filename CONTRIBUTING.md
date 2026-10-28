# 贡献指南

欢迎 Issue 与 PR！这是一个刻意保持轻量的项目，提交前请先了解几条约定。

## 本地开发

```bash
pip install -r requirements.txt
python server.py demo/示例项目资料库     # 用自带示例数据启动
```

前端无构建步骤：`static/` 下是原生 HTML/CSS/JS，改完刷新浏览器即可。

## 测试

```bash
python scripts/make_demo.py     # 重新生成示例数据
python tests/smoke_test.py      # API 冒烟测试（会自动起一个临时服务）
```

PR 请保证冒烟测试通过；改动了抽取逻辑时，请在 demo 数据或测试中覆盖对应格式。

## 代码约定

- **零框架原则**：后端只用 Python 标准库 + pymupdf/openpyxl；前端不引入框架、构建工具和 CDN 依赖，保持单页直开
- 新的文件格式支持统一加在 `extractor.py` 的 `inspect()` 分派里，返回结构保持
  `kind / title / gist / points / stats / content / warnings` 字段兼容
- UI 文案使用中文；代码注释说清"为什么"，而不是复述代码
- 提交信息用一句简洁的中文或英文均可，说清改了什么

## 报告问题

Issue 请附上：操作系统、Python 版本、触发操作的描述、控制台输出。涉及具体文件解析失败时，
如方便请提供一个可复现的最小文件。
