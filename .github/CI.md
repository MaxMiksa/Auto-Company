# Continuous integration

Every pull request and push to `main` starts **Auto Company Runtime CI**. The
`CI gate` job reports whether all checks selected for that change succeeded.
Only this aggregate job should be a required status check on `main`.

| Change | Checks |
| --- | --- |
| Runtime, configuration, or runtime tests | Windows PowerShell 5.1/7, Python, macOS launchd, Shell syntax, Linux systemd and runtime contracts |
| Dashboard or its runtime/language dependencies | Dashboard Chromium smoke tests, in addition to applicable runtime checks |
| A published example under `projects/` | That example's core tests (TableDelta/CueCheck) or type check (SnapOG) |
| CI workflow or routing policy | All checks |
| Ordinary documentation only | Successful routing and aggregate gate; test jobs explicitly skipped |

Unknown file areas or unavailable comparison commits conservatively select all
checks. A manual run always selects all checks. Renamed and deleted paths are
included in routing. Selected jobs must succeed: failure, cancellation, missing
results, or unexpected skipping fail the gate.

Do not add workflow-level path filters or use skip-CI commit messages: a required
workflow that never starts cannot report a result. Keep the required check name
`CI gate` stable. The workflow has read-only repository permissions and does not
use deployment credentials, paid models, or self-hosted machines.

## Browser smoke tests

```sh
cd tests/browser
npm ci
npx playwright install --with-deps chromium
npm test
```

The browser opens the actual Dashboard and Python HTTP handler against a fresh
temporary workspace. Host service operations are isolated. The tests exercise
page controls, saved language, current/next product language, and API failures.
They do not start the user's company service or an AI engine.

## Failure evidence and maintenance

Each test command streams its output to the Actions log and a `ci-results/` file.
Failed test jobs upload their logs for 14 days. Browser failures also retain the
HTML report, screenshots, and Playwright traces. Setup failures before evidence
exists remain visible in the Actions step log. The run summary shows routing,
command results, and the final gate decision.

Actions are pinned to full commit SHAs with release-version comments. Dependabot
opens weekly update PRs for Actions and the browser test dependency. Updates must
pass the same CI gate; they are not automatically merged.

Temporary CI acceptance probe: documentation-only change; do not merge.
