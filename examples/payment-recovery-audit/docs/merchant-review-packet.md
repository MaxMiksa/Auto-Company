# Merchant Review Packet: Provider-Semantics Gate

Status: prepared for human review. This packet is a review worksheet, not a validation result and not a production integration plan.

## Decision requested

Review one redacted, merchant-approved evidence bundle and decide whether the project may build a bounded contract-v3 fixture/fake-adapter harness. Do not approve a live provider adapter, recovery claim, ROI claim, or causal attribution claim from this packet alone.

The current safe product language is:

- “observed net payment in a local fixture”;
- “evidence-shaped attribution”;
- “residual opportunity in a bounded, complete input.”

Do not use “recovered revenue,” “incremental lift,” “ROI,” or “production-ready.”

## What the reviewer must provide

The evidence bundle should be redacted before it enters this project and should contain, for one bounded period:

| Bundle item | Required evidence | Pass condition |
| --- | --- | --- |
| Account scope | Opaque merchant reference, live/test mode, currency, requested period | Every row can be assigned to exactly one account and mode |
| Invoice export | Invoice IDs, status, amount due, failure evidence, status transitions | Current paid/void state can be separated from stale failure history |
| Payment linkage | Invoice-payment allocation plus PaymentIntent/Charge IDs where available | One economic payment is not counted once per object type |
| Refund history | Refund ID, linked payment, amount, currency, status, observed time | Partial, repeated, pending, failed, and late refunds are distinguishable |
| Dispute history | Dispute ID, linked charge/payment, amount, status and lifecycle evidence | Disputed value is not presented as durable recovery without review |
| Export coverage | Page/cursor log, data-as-of or equivalent completeness marker, failed reads | Missing pages, permissions, and freshness gaps become incomplete/unknown |
| Merchant evidence | Action ID/time, baseline definition, evidence ID, measurement window | Attribution is independently reviewable and does not rely on Stripe labels |

No API keys, webhook secrets, customer contact data, payment-method data, hosted URLs, or raw metadata should be included. IDs may be replaced with stable opaque IDs, but the replacement must preserve joins and duplicate behavior.

## Exploratory review matrix

Run these as question-led sessions. Record the raw evidence reference, the normalized expectation, and any ambiguity. A clean-looking total is not a pass if the source cannot prove completeness or identity.

| ID | Perturbation or question | Expected safe behavior | Evidence to retain |
| --- | --- | --- | --- |
| R1 | A paid invoice still has a historical failure event | Paid state wins; no residual opportunity is created | Invoice snapshot, failure event, payment evidence |
| R2 | The same payment appears as invoice payment, PaymentIntent, Charge, and balance movement | One canonical payment row with linked source IDs; no double counting | Object IDs and allocation relationship |
| R3 | The export is paginated, replayed, or overlaps a date range | Complete union is deterministic and idempotent; page gaps are incomplete | Cursor/page log and object-ID comparison |
| R4 | Webhook events arrive duplicated, out of order, or after a retry delay | Event arrival order is not treated as financial chronology; current objects are reconciled | Event IDs, object IDs, event mode/version, retrieval time |
| R5 | A payment receives a partial, pending, failed, or late refund | Only settled, uniquely linked refunds reduce net value; prior reports can be restated | Refund lifecycle and before/after totals |
| R6 | A recovered payment later has a dispute, lost dispute, or funds reinstatement | Amount is marked at risk or restated according to documented policy | Dispute lifecycle and linked charge/payment |
| R7 | Customer email/metadata suggests a match but authoritative IDs disagree or are absent | Ambiguous identity is unknown; it cannot create positive attribution | Competing identifiers and match decision |
| R8 | A merchant supplies an action label after payment with no independent baseline | No attributed value; action-after-payment correlation is insufficient | Action record, baseline contents, evidence and window |
| R9 | Report/warehouse data is newer or older than the requested period | Freshness boundary is visible; absence outside the boundary is not evidence of absence | Data-as-of, next sync/report availability, source type |
| R10 | A required permission, page, field, or source table is unavailable | Run is incomplete/review-required and suppresses final aggregate claims | Safe error class, affected scope, completeness state |

