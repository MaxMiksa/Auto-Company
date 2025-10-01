# Local Workflow Notes

- Symptom: In WSL, `git status` under `../clone` may show many modified files even when no meaningful content was edited.
- Cause: `clone` is an archive copy and can appear dirty because of CRLF/LF conversion differences between Windows Git and WSL Git.
- Fix: Treat `clone` as read-only archive. Do all development, testing, and commits only in `clone_win`.

- Symptom: Temporary artifacts from acceptance/testing runs (logs, pid/state files, env files) accumulate and interfere with clean verification.
- Cause: Validation commands start real services/loops and create runtime files that persist if not explicitly cleaned.
- Fix: After each validation batch, always stop services and delete test-generated artifacts (for example `.auto-loop*`, test logs) before reporting completion.
