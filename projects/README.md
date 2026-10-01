# Projects

## Public examples moved to examples/

The 22 human-authorized product snapshots are catalogued in [examples/README.md](../examples/README.md), with local startup instructions, limits and provenance. Previously published TableDelta, CueCheck, ScopeFence, Text Meter and Scope Sheet now have one public source location under `examples/`.

The existing [SnapOG](snapog/) asset remains tracked here. Its files and migration/recovery dependencies are preserved. Public snapshots are not selectable independent runtime repositories.

公开示例统一在 [examples/](../examples/)，本目录继续保存新运行生成的独立产品。SnapOG 历史资产不迁移或删除。

## Product repository boundary

Newly generated products live under this directory for local convenience, but
every new product is its own Git repository. Product commits, remotes, and pushes
do not belong to the Auto Company framework repository by default. Public snapshots under `examples/` are explicit human-authorized publications; autonomous cycles must not add tracked product source here or in `examples/`.

Use the explicit lifecycle commands from the framework root:

| Action | Command |
|---|---|
| Create and select | `make project-new NAME=my-product` |
| Inspect selected project | `make project-status` |
| Publish to an existing remote | `make project-publish REMOTE_URL=<url> CONFIRM=PUBLISH` |

The gitignored `.auto-company.local` file stores `ACTIVE_PROJECT`. Creation never
adds a remote or pushes. Publishing requires a local commit, a clean worktree,
an explicit remote URL when `origin` is absent, and the exact confirmation token.

`registry.tsv` is framework metadata only; it does not make new product source part of this repository. Historical published-snapshot rows retain their original paths as provenance; they are not instructions to recreate or execute the old public folders.

## Existing tracked products

SnapOG predates this boundary and remains tracked so this change does not discard
an existing asset. Its removal from the framework index is a separate, explicit,
reviewable migration:

| Step | Command / check |
|---|---|
| Preconditions | Framework tracked worktree is clean; Git name/email are configured; no nested `.git` exists |
| Stage migration | `make project-migrate-legacy NAME=snapog CONFIRM=MIGRATE` |
| Verify product | `make project-status PROJECT=snapog` and inspect the local project commit |
| Verify framework | `git diff --cached --stat` shows staged untracking plus registry lifecycle change |
| Verify recovery | `.auto-company-migrations/snapog/project.bundle` exists locally |
| Roll back before framework commit | `make project-migrate-rollback NAME=snapog CONFIRM=ROLLBACK` |

The migration keeps working files in place, creates an independent local commit
and recovery bundle first, and never creates a remote or pushes. It does not
commit the framework-side untracking; a human must review and commit that change.
If framework HEAD has changed, use a Git revert together with the saved bundle
instead of the pre-commit rollback command.
