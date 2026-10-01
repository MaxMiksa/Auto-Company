export const SAMPLE_RECEIPT = {
  project: "Harbour Studio website",
  change: "Add a pricing calculator to the existing landing page.",
  price: 450,
  days: 3,
  context: "The calculator will use the approved service packages and live below the comparison table.",
  id: "sample",
  sample: true
};

const MAX_RECEIPT_ID_LENGTH = 120;
// Covers the bounded form fields even when JSON expands every character to a
// six-character control escape, while still rejecting unusually large input.
const MAX_ENCODED_RECEIPT_LENGTH = 8192;
const FINAL_DECISIONS = new Set(["approved", "declined"]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function cleanText(value) {
  return String(value || "").trim();
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

export function validateReceipt(receipt) {
  const errors = {};
  const project = cleanText(receipt.project);
  const change = cleanText(receipt.change);
  const context = cleanText(receipt.context);
  const price = Number(receipt.price);
  const days = Number(receipt.days);
  if (project.length < 1 || project.length > 80) errors.project = "Use a project name between 1 and 80 characters.";
  if (change.length < 10 || change.length > 500) errors.change = "Describe the change in 10 to 500 characters.";
  if (isBlank(receipt.price) || !Number.isInteger(price) || price < 0) errors.price = "Enter a whole-dollar amount of $0 or more.";
  if (isBlank(receipt.days) || !Number.isInteger(days) || days < 0 || days > 365) errors.days = "Enter whole days from 0 to 365.";
  if (context.length > 300) errors.context = "Keep context to 300 characters or fewer.";
  return errors;
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
}

export function makeReceipt(input) {
  return {
    project: cleanText(input.project),
    change: cleanText(input.change),
    price: Number(input.price),
    days: Number(input.days),
    context: cleanText(input.context),
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString()
  };
}

export function encodeReceipt(receipt) {
  return base64UrlEncode(receipt);
}

export function decodeReceipt(value) {
  try {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENCODED_RECEIPT_LENGTH) return null;
    const receipt = base64UrlDecode(value);
    if (Object.keys(validateReceipt(receipt)).length > 0) return null;
    if (typeof receipt.id !== "string" || receipt.id.length < 1 || receipt.id.length > MAX_RECEIPT_ID_LENGTH) return null;

    const hasDecision = Object.prototype.hasOwnProperty.call(receipt, "decision");
    const hasDecidedAt = Object.prototype.hasOwnProperty.call(receipt, "decidedAt");
    if (hasDecision !== hasDecidedAt) return null;
    if (hasDecision) {
      if (!FINAL_DECISIONS.has(receipt.decision)) return null;
      if (typeof receipt.decidedAt !== "string" || !ISO_TIMESTAMP.test(receipt.decidedAt) || Number.isNaN(Date.parse(receipt.decidedAt))) return null;
    }

    return receipt;
  } catch {
    return null;
  }
}

export function receiptFromHash(hash) {
  const match = String(hash || "").match(/^#r=([^&]+)$/);
  return match ? decodeReceipt(match[1]) : null;
}

export function formatPrice(price) {
  return Number(price) === 0 ? "No price increase" : `$${Number(price).toLocaleString("en-US")} USD`;
}

export function formatDays(days) {
  return Number(days) === 0 ? "No timeline change" : `${Number(days)} day${Number(days) === 1 ? "" : "s"} added`;
}
