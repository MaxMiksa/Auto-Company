'use strict';

const ELIGIBLE_FAILURE_STATUSES = new Set(['open', 'past_due', 'failed']);
const ALL_STATUSES = new Set(['draft', 'open', 'past_due', 'paid', 'uncollectible', 'void', 'failed']);
const RECOVERY_STATUSES = new Set(['not_attempted', 'in_progress', 'recovered', 'failed', 'unknown']);
const ATTRIBUTION_STATUSES = new Set(['attributed', 'unattributed', 'pending', 'not_applicable', 'unknown', 'invalidated']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(path, message) {
  throw new Error(`Invalid fixture: ${path} ${message}`);
}

function requiredString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') invalid(path, 'must be a non-empty string');
  return value.trim();
}

function optionalString(value, path) {
  if (value === undefined || value === null) return null;
  return requiredString(value, path);
}

function nonNegativeInteger(value, path, defaultValue = undefined) {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || value < 0) invalid(path, 'must be a non-negative safe integer in minor currency units');
  return value;
}

function positiveInteger(value, path) {
  const amount = nonNegativeInteger(value, path);
  if (amount === 0) invalid(path, 'must be greater than zero');
  return amount;
}

function parseTimestamp(value, path, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) invalid(path, 'must be an ISO-8601 timestamp with timezone');
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    invalid(path, 'must be an ISO-8601 timestamp with timezone');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) invalid(path, 'must be a valid timestamp');
  return new Date(parsed).toISOString();
}

function roundPercent(numerator, denominator) {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function addReason(reasons, code) {
  if (!reasons.includes(code)) reasons.push(code);
}

function normalizeStatus(value) {
  return typeof value === 'string' && ALL_STATUSES.has(value.toLowerCase()) ? value.toLowerCase() : 'unknown';
}

function normalizeEvents(rawEvents, invoiceId, currency, path, reasons) {
  if (rawEvents === undefined) return [];
  if (!Array.isArray(rawEvents)) invalid(path, 'must be an array');
  const seenIds = new Set();
  const seenSemantics = new Set();
  const events = [];
  for (let index = 0; index < rawEvents.length; index += 1) {
    const raw = rawEvents[index];
    if (!isRecord(raw)) invalid(`${path}[${index}]`, 'must be an object');
    const id = requiredString(raw.id, `${path}[${index}].id`);
    const eventInvoiceId = optionalString(raw.invoice_id, `${path}[${index}].invoice_id`) ?? invoiceId;
    if (eventInvoiceId !== invoiceId) continue;
    const type = requiredString(raw.type, `${path}[${index}].type`).toLowerCase();
    const occurredAt = parseTimestamp(raw.occurred_at, `${path}[${index}].occurred_at`, true);
    const status = raw.status === undefined ? null : normalizeStatus(raw.status);
    if (raw.status !== undefined && status === 'unknown') addReason(reasons, 'unknown_event_status');
    const eventCurrency = (optionalString(raw.currency, `${path}[${index}].currency`) ?? currency).toUpperCase();
    if (eventCurrency !== currency) addReason(reasons, 'currency_mismatch');
    const semantic = JSON.stringify({ type, status, occurredAt, amount: raw.amount ?? null, currency: eventCurrency });
    if (seenIds.has(id)) {
      addReason(reasons, 'duplicate_event_id');
      continue;
    }
    seenIds.add(id);
    if (seenSemantics.has(semantic)) {
      addReason(reasons, 'duplicate_semantic_event');
      continue;
    }
    seenSemantics.add(semantic);
    events.push({ id, type, status, occurred_at: occurredAt, currency: eventCurrency });
  }
  return events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));
}

function normalizePayments(rawPayments, currency, path, reasons) {
  if (rawPayments === undefined) return [];
  if (!Array.isArray(rawPayments)) invalid(path, 'must be an array');
  const seenIds = new Set();
  return rawPayments.flatMap((raw, index) => {
    if (!isRecord(raw)) invalid(`${path}[${index}]`, 'must be an object');
    const id = requiredString(raw.id, `${path}[${index}].id`);
    if (seenIds.has(id)) {
      addReason(reasons, 'duplicate_payment_id');
      return [];
    }
    seenIds.add(id);
    const amount = positiveInteger(raw.amount, `${path}[${index}].amount`);
    const paymentCurrency = requiredString(raw.currency, `${path}[${index}].currency`).toUpperCase();
    const occurredAt = parseTimestamp(raw.occurred_at, `${path}[${index}].occurred_at`, true);
    if (paymentCurrency !== currency) addReason(reasons, 'currency_mismatch');
    return [{ id, amount, currency: paymentCurrency, occurred_at: occurredAt }];
  });
}

