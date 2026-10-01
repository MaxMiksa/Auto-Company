# ScopeFence

ScopeFence turns a freelance scope change into a clear, no-login decision link. Enter the project, changed work, price impact, and timeline impact; send the generated link; then ask the client to return the updated link after selecting approve or decline.

## Run locally

Serve this directory over loopback HTTP:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

On Windows, use `py` instead of `python3`. Open <http://127.0.0.1:8000/>.

## Test

The project has no third-party runtime or test dependencies. With a current Node.js release installed:

```sh
npm test
```

## What the link means

The receipt data and selected response are stored as JSON encoded in the URL fragment. The fragment is not sent to the static HTTP server, but it is visible to anyone who receives the link and can remain in browser history, the clipboard, email, or chat.

Encoding is not signing. Anyone with the link can decode and alter its contents. ScopeFence does not authenticate either party, prove who selected a response, provide a tamper-evident audit log, create a contract, send email, or process payment. Treat the returned link as a portable communication copy and confirm the choice in the original conversation before relying on it.

The page validates the supported fields and rejects malformed final-decision payloads, but validation does not make a link authoritative.

## Browser support and limits

- ScopeFence uses modern browser APIs including ES modules, URL fragments, Clipboard, `crypto.randomUUID`, `TextEncoder`, and `TextDecoder`.
- Receipt fields are deliberately bounded, but long content still produces a long URL. Messaging tools and browsers can impose their own URL limits.
- Data remains on the device unless a user copies or shares the link. The application has no backend and makes no network requests beyond loading its own static files.
- A response link is editable and can be copied out of context. It is not suitable as a verified approval record.

## License and asset source

This snapshot is covered by the repository's [MIT license](../../LICENSE). The geometric SVG icon is a program-generated fallback asset from Auto Company's product-media flow; no external images, fonts, scripts, or styles are bundled. See [source and review history](SOURCE.md) for the autonomous run and publication fixes.

## Language / 界面语言

Use the EN / 中文 switch, or open `?lang=en` / `?lang=zh`. Switching languages keeps the current draft or receipt; entered content is never translated. Shared links retain the chosen interface language.

中文版：先填写变更内容与费用、工期，再复制链接发给对方。对方选择后须把更新后的链接发回原对话。链接可编辑，不提供身份验证或签名证明。金额使用美元；没有邮件、付款、账户或后端服务。
