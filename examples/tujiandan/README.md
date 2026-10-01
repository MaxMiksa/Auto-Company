# 图检单

图检单是在浏览器本地运行的免费图片批次检查页，用于交付前核对尺寸、体积、格式和文件名，并导出 CSV 检查单。完整支持简体中文与 English，包括规则说明、动态结果和导出。图片不会上传，检查不会修改原文件。

## 使用

安装 Node.js 22 或更新版本，在本目录运行 `npm start`，打开 [本机工作台](http://127.0.0.1:8000)。无需安装依赖。先按本次交付要求调整示例规则，再拖入图片，或选择多个文件／文件夹。结果会随规则修改而更新；“待处理”可快速筛出异常文件。右上角切换语言；仅保存语言偏好，不保存图片或批次。

初始示例为宽高各至少 1200 px、单张不超过 5 MiB、允许 JPEG／PNG／WebP、检查文件名首尾空格及同批重名。它们不是平台或行业标准。

## 边界

- 支持识别 PNG、JPEG、WebP、GIF、AVIF、BMP 和 SVG 文件内容；SVG 会显示格式，但不按 `viewBox` 推断像素尺寸，状态为“无法检查”。浏览器无法解码的文件也会显示“无法检查”。
- 格式依文件头识别，同时核对扩展名；大小使用实际字节数。文件名只按当前规则检查，不自动重命名。
- 导出的 CSV 记录本次规则及每个文件的结果。没有登录、文件存储、服务端处理或批次历史。刷新或关闭页面后批次消失，请先导出。
- 文件夹选择需要支持该功能的浏览器。拖入文件夹是否可用取决于浏览器；可用“选择文件夹”按钮。

`npm test` 运行规则及翻译导出检查。来源与人工展示改动见 [SOURCE.md](SOURCE.md)。

## English

Image Checklist is a free local utility for reviewing dimensions, file size, content format and filenames before delivery. Install Node.js 22 or later, run `npm start` in this folder, and open [the local workspace](http://127.0.0.1:8000). No dependencies or account are required. Select English at the top right, set the sample requirements for your delivery, add images or a folder, review the issues and export CSV.

Files never leave your browser and are not modified. Only your language preference is saved; a reload clears the batch. Unsupported or corrupt images remain marked “Unable to check.” SVG is recognized but its viewBox is not treated as pixel dimensions. Folder selection depends on browser support. Rules are examples, not industry or platform standards; this utility does not judge image quality or replace final platform validation. No commercial adoption or paid demand has been established.
