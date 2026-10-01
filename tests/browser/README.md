# Dashboard browser smoke

Run from this directory with Node.js 20+ and Python 3.10+:

```sh
npm ci
npx playwright install --with-deps chromium
npm test
```

The suite uses Chromium to open and click the real dashboard served by its Python
HTTP handler. Each test gets a temporary checkout and an OS-assigned loopback
port. Language persistence and HTTP handling stay real. Host status/action calls
are replaced, so no service, runtime loop or paid CLI starts and no user state is
read or written. Fixtures cover stopped, running and unavailable states
without starting a real runtime on any operating system.
External font requests are blocked.

The checks cover the default cycle journal, refresh and runtime controls, saved
language after a reload, current versus next-product language, failure feedback,
and recovery after a failed status request. Journal archive tests also cover
cycle/log identity, incomplete usage, untrusted reports, keyboard navigation and
narrow layouts. Failure scenarios are deliberately injected at the host or HTTP
boundary; normal requests use the real server.

Product-center regressions also cover six-round history and usage, older recorded
details, optional exploration directions, preparation failures after reload,
owned attention stop controls, and refresh focus. Their isolated center uses real
catalog and HTTP handlers with a fake execution adapter; the clone worker and
preview health are injected. These fixtures do not verify a live model or preview
process and are not product showcase screenshots.

Python defaults to `python` on Windows and `python3` elsewhere. Set
`AUTO_COMPANY_BROWSER_PYTHON` to an executable path if needed. Tests run serially
without automatic retries. Failures retain screenshots, traces and server logs
under `test-results/`; the HTML report is in `playwright-report/`. CI should upload
both directories on failure.

`showcase.spec.js` serves the public snapshots from `examples/`, checks the 22-entry
catalog and CLI entrypoint, loads every static frontend and exercises the migrated
CSV/SRT examples, text counter, editable decision link and Chinese scope sheet.
Backend entrypoints are checked for presence; their domain tests remain in each
example and are not substituted by this static-browser smoke suite.
