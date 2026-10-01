# COI Chase Desk · 保单跟进台

A local, single-project desk for recording certificate-of-insurance requests, follow-ups made elsewhere, and received-document references. Start with six clearly synthetic records; all demo contacts use `example.com`.

## Run

Serve this directory: `python3 -m http.server 8000 --bind 127.0.0.1` (Windows: `py -m http.server 8000 --bind 127.0.0.1`). Open <http://127.0.0.1:8000/>. There are no third-party runtime dependencies or remote assets. Use the EN / 中文 switch or `?lang=en` / `?lang=zh`.

## Use

Add a request, filter or search the list, open its record and log a follow-up. Register the received-document reference when it arrives; reopen a request if another follow-up is needed. Counts derive from the current records. Export CSV before refreshing or closing the page. CSV includes record source, contacts, coverage requested, dates, statuses, receipt references and the activity history.

All changes live only in this page session. Nothing is saved to disk until you export. The app does not send messages, upload or store documents, authenticate users, check insurance coverage or provide insurance/legal advice. Receipt status only means the user recorded receipt. Demo dates are historical sample values, not the current date. Entered content is never translated; synthetic labels and interface text switch languages.

## 中文使用

添加资料请求，在列表中搜索或按状态筛选。打开记录后，记下已经完成的联系；收到资料时填写出处，也可以重新打开继续跟进。关闭或刷新前请导出 CSV，否则本次新增内容会消失。

本工具只记录跟进与收件，不会发送邮件，不上传文件，不核验保险保障，也不提供保险或法律建议。初始六项内容为合成演示，所有邮箱均使用 `example.com`。

## Check and source

Node.js 18 or newer: `npm test`. Core tests cover state transitions, retained history, escaping and CSV safety. See [SOURCE.md](SOURCE.md) for provenance and publication changes. Covered by the repository [MIT license](../../LICENSE).
