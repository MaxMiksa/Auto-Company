# Merchant Evidence Bundle Template

Status: intake template only. Do not treat a completed template as a validation result.

Use this worksheet to prepare one bounded, merchant-approved, redacted evidence bundle for the provider-semantics gate. The bundle must be safe to review offline and must preserve joins without exposing customer or payment-method data.

## Safety rules

- Do not include API keys, webhook secrets, hosted URLs, customer names, email addresses, phone numbers, addresses, payment-method details, raw metadata, or card data.
- Replace provider identifiers with stable opaque IDs such as `acct_opaque_01`, `inv_opaque_01`, and `pay_opaque_01`. Use the same replacement everywhere so relationships and duplicate behavior remain testable.
- Do not invent missing fields. Use `unknown` or `not_available` and explain why.
- Keep the scope bounded to one merchant account or connected account, one live/test mode, one currency, and one explicit period.
- Record source coverage and freshness. An export with missing pages, failed reads, or an unknown data-as-of boundary is incomplete.
- Share the bundle only through the human-approved channel. This repository is not a credential store or a customer-data store.

## 1. Scope and approval

| Field | Value |
| --- | --- |
| Bundle reference | `[opaque bundle reference]` |
| Merchant reference | `[opaque merchant reference]` |
| Account/mode | `[opaque account] / [live or test]` |
| Currency | `[ISO-4217 code]` |
| Period start | `[UTC timestamp]` |
| Period end | `[UTC timestamp]` |
| Prepared by | `[merchant role or opaque reviewer reference]` |
| Approved for this review | `[yes/no]` |
| Approval date | `[UTC timestamp]` |
| Redaction checked by | `[opaque reviewer reference]` |

## 2. Source coverage manifest

Provide one row for every source extract, including sources that were unavailable.

| Source | Extract reference | Object/row count | Page or cursor coverage | Data as of | Retrieved at | Failed reads | Completeness |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| invoices | `[opaque ref]` | `[count]` | `[complete / pages listed]` | `[UTC timestamp or unknown]` | `[UTC timestamp]` | `[none or details]` | `[complete / partial / unknown]` |
| payments | `[opaque ref]` | `[count]` | `[complete / pages listed]` | `[UTC timestamp or unknown]` | `[UTC timestamp]` | `[none or details]` | `[complete / partial / unknown]` |
| refunds | `[opaque ref]` | `[count]` | `[complete / pages listed]` | `[UTC timestamp or unknown]` | `[UTC timestamp]` | `[none or details]` | `[complete / partial / unknown]` |
| disputes | `[opaque ref]` | `[count]` | `[complete / pages listed]` | `[UTC timestamp or unknown]` | `[UTC timestamp]` | `[none or details]` | `[complete / partial / unknown]` |
| merchant evidence | `[opaque ref]` | `[count]` | `[complete / not applicable]` | `[UTC timestamp or unknown]` | `[UTC timestamp]` | `[none or details]` | `[complete / partial / unknown]` |

## 3. Required normalized records

Submit records in JSON, CSV, or a clearly equivalent tabular format. Use integer minor currency units for amounts and ISO-8601 timestamps with timezone.

### Invoice records

Required columns:

```text
invoice_id, status, amount_due_minor, currency, failure_event_id,
failure_at, status_transition_ids, source_record_refs
```

### Payment linkage records

Required columns:

```text
allocation_id, invoice_id, canonical_payment_id, allocated_amount_minor,
currency, payment_intent_id, charge_id, balance_transaction_id,
payment_status, captured_or_settled_at, source_record_refs
```

Use one `canonical_payment_id` for one economic payment. Source object IDs may be listed as linked references; they must not create additional payment rows.

### Refund records

Required columns:

```text
refund_id, canonical_payment_id, amount_minor, currency, refund_status,
created_at, settled_at, source_record_refs
```

Retain enough lifecycle evidence to distinguish settled, pending, failed, repeated, partial, and late refunds.

### Dispute records

Required columns:

```text
dispute_id, canonical_payment_id, amount_minor, currency, dispute_status,
opened_at, resolved_at, outcome, source_record_refs
```

### Merchant evidence records

Required columns:

```text
merchant_action_id, action_at, baseline_id, baseline_definition,
evidence_id, measurement_window_start, measurement_window_end,
linked_payment_ids, approval_reference, source_record_refs
```

An action label or provider status is not causal evidence by itself. Include the cohort definition, denominator, non-overlap rule, and approval provenance for every baseline.

## 4. Review questions to answer

For each question, record the evidence reference, normalized expectation, and unresolved ambiguity.

| ID | Question | Evidence reference | Expected safe behavior | Ambiguity or gap |
| --- | --- | --- | --- | --- |
| R1 | Does a current paid/void state override stale failure history? | `[ref]` | No residual opportunity from stale failure | `[notes]` |
| R2 | Can one payment linked to several provider object types and invoices be allocated once? | `[ref]` | No double counting; allocation is explicit | `[notes]` |
| R3 | Are pagination, replay, and overlapping extracts complete and idempotent? | `[ref]` | Deterministic union; gaps are incomplete | `[notes]` |
| R4 | Are event arrival time and financial chronology separate? | `[ref]` | Reconciliation establishes current state | `[notes]` |
| R5 | Can partial, failed, pending, repeated, and late refunds be distinguished? | `[ref]` | Only policy-approved settled refunds reduce net value | `[notes]` |
| R6 | Can disputes restate a previously positive interpretation? | `[ref]` | Value is marked at risk or restated by policy | `[notes]` |
| R7 | Do authoritative IDs win over email, metadata, or labels? | `[ref]` | Ambiguous identity becomes unknown | `[notes]` |
| R8 | Does merchant evidence independently support the action, baseline, and window? | `[ref]` | No attribution from a label alone | `[notes]` |
| R9 | Is freshness bounded for every source? | `[ref]` | Absence outside the boundary is not evidence of absence | `[notes]` |
| R10 | Are missing pages, permissions, fields, and source tables visible? | `[ref]` | Incomplete input suppresses final claims | `[notes]` |

## 5. Bundle handoff checklist

- [ ] The merchant approved this bounded scope.
- [ ] All identifiers are opaque and joins still work.
- [ ] No credentials, secrets, URLs, customer contact data, payment-method data, or raw metadata are present.
- [ ] Amounts, currencies, and timestamps pass the stated format rules.
- [ ] Payment allocations identify one canonical economic payment.
- [ ] Refund and dispute lifecycles include enough evidence for later restatement.
- [ ] Source coverage, freshness, page/cursor history, and failed reads are included.
- [ ] Baseline contents, denominator, non-overlap rules, and approval provenance are included.
- [ ] The bundle is stored or transferred through a human-approved channel.
- [ ] The reviewer has copied the opaque bundle reference into `merchant-evidence-decision.md`.

## Safe handoff

When this checklist is complete, attach the redacted bundle through the human-approved channel and provide only its opaque reference in the repository. Do not paste raw records into an issue, commit, log, or chat message.