function normalizeRefunds(rawRefunds, payments, currency, path, reasons) {
  if (rawRefunds === undefined) return [];
  if (!Array.isArray(rawRefunds)) invalid(path, 'must be an array');
  const paymentIds = new Set(payments.map((payment) => payment.id));
  const seenIds = new Set();
  const seenSemantics = new Set();
  return rawRefunds.flatMap((raw, index) => {
    if (!isRecord(raw)) invalid(`${path}[${index}]`, 'must be an object');
    const id = requiredString(raw.id, `${path}[${index}].id`);
    if (seenIds.has(id)) {
      addReason(reasons, 'duplicate_refund_id');
      return [];
    }
    seenIds.add(id);
    const paymentId = requiredString(raw.payment_id, `${path}[${index}].payment_id`);
    const amount = positiveInteger(raw.amount, `${path}[${index}].amount`);
    const refundCurrency = requiredString(raw.currency, `${path}[${index}].currency`).toUpperCase();
    const occurredAt = parseTimestamp(raw.occurred_at, `${path}[${index}].occurred_at`, true);
    if (!paymentIds.has(paymentId)) addReason(reasons, 'refund_payment_missing');
    if (refundCurrency !== currency) addReason(reasons, 'currency_mismatch');
    const semantic = JSON.stringify({ paymentId, amount, currency: refundCurrency, occurredAt });
    if (seenSemantics.has(semantic)) {
      addReason(reasons, 'duplicate_semantic_refund');
      return [];
    }
    seenSemantics.add(semantic);
    return [{ id, payment_id: paymentId, amount, currency: refundCurrency, occurred_at: occurredAt }];
  });
}

function calculateNetRecovery(payments, refunds, currency, reasons) {
  let net = 0;
  const refundTotals = new Map();
  for (const refund of refunds) {
    if (refund.currency === currency && payments.some((payment) => payment.id === refund.payment_id)) {
      refundTotals.set(refund.payment_id, (refundTotals.get(refund.payment_id) ?? 0) + refund.amount);
    }
  }
  for (const payment of payments) {
    if (payment.currency !== currency) continue;
    const refundAmount = refundTotals.get(payment.id) ?? 0;
    if (refundAmount > payment.amount) {
      addReason(reasons, 'refund_exceeds_payment');
      continue;
    }
    net += payment.amount - refundAmount;
  }
  return net;
}

function normalizeAttribution(raw, context, path, reasons) {
  if (raw !== undefined && !isRecord(raw)) invalid(path, 'must be an object');
  const provided = raw ?? {};
  const requestedStatus = provided.status ?? (context.netRecovered > 0 ? 'unattributed' : 'not_applicable');
  const status = typeof requestedStatus === 'string' ? requestedStatus.toLowerCase() : 'unknown';
  if (!ATTRIBUTION_STATUSES.has(status)) addReason(reasons, 'unknown_attribution_status');
  const amount = nonNegativeInteger(provided.amount, `${path}.amount`, 0);
  const source = optionalString(provided.source, `${path}.source`);
  const merchantActionId = optionalString(provided.merchant_action_id, `${path}.merchant_action_id`);
  const paymentId = optionalString(provided.payment_id, `${path}.payment_id`);
  const baselineId = optionalString(provided.baseline_id, `${path}.baseline_id`);
  const evidenceId = optionalString(provided.evidence_id, `${path}.evidence_id`);
  const actionAt = parseTimestamp(provided.action_at, `${path}.action_at`);
  const windowStart = parseTimestamp(provided.window_start, `${path}.window_start`);
  const windowEnd = parseTimestamp(provided.window_end, `${path}.window_end`);
  let finalStatus = ATTRIBUTION_STATUSES.has(status) ? status : 'unknown';
  if (status === 'attributed') {
    const payment = context.payments.find((item) => item.id === paymentId);
    const missing = !source || !merchantActionId || !paymentId || !baselineId || !evidenceId || !actionAt || !windowStart || !windowEnd;
    if (missing) addReason(reasons, 'attribution_evidence_incomplete');
    if (!payment) addReason(reasons, 'attribution_payment_missing');
    if (payment && actionAt && actionAt >= payment.occurred_at) addReason(reasons, 'attribution_action_not_before_payment');
    if (windowStart && windowEnd && windowStart >= windowEnd) addReason(reasons, 'attribution_window_invalid');
    if (payment && windowEnd && payment.occurred_at > windowEnd) addReason(reasons, 'payment_outside_attribution_window');
    if (amount === 0 || amount > context.netRecovered) addReason(reasons, 'attribution_amount_invalid');
    if (reasons.some((reason) => reason.startsWith('attribution_') || reason === 'payment_outside_attribution_window')) finalStatus = 'unknown';
  }
  if (finalStatus !== 'attributed' && amount !== 0) addReason(reasons, 'unattributed_amount_ignored');
  return {
    attribution_status: finalStatus,
    attributed_amount: finalStatus === 'attributed' ? amount : 0,
    attribution_source: source,
    attributed_at: actionAt,
    merchant_action_id: merchantActionId,
    attribution_payment_id: paymentId,
    attribution_baseline_id: baselineId,
    attribution_evidence_id: evidenceId,
    attribution_window_start: windowStart,
    attribution_window_end: windowEnd
  };
}

