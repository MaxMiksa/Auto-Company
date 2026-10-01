# 验证说明

检查对象是本地软件核心流程，不是所有 PDF 的安全认证或商业采用。

正式检查使用真实生成的中文 PDF 和本地 HTTP 服务，覆盖删除/保留、版本摘要、失败隔离和访问边界；浏览器检查使用实际 Chromium，操作上传、复核、报告导出、规则复用和结果失效。测试用 PDF 不含真实个人信息，原历史实验不会改写。

运行 `.venv/bin/python -m unittest tests.test_workflow -v` 获取实际结果；原模型运行的结构化验收、退出码与产品指纹保留在原运行。任何失败先保留其记录，再修复和重检。截图是外观证据，不代替功能测试。浏览器外观截图默认保存于 `test-results/browser-evidence/`，可设置 `BROWSER_EVIDENCE_DIR` 改变位置。

历史交付环境使用 Python 3.12、PyMuPDF 1.28.2 与 Playwright Chromium。独立检查应安装与 Playwright 版本对应的浏览器；已有浏览器可设置 `BROWSER_EXECUTABLE_PATH`。仅支持当前清单可提取文字的明确约束；复杂编码、图像、业务语义和穷尽历史对象恢复仍是明确边界。
