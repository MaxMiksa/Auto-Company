import test from "node:test";
import assert from "node:assert/strict";
import { decodeReceipt, encodeReceipt, formatDays, formatPrice, makeReceipt, receiptFromHash, validateReceipt } from "../scopefence-core.js";

const receipt = { project: "Élan web", change: "Add an accessibility audit & summary.", price: 0, days: 1, context: "客户确认", id: "test-001" };

test("validates the required receipt boundaries", () => {
  assert.deepEqual(validateReceipt(receipt), {});
  assert.ok(validateReceipt({ ...receipt, project: "" }).project);
  assert.ok(validateReceipt({ ...receipt, change: "short" }).change);
  assert.ok(validateReceipt({ ...receipt, price: "" }).price);
  assert.ok(validateReceipt({ ...receipt, price: "2.5" }).price);
  assert.ok(validateReceipt({ ...receipt, days: "" }).days);
  assert.ok(validateReceipt({ ...receipt, days: "366" }).days);
});

test("round-trips Unicode receipt content through a shareable hash", () => {
  const encoded = encodeReceipt(receipt);
  assert.deepEqual(decodeReceipt(encoded), receipt);
  assert.deepEqual(receiptFromHash(`#r=${encoded}`), receipt);
});

test("round-trips maximum form fields after worst-case JSON escaping", () => {
  const input = {
    project: "\u0001".repeat(80),
    change: "\u0001".repeat(500),
    price: "0",
    days: "0",
    context: "\u0001".repeat(300)
  };
  assert.deepEqual(validateReceipt(input), {});
  const made = makeReceipt(input);
  const encoded = encodeReceipt(made);
  assert.ok(encoded.length > 4096);
  assert.ok(encoded.length <= 8192);
  assert.deepEqual(decodeReceipt(encoded), made);
  const finalized = { ...made, decision: "approved", decidedAt: "2026-09-19T11:00:00.000Z" };
  const finalizedEncoded = encodeReceipt(finalized);
  assert.ok(finalizedEncoded.length <= 8192);
  assert.deepEqual(decodeReceipt(finalizedEncoded), finalized);
});

test("preserves a final decision in the returned receipt link", () => {
  const finalized = { ...receipt, decision: "approved", decidedAt: "2026-09-19T11:00:00.000Z" };
  const encoded = encodeReceipt(finalized);
  assert.deepEqual(receiptFromHash(`#r=${encoded}`), finalized);
});

test("rejects malformed receipt links safely", () => {
  assert.equal(decodeReceipt("not-a-receipt"), null);
  assert.equal(decodeReceipt("x".repeat(8193)), null);
  assert.equal(receiptFromHash("#r=broken&extra"), null);
  assert.equal(receiptFromHash("#nothing"), null);
});

test("rejects incomplete or invalid final decision payloads", () => {
  assert.equal(decodeReceipt(encodeReceipt({ ...receipt, decision: "maybe", decidedAt: "2026-09-19T11:00:00.000Z" })), null);
  assert.equal(decodeReceipt(encodeReceipt({ ...receipt, decision: "approved" })), null);
  assert.equal(decodeReceipt(encodeReceipt({ ...receipt, decidedAt: "2026-09-19T11:00:00.000Z" })), null);
  assert.equal(decodeReceipt(encodeReceipt({ ...receipt, decision: "declined", decidedAt: "not-a-date" })), null);
  assert.equal(decodeReceipt(encodeReceipt({ ...receipt, id: "x".repeat(121) })), null);
});

test("accepts only the two supported final decisions with valid timestamps", () => {
  for (const decision of ["approved", "declined"]) {
    const finalized = { ...receipt, decision, decidedAt: "2026-09-19T11:00:00.000Z" };
    assert.deepEqual(decodeReceipt(encodeReceipt(finalized)), finalized);
  }
});

test("formats zero and singular impacts without ambiguity", () => {
  assert.equal(formatPrice(0), "No price increase");
  assert.equal(formatPrice(450), "$450 USD");
  assert.equal(formatDays(0), "No timeline change");
  assert.equal(formatDays(1), "1 day added");
  assert.equal(formatDays(2), "2 days added");
});
