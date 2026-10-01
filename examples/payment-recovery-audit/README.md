# Payment Recovery Audit

A read-only local-fixture audit for founder-led Stripe SaaS. It reports current failed-invoice opportunity and observed net payments while keeping event identity, refunds, timestamps, and attribution evidence explicit.

This standalone example is a CLI, with no web interface or provider adapter. It requires Node.js 18 or newer, uses built-in Node modules only, and needs no dependency installation, account or API key. Its historical autonomous run completed three exploration cycles followed by three product cycles; see [SOURCE.md](SOURCE.md).

This validation artifact does not call Stripe, retry payments, store card data, move funds, or write output files. Amounts are integer minor currency units (`1250` means `$12.50` when `currency` is `USD`).

## Usage

```sh
npm run demo:audit
npm run audit -- fixtures/demo.json --pretty
npm test
```

Run these commands from this example's directory. `fixtures/demo.json` and `examples/fixture.json` are entirely synthetic; their invoice, payment, merchant-action and evidence IDs do not refer to real Stripe records. The demonstration includes four invoices, USD 200.00 of residual opportunity and USD 50.00 of fixture-observed net payment with complete attribution-shaped links. These are sample calculations, not collected revenue, proof of causality or an account balance.

For machine-readable JSON without npm's command banner, use `node bin/audit.js fixtures/demo.json --pretty`. To inspect another local redacted fixture, replace the filename; the CLI prints its result to stdout and does not save it automatically.

The historical human review worksheet for provider semantics is in [`docs/merchant-review-packet.md`](docs/merchant-review-packet.md). The redaction-safe intake template is in [`docs/merchant-evidence-bundle-template.md`](docs/merchant-evidence-bundle-template.md), with the original pending decision record in [`docs/merchant-evidence-decision.md`](docs/merchant-evidence-decision.md). No merchant-approved evidence bundle or provider validation is included. These historical worksheets do not prevent running the included synthetic demo; future provider work needs its own review.

The CLI emits JSON only. Sensitive or unknown fixture fields are not copied into the result.

## Fixture contract

Each invoice requires a unique `id`, a supported `status`, and a non-negative integer `amount`. Current `paid` and `void` snapshots take precedence over stale failure fields. A current `open`, `past_due`, or `failed` invoice is eligible for residual opportunity only when it has a valid `failed_at` timestamp and a positive amount.

All event, payment, and refund records require a stable ID, an ISO-8601 timestamp with timezone, and the fixture currency. Duplicate IDs are counted once and reported in `reason_codes`; semantically identical events with different IDs are also collapsed and reported. Events are sorted by timestamp, so input order does not affect the result.

Observed recovery must be represented by `payments`, not the legacy `recovered_amount` scalar. A payment has `id`, `amount`, `currency`, and `occurred_at`. A refund has `id`, `payment_id`, `amount`, `currency`, and `occurred_at`. Net recovery is the unique captured payment total minus unique linked refunds. Impossible currency or refund relationships are excluded from positive totals and surfaced as diagnostics.

Attribution is evidence-only. An `attributed` record must include a payment ID, merchant action ID and timestamp, baseline ID, evidence ID, a measurement window, and a payment that occurs after the action and within the window. Missing or contradictory links become `unknown`; the audit never infers causality from a populated label.

## Output interpretation

- `totals.residual_opportunity` is limited to current failed invoices with valid failure timestamps and no conflict.
- `totals.recovered_amount` is observed net payment value linked to a historical failure; it is not a causal or ROI claim.
- `totals.attributed_recovered_amount` includes only evidence-complete attribution records.
- `reason_codes` exposes missing timestamps, duplicate records, conflicts, invalid refunds, and incomplete attribution.
- `read_only: true` describes the product boundary; this CLI has no provider or filesystem mutation path.

Do not use this artifact to claim incremental revenue, ROI, or production readiness. A future provider read adapter must preserve the same fail-closed contract and pass least-privilege, redaction, retention, revocation, and late-refund restatement review before it is considered.
