# Engine adapters

[English](ENGINE_ADAPTERS.md) | [中文](i18n/zh-CN/ENGINE_ADAPTERS.md) · [Documentation and language settings](i18n/README.md)

Run the commands below from the repository root.

`scripts/core/auto-loop.sh` owns scheduling and loop policy. `scripts/core/engine-adapters.sh` owns engine discovery, invocation shape, and secret redaction; `engine-metadata.py` normalizes provider JSON and JSONL with the Python standard library. `scripts/core/process-supervisor.sh` owns the per-cycle PGID, timeout, descendant cleanup, and fail-closed cleanup verification used by every adapter.

Claude remains the default. Cursor and OpenAI-compatible support are opt-in so an existing installation does not change behavior after an upgrade.

**Execution now requires project isolation.** Every model cycle and interactive team enters the same Linux/WSL2 namespace boundary; product checks and screenshot subprocesses also use it. Missing bubblewrap/libseccomp/kernel capabilities fail closed. Native Windows/macOS and unverified Cursor packaging are refused. See [setup, visible inputs, network policy and recovery](docs/project-isolation.md). The engine-specific options below are additional policies inside this boundary, not substitutes for it. Host-local/private endpoints remain inaccessible even when an adapter transport setting allows HTTP.

## Selection and safety

| Engine | Required opt-in/config | Default safety posture |
| --- | --- | --- |
| `claude` | None | An explicit permission mode is validated before startup. `default` is the safer documented first-run override. |
| `codex` | `ENGINE=codex` | The selected inner sandbox policy is preserved inside mandatory OS isolation. Global plugins, MCP configuration and history are absent. |
| `cursor` | `ENGINE=cursor`, `CURSOR_ADAPTER_ENABLED=1` | Currently refused: isolated packaging/authentication is not verified. No host execution fallback. |
| `openai-compatible` | `ENGINE=openai-compatible`, `OPENAI_COMPATIBLE_ADAPTER_ENABLED=1`, exact `OPENAI_COMPATIBLE_ENDPOINT`, and `OPENAI_COMPATIBLE_MODEL` (or `MODEL`) | HTTPS and loopback HTTP are accepted. Non-loopback HTTP is blocked unless `OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP=1`. Built-in file tools resolve paths before access, stay inside the project directory, and reject Git metadata and known credential paths. Commands use exact argv allowlisting without a shell. Arbitrary bash is absent unless `OPENAI_COMPATIBLE_ALLOW_SHELL=1`. |

Claude permission modes accepted by the adapter match the current CLI contract: `acceptEdits`, `auto`, `bypassPermissions`, `default`, `dontAsk`, and `plan`. An empty value leaves selection to the CLI. Any other explicit value fails adapter validation before the loop or daemon starts.

No endpoint, model, or API key has a built-in value. `OPENAI_COMPATIBLE_API_KEY` is read only from the process environment and is sent as a bearer token when present. Do not place API keys in `.auto-loop.env`, launchd plist files, command arguments, or repository files.

The OpenAI-compatible transport policy is checked during adapter validation and again in the Python request boundary, including direct invocation. HTTPS endpoints are accepted. Plain HTTP is accepted only for loopback hosts (`localhost`, `127.0.0.0/8`, and `[::1]`) unless `OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP=1` is explicitly set. Loopback requests bypass inherited proxy settings so they cannot leave the host through a proxy. The exception is disabled by default and exposes prompts, tool results, and any Bearer key to plaintext transport; use it only for an operator-trusted endpoint on an isolated network. Redirects remain forbidden by the request implementation.

On WSL/Linux, adapter validation failures exit with configuration status `78`; the generated systemd user unit treats that status as non-restartable, so an invalid value does not become a daemon restart loop.

Examples (all values are operator supplied):

```bash
ENGINE=cursor \
CURSOR_ADAPTER_ENABLED=1 \
CURSOR_BIN=/path/to/cursor-agent \
make start

ENGINE=openai-compatible \
OPENAI_COMPATIBLE_ADAPTER_ENABLED=1 \
OPENAI_COMPATIBLE_ENDPOINT="$YOUR_CHAT_COMPLETIONS_ENDPOINT" \
OPENAI_COMPATIBLE_MODEL="$YOUR_MODEL" \
make start

# Exceptional use on an operator-trusted isolated network only:
ENGINE=openai-compatible \
OPENAI_COMPATIBLE_ADAPTER_ENABLED=1 \
OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP=1 \
OPENAI_COMPATIBLE_ENDPOINT="$YOUR_TRUSTED_HTTP_ENDPOINT" \
OPENAI_COMPATIBLE_MODEL="$YOUR_MODEL" \
make start
```

