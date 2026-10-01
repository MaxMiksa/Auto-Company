'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { auditFixture } = require('../src/audit');

const failureAt = '2026-09-01T00:00:00Z';

test('paid status wins over stale failure history and creates no opportunity', () => {
  const result = auditFixture({
    currency: 'USD',
    invoices: [{
      id: 'inv_paid',
      status: 'paid',
      amount: 10000,
      failed_at: failureAt,
      failure_code: 'card_declined'
    }]
  });

  assert.equal(result.failed_invoice_count, 0);
  assert.equal(result.totals.residual_opportunity, 0);
  assert.equal(result.totals.recovered_amount, 0);
  assert.equal(result.invoices[0].outcome, 'not_failed');
});

test('deduplicates events and nets unique refunds from a captured payment', () => {
  const result = auditFixture({
    currency: 'USD',
    invoices: [{
      id: 'inv_recovered',
      status: 'paid',
      amount: 10000,
      failed_at: failureAt,
      events: [
        { id: 'evt_failed', type: 'status', status: 'failed', occurred_at: failureAt },
        { id: 'evt_failed', type: 'status', status: 'failed', occurred_at: failureAt },
        { id: 'evt_paid', type: 'status', status: 'paid', occurred_at: '2026-09-02T00:00:00Z' },
        { id: 'evt_paid_copy', type: 'status', status: 'paid', occurred_at: '2026-09-02T00:00:00Z' }
      ],
      payments: [{ id: 'pay_1', amount: 10000, currency: 'USD', occurred_at: '2026-09-02T00:00:00Z' }],
      refunds: [
        { id: 'ref_1', payment_id: 'pay_1', amount: 2500, currency: 'USD', occurred_at: '2026-09-03T00:00:00Z' },
        { id: 'ref_1', payment_id: 'pay_1', amount: 2500, currency: 'USD', occurred_at: '2026-09-03T00:00:00Z' }
      ]
    }]
  });

  assert.equal(result.totals.recovered_amount, 7500);
  assert.equal(result.totals.residual_opportunity, 0);
  assert.deepEqual(result.invoices[0].event_ids, ['evt_failed', 'evt_paid']);
  assert.ok(result.invoices[0].reason_codes.includes('duplicate_event_id'));
  assert.ok(result.invoices[0].reason_codes.includes('duplicate_semantic_event'));
  assert.ok(result.invoices[0].reason_codes.includes('duplicate_refund_id'));
});

test('current failed invoice requires a valid failure timestamp before opportunity is counted', () => {
  const result = auditFixture({
    currency: 'USD',
    invoices: [{ id: 'inv_open', status: 'open', amount: 12000 }]
  });

  assert.equal(result.failed_invoice_count, 0);
  assert.equal(result.totals.failed_amount, 0);
  assert.equal(result.invoices[0].eligibility, 'excluded');
  assert.ok(result.invoices[0].reason_codes.includes('failure_timestamp_missing'));
});

test('attribution requires payment evidence, ordering, baseline, and review evidence', () => {
  const valid = auditFixture({
    currency: 'USD',
    invoices: [{
      id: 'inv_attributed',
      status: 'paid',
      amount: 5000,
      failed_at: failureAt,
      payments: [{ id: 'pay_1', amount: 5000, currency: 'USD', occurred_at: '2026-09-02T00:00:00Z' }],
      attribution: {
        status: 'attributed',
        amount: 5000,
        source: 'merchant_email',
        merchant_action_id: 'email_1',
        payment_id: 'pay_1',
        baseline_id: 'baseline_september',
        evidence_id: 'evidence_1',
        action_at: '2026-09-01T12:00:00Z',
        window_start: '2026-09-01T00:00:00Z',
        window_end: '2026-09-30T23:59:59Z'
      }
    }]
  });
  assert.equal(valid.totals.attributed_recovered_amount, 5000);
  assert.equal(valid.invoices[0].attribution_status, 'attributed');

  const unsupported = auditFixture({
    currency: 'USD',
    invoices: [{
      id: 'inv_unsupported',
      status: 'paid',
      amount: 5000,
      failed_at: failureAt,
      payments: [{ id: 'pay_1', amount: 5000, currency: 'USD', occurred_at: '2026-09-02T00:00:00Z' }],
      attribution: { status: 'attributed', amount: 5000, source: 'email', merchant_action_id: 'email_1' }
    }]
  });
  assert.equal(unsupported.invoices[0].attribution_status, 'unknown');
  assert.equal(unsupported.totals.attributed_recovered_amount, 0);
  assert.ok(unsupported.invoices[0].reason_codes.includes('attribution_evidence_incomplete'));
});

test('rejects malformed timestamps, invalid amounts, and keeps sensitive fields out of output', () => {
  assert.throws(
    () => auditFixture({
      currency: 'USD',
      invoices: [{
        id: 'inv_bad_time', status: 'paid', amount: 100,
        payments: [{ id: 'pay_1', amount: 100, currency: 'USD', occurred_at: 'not-a-timestamp' }]
      }]
    }),
    /occurred_at.*ISO-8601 timestamp/
  );
  assert.throws(
    () => auditFixture({ currency: 'USD', invoices: [{ id: 'inv_negative', status: 'open', amount: -1, failed_at: failureAt }] }),
    /amount.*non-negative/
  );

  const result = auditFixture({
    currency: 'USD',
    invoices: [{ id: 'inv_redacted', status: 'open', amount: 100, failed_at: failureAt, card_number: '4111111111111111', customer_email: 'founder@example.com' }]
  });
  assert.equal(JSON.stringify(result).includes('4111111111111111'), false);
  assert.equal(JSON.stringify(result).includes('founder@example.com'), false);
});