## Stop gates

All seven gates must be evidenced before considering any provider adapter or validation statement:

1. A merchant-approved, redacted bundle reconciles row-by-row to source evidence.
2. Payment allocation prevents invoice/PaymentIntent/Charge/balance-transaction double counting, including one payment linked to multiple invoices.
3. Refund and dispute lifecycles have an explicit before/after restatement policy.
4. Identity matching has authoritative keys, collision behavior, and a documented unknown state.
5. The baseline includes cohort contents, denominator, non-overlap rules, and approval provenance; an ID alone is not enough.
6. Pagination, replay, shuffled input, duplicate IDs, malformed records, missing permissions, and stale data remain deterministic and fail closed.
7. Redaction, read-only boundaries, and claim suppression are checked over input, output, diagnostics, and logs.

If any gate is unanswered, the decision is **NO-GO for a live adapter**. The allowed next step is to add a local contract-v3/fake-provider harness that makes the gap executable without network access or credentials.

## Mapping decisions to confirm

The reviewer should explicitly confirm these choices rather than allowing an adapter to infer them:

- The canonical payment amount is captured/settled payment evidence, not an intended PaymentIntent amount.
- Refunds are first-class records keyed by refund ID and linked payment; refund status determines whether they affect settled net value.
- Dispute amounts and lifecycle are separate from refund netting and can invalidate a previously positive interpretation.
- Webhooks accelerate discovery but do not define order or completeness; object reads and bounded reconciliation establish current state.
- Reports/warehouse exports carry source type, source version, account/mode, observation time, and data-as-of/freshness metadata.
- Stripe object IDs and explicit relationships are the primary identity bridge. Email, mutable metadata, and labels are supporting evidence only.
- Stripe data cannot supply `baseline_id`, `merchant_action_id`, or `evidence_id` as causal proof; those must come from a merchant-owned evidence source.

## Review record

Complete this section after examining the bundle:

| Field | Decision |
| --- | --- |
| Bundle reference | `[opaque reference]` |
| Period and account/mode | `[bounded scope]` |
| Completeness evidence | `[complete / partial / unknown + why]` |
| Highest-risk ambiguity | `[one sentence]` |
| Gates passed | `[IDs]` |
| Gates unresolved | `[IDs]` |
| Decision | `NO-GO / GO for contract-v3 harness only / GO for bounded exploratory adapter` |
| Reviewer notes | `[evidence links and follow-up]` |

## Next artifact after approval

Only after this review is recorded, build the smallest local artifact:

```text
fixture adapter + fake provider adapter
              -> normalized contract-v3 envelope
              -> existing read-only audit core
              -> redacted result with provenance and coverage state
```

That harness should include a complete fixture, a partial-coverage fixture, payment/refund/dispute lifecycle cases, identity collisions, redaction checks, and a negative read-only boundary test. It must not add Stripe network access, credentials, persistence, webhooks, background workers, payment actions, or customer messaging.

## Primary-source background

The following background references are retained from the original review worksheet; the original private research history is not included in this standalone snapshot. They cover Stripe documentation for [invoice payments](https://docs.stripe.com/api/invoice-payment), [PaymentIntents](https://docs.stripe.com/api/payment_intents), [refunds](https://docs.stripe.com/api/refunds/object), [disputes](https://docs.stripe.com/api/disputes/object), [webhook delivery](https://docs.stripe.com/webhooks), [Reports API](https://docs.stripe.com/reports/api), and [Data Pipeline freshness](https://docs.stripe.com/data/data-pipeline/data-freshness). This local CLI does not implement these APIs, and packaging the worksheet does not revalidate their current semantics.