function classifyOutcome({ historicalFailed, status, amount, eligibleFailure, netRecovered, recoveryStatus, hasConflict }) {
  if (hasConflict) return 'unknown';
  if (!historicalFailed) return 'not_failed';
  if (status === 'void' || status === 'draft' || status === 'uncollectible') return 'excluded';
  if (netRecovered > 0 && netRecovered < amount) return 'partially_recovered';
  if (netRecovered > 0) return 'recovered';
  if (eligibleFailure && recoveryStatus === 'in_progress') return 'in_progress';
  if (eligibleFailure && recoveryStatus === 'failed') return 'unrecovered';
  if (eligibleFailure) return 'not_attempted';
  return 'not_failed';
}

function auditFixture(fixture) {
  if (!isRecord(fixture)) invalid('root', 'must be a JSON object');
  const currency = requiredString(fixture.currency, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) invalid('currency', 'must be a three-letter ISO currency code');
  if (!Array.isArray(fixture.invoices)) invalid('invoices', 'must be an array');
  if (fixture.events !== undefined && !Array.isArray(fixture.events)) invalid('events', 'must be an array');

  const seenInvoiceIds = new Set();
  const outcomes = { not_failed: 0, not_attempted: 0, in_progress: 0, unrecovered: 0, partially_recovered: 0, recovered: 0, excluded: 0, unknown: 0 };
  let failedAmount = 0;
  let recoveredAmount = 0;
  let residualOpportunity = 0;
  let attributedRecoveredAmount = 0;
  let unknownRecordCount = 0;

  const invoices = fixture.invoices.map((rawInvoice, index) => {
    if (!isRecord(rawInvoice)) invalid(`invoices[${index}]`, 'must be an object');
    const id = requiredString(rawInvoice.id, `invoices[${index}].id`);
    if (seenInvoiceIds.has(id)) invalid(`invoices[${index}].id`, `duplicates invoice id ${id}`);
    seenInvoiceIds.add(id);
    const amount = nonNegativeInteger(rawInvoice.amount, `invoices[${index}].amount`);
    const reasons = [];
    const declaredStatus = normalizeStatus(rawInvoice.status);
    if (declaredStatus === 'unknown') addReason(reasons, 'unknown_invoice_status');
    const failureAt = parseTimestamp(rawInvoice.failed_at, `invoices[${index}].failed_at`);
    const invoiceEvents = normalizeEvents(rawInvoice.events, id, currency, `invoices[${index}].events`, reasons);
    const rootEvents = normalizeEvents(fixture.events?.filter((event) => event.invoice_id === id), id, currency, 'events', reasons);
    const mergedEvents = [...invoiceEvents, ...rootEvents];
    const seenEventIds = new Set();
    const seenEventSemantics = new Set();
    const events = mergedEvents.filter((event) => {
      const semantic = JSON.stringify({ type: event.type, status: event.status, occurred_at: event.occurred_at, currency: event.currency });
      if (seenEventIds.has(event.id)) {
        addReason(reasons, 'duplicate_event_id');
        return false;
      }
      seenEventIds.add(event.id);
      if (seenEventSemantics.has(semantic)) {
        addReason(reasons, 'duplicate_semantic_event');
        return false;
      }
      seenEventSemantics.add(semantic);
      return true;
    }).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));
    const statusEvents = events.filter((event) => event.type === 'status' && event.status);
    const latestStatus = statusEvents.at(-1)?.status ?? null;
    const sameTimeStatuses = statusEvents.filter((event) => event.occurred_at === statusEvents.at(-1)?.occurred_at);
    if (sameTimeStatuses.length > 1 && new Set(sameTimeStatuses.map((event) => event.status)).size > 1) addReason(reasons, 'conflicting_status_events');
    if (latestStatus && latestStatus !== declaredStatus && !['paid', 'void'].includes(declaredStatus)) addReason(reasons, 'status_snapshot_conflict');
    const status = declaredStatus === 'paid' || declaredStatus === 'void' ? declaredStatus : (reasons.includes('status_snapshot_conflict') ? 'unknown' : declaredStatus);
    const historicalFailed = ELIGIBLE_FAILURE_STATUSES.has(declaredStatus)
      || (typeof rawInvoice.failure_code === 'string' && rawInvoice.failure_code.trim() !== '')
      || Boolean(failureAt)
      || statusEvents.some((event) => ELIGIBLE_FAILURE_STATUSES.has(event.status));
    const payments = normalizePayments(rawInvoice.payments, currency, `invoices[${index}].payments`, reasons);
    const refunds = normalizeRefunds(rawInvoice.refunds, payments, currency, `invoices[${index}].refunds`, reasons);
    const netRecovered = calculateNetRecovery(payments, refunds, currency, reasons);
    if (rawInvoice.recovered_amount !== undefined) addReason(reasons, 'legacy_recovered_amount_ignored');
    const recoveryStatus = rawInvoice.recovery_status ?? (netRecovered > 0 ? 'recovered' : 'not_attempted');
    if (!RECOVERY_STATUSES.has(recoveryStatus)) addReason(reasons, 'unknown_recovery_status');
    if (netRecovered > 0 && status !== 'paid') addReason(reasons, 'payment_status_conflict');
    const hasConflict = reasons.some((reason) => ['unknown_invoice_status', 'status_snapshot_conflict', 'conflicting_status_events', 'payment_status_conflict', 'currency_mismatch', 'refund_exceeds_payment', 'refund_payment_missing', 'unknown_recovery_status'].includes(reason));
    const eligibleFailure = status !== 'unknown' && ELIGIBLE_FAILURE_STATUSES.has(status) && amount > 0 && Boolean(failureAt);
    if (ELIGIBLE_FAILURE_STATUSES.has(status) && !failureAt) addReason(reasons, 'failure_timestamp_missing');
    if (status === 'uncollectible') addReason(reasons, 'status_not_eligible');
    const attribution = normalizeAttribution(rawInvoice.attribution, { netRecovered, payments }, `invoices[${index}].attribution`, reasons);
    const outcome = classifyOutcome({ historicalFailed, status, amount, eligibleFailure, netRecovered, recoveryStatus, hasConflict });
    const residual = eligibleFailure && !hasConflict ? Math.max(amount - netRecovered, 0) : 0;
    const countedRecovered = historicalFailed && !hasConflict ? netRecovered : 0;
    if (outcome === 'unknown') unknownRecordCount += 1;
    outcomes[outcome] += 1;
    if (eligibleFailure && !hasConflict) {
      failedAmount += amount;
      residualOpportunity += residual;
    }
    recoveredAmount += countedRecovered;
    if (attribution.attribution_status === 'attributed' && !hasConflict) attributedRecoveredAmount += attribution.attributed_amount;
    return {
      invoice_id: id,
      status,
      amount,
      recovery_status: recoveryStatus,
      recovered_amount: countedRecovered,
      outcome,
      eligibility: eligibleFailure && !hasConflict ? 'eligible' : hasConflict ? 'unknown' : 'excluded',
      residual_opportunity: residual,
      payment_ids: payments.map((payment) => payment.id),
      refund_ids: refunds.map((refund) => refund.id),
      event_ids: events.map((event) => event.id),
      reason_codes: reasons,
      ...attribution
    };
  });

  return {
    audit_version: 2,
    read_only: true,
    source: 'local_json_fixture',
    currency,
    invoice_count: invoices.length,
    failed_invoice_count: invoices.filter((invoice) => invoice.eligibility === 'eligible').length,
    unknown_record_count: unknownRecordCount,
    outcomes,
    totals: {
      failed_amount: failedAmount,
      recovered_amount: recoveredAmount,
      residual_opportunity: residualOpportunity,
      attributed_recovered_amount: attributedRecoveredAmount,
      unattributed_recovered_amount: recoveredAmount - attributedRecoveredAmount,
      recovery_coverage_percent: roundPercent(recoveredAmount, failedAmount),
      attribution_coverage_percent: roundPercent(attributedRecoveredAmount, recoveredAmount)
    },
    invoices
  };
}

module.exports = { auditFixture };