The OpenAI-compatible safe commands default to exact, read-only argv sequences for short Git status, diff statistics, recent log, repository-root discovery, and `rg --files`. Override the comma-separated `OPENAI_COMPATIBLE_SAFE_COMMANDS` only after reviewing each complete command. Extra trailing arguments are not accepted.

Safe commands cannot resolve to executables inside the writable workspace. Git invocations disable filesystem-monitor hooks, pagers, and signature display, and remove inherited Git configuration overrides. Ripgrep ignores inherited configuration. These restrictions prevent repository configuration or a model-written executable from turning a built-in read-only command into arbitrary execution; operator-added commands still require review.

### Built-in file-tool boundary

The OpenAI-compatible adapter applies the same path check to its built-in `read_file` and `write_file` tools. Paths are resolved before access, so `..` traversal, paths outside the project, symlinks to outside targets, and symlink aliases to protected targets are rejected. Matching is case-insensitive and covers:

- Git metadata directories named `.git`;
- live dotenv files (standard `.example`, `.sample`, and `.template` variants remain readable);
- package and source-control authentication files such as `.npmrc`, `.pypirc`, `.netrc`, and `.git-credentials`;
- private key and certificate-bundle extensions `.key`, `.pem`, `.p12`, and `.pfx`;
- conventional SSH, AWS, Azure, Google Cloud, Kubernetes, Docker, GitHub CLI, GitLab CLI, and Terraform credential locations.

Rejected file-tool errors do not include the requested path or file contents. This is a conservative, path-based guard, not content-aware secret detection or an operating-system sandbox. Renamed or hard-linked credentials cannot be recognized from content, and operator-added commands can expose files. Enabling `OPENAI_COMPATIBLE_ALLOW_SHELL=1` gives the model an arbitrary Bash tool that is not constrained by this file-tool path policy. Continue to use a disposable, secret-free clone and review every custom safe command.

## Per-cycle contract

Each `logs/cycle-<id>.log` has a sibling `logs/cycle-<id>.json` record:

| Field | Type | Meaning |
| --- | --- | --- |
| `schema_version` | integer | Contract version; currently `1`. |
| `engine` | string | Selected adapter name. |
| `status` | string | Adapter execution: `success`, `error`, or `timeout`. |
| `cycle_outcome` | string | Loop decision: `success`, `failure`, or `soft_timeout`. |
| `failure_reason` | string | Loop-level rejection reason, empty when accepted. |
| `result` | string | Redacted provider result, bounded to 2,000 bytes. |
| `cost_usd` | number or null | Provider-reported cost; never estimated by the adapter. |
| `input_tokens` | integer or null | Provider-reported input/prompt tokens. |
| `output_tokens` | integer or null | Provider-reported output/completion tokens. |
| `total_tokens` | integer or null | Provider total, or input plus output when both are available. |
| `subtype` | string | Provider subtype with a normalized fallback. |
| `type` | string | Provider event type with an engine fallback. |
| `exit_code` | integer | Process exit code; supervisor timeout is `124`. |
| `timed_out` | boolean | Whether the common PGID supervisor timed out the cycle. |

Unknown numeric values are JSON `null`, not strings such as `"N/A"`. This sidecar is the only engine metadata input to structured usage, budgets, and `/api/usage`; those consumers do not parse provider output. The raw cycle log is also redacted before it is written.

Codex uses `exec --json` and reads the `turn.completed.usage` object; human-readable `tokens used` text is not an accounting source. Input and output tokens are recorded separately, cached input is not counted twice, and absent USD cost remains unknown. This matches the [official Codex JSONL contract](https://learn.chatgpt.com/docs/non-interactive-mode#make-output-machine-readable). Claude includes reported cache-read and cache-creation input buckets in its input total. Multiple OpenAI-compatible requests contribute to a cycle total only when every request supplies that metric; a missing metric stays unknown. Usage already reported when the local tool-turn limit is reached is retained, while a failed HTTP request makes the affected cycle totals unknown.

Provider `is_error`, error subtypes, and Codex `turn.failed` events cause a failed Cycle even if the process exits zero. Nonzero process exit and supervisor timeout take precedence over provider success. Missing or malformed structured metadata is an adapter error. The loop still applies its existing consensus-based soft-timeout policy separately.

## Verification without real providers

The contract suite uses fake CLI executables and a local fake HTTP server; it does not call Claude, Codex, Cursor, or an external model:

```bash
python3 -m unittest -v tests.test_engine_adapters
```

The tests cover Claude/Codex arguments, Cursor sandbox policy, normalized usage, workspace confinement, safe-command/shell policy, HTTP redirects and errors, PGID-supervised timeout, API-key redaction, and actual fake-provider loop outcomes. `tests/test_process_supervisor.sh` separately verifies descendant cleanup, orphan cleanup, signal handling, and unrelated-process isolation.
