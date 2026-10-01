# Merchant Evidence Decision Record

Status: `PENDING HUMAN REVIEW`

This record must remain pending until a merchant-approved, redacted evidence bundle has been reviewed against [`merchant-review-packet.md`](merchant-review-packet.md) and [`merchant-evidence-bundle-template.md`](merchant-evidence-bundle-template.md). A missing bundle is not a GO, a NO-GO, or a validation result.

## Review record

| Field | Decision |
| --- | --- |
| Bundle reference | `[opaque reference; leave pending if absent]` |
| Period and account/mode | `[bounded scope or pending]` |
| Completeness evidence | `[complete / partial / unknown / pending]` |
| Highest-risk ambiguity | `[one sentence or pending]` |
| Gates passed | `[none recorded until review]` |
| Gates unresolved | `[all seven until review]` |
| Decision | `PENDING HUMAN REVIEW` |
| Reviewer | `[merchant-approved reviewer or pending]` |
| Review date | `[UTC timestamp or pending]` |
| Reviewer notes | `[evidence references and follow-up, without raw sensitive data]` |

## Decision policy

- `NO-GO`: the bundle is insufficient or any stop gate remains unanswered. The next safe step is to request a narrower or better-redacted bundle; no provider adapter is unlocked.
- `GO for contract-v3 harness only`: the bundle is useful enough to encode local fixtures and fake-provider behavior, but does not support a live adapter or validation claim.
- `GO for bounded exploratory adapter`: only permitted if the review packet's gates are evidenced and the adapter remains read-only, least-privilege, redacted, revocable, and explicitly incomplete when coverage is uncertain.

## Current disposition

No merchant-approved bundle is present in the workspace as of this cycle. The only permitted next action is to obtain the bundle through a human-approved channel and complete this record. The local contract-v3 fixture/fake-provider harness remains locked.
