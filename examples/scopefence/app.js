import { SAMPLE_RECEIPT, formatDays as englishDays, formatPrice as englishPrice, makeReceipt, receiptFromHash, validateReceipt, encodeReceipt } from "./scopefence-core.js";

import { zh } from "./translations.js";
let language = new URL(location.href).searchParams.get("lang") === "zh" ? "zh" : "en";
let renderAgain = () => createView();
let isMaker = false;
const t = (value) => language === "zh" ? (zh[value] || value) : value;
const formatPrice = (n) => language === "zh" ? (Number(n) === 0 ? "费用不变" : `增加 $${Number(n).toLocaleString("en-US")} 美元`) : englishPrice(n);
const formatDays = (n) => language === "zh" ? (Number(n) === 0 ? "工期不变" : `增加 ${n} 天`) : englishDays(n);
const app = document.querySelector("#app");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const linkFor = (receipt) => `${location.href.split("#")[0]}#r=${encodeReceipt(receipt)}`;
const formattedTime = (time) => new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(time)) + " UTC";

function wordmark() {
  return `<header class="site-header"><a class="brand" href="${location.href.split("#")[0]}" aria-label="${t("ScopeFence home")}"><img src="auto-company-icon.svg" alt="" onerror="this.hidden=true"><span>ScopeFence${language === "zh" ? " <small>范围确认</small>" : ""}</span></a><span class="draft-state">${t("NO LOGIN · SHAREABLE RECEIPT")}</span><nav class="language-switch" aria-label="${language === "zh" ? "语言" : "Language"}"><button type="button" data-lang="en" aria-pressed="${language === "en"}">${language === "zh" ? "英文" : "English"}</button><button type="button" data-lang="zh" aria-pressed="${language === "zh"}">${language === "zh" ? "中文" : "Chinese"}</button></nav></header>`;
}

function fence() { return `<div class="fence-rule" aria-hidden="true"><span>${t("BOUNDARY")}</span></div>`; }

function receiptDetail(receipt) {
  return `<div class="receipt-details">
    <section class="territory inside"><p class="eyebrow">${t("INSIDE THE FENCE")}</p><h2>${escapeHtml(receipt.project)}</h2><p>${escapeHtml(receipt.change)}</p>${receipt.context ? `<p class="context">${escapeHtml(receipt.context)}</p>` : ""}</section>
    ${fence()}
    <section class="territory outside"><p class="eyebrow">${t("THE NEW WORK CHANGES")}</p><dl><div><dt>${t("Price impact")}</dt><dd>${formatPrice(receipt.price)}</dd></div><div><dt>${t("Timeline impact")}</dt><dd>${formatDays(receipt.days)}</dd></div></dl></section>
  </div>`;
}

function createView(values = {}, errors = {}) {
  renderAgain = () => createView(Object.fromEntries(new FormData(document.querySelector("#receipt-form"))), errors);
  app.innerHTML = `${wordmark()}<section class="hero create-hero"><p class="eyebrow">${t("SCOPE DECISION / 01")}</p><h1>${t("Agree on the change.")}<br>${t("Then start the work.")}</h1><p class="lede">${t("Capture the extra work, its cost and its timing. Share one clear decision link.")}</p></section>
  <section class="creator-grid"><form id="receipt-form" novalidate><div class="form-heading"><p class="eyebrow">${t("DRAW THE RECEIPT")}</p><p>${t("State the changed work and its consequence. Nothing more.")}</p></div>
    <label>${t("Project name")}<input name="project" maxlength="80" value="${escapeHtml(values.project)}" autocomplete="off" aria-describedby="project-error" required></label><p id="project-error" class="error">${t(errors.project || "")}</p>
    <label>${t("What changed?")}<textarea name="change" maxlength="500" rows="3" aria-describedby="change-help change-error" required placeholder="${t("Add a pricing calculator to the existing landing page.")}">${escapeHtml(values.change)}</textarea></label><p id="change-help" class="help">${t("Use the words your client used on the call.")}</p><p id="change-error" class="error">${t(errors.change || "")}</p>
    <div class="impact-row"><label>${t("Price impact (USD)")}<input name="price" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(values.price)}" aria-describedby="price-error" required></label><label>${t("Timeline impact (days)")}<input name="days" type="number" min="0" max="365" step="1" inputmode="numeric" value="${escapeHtml(values.days)}" aria-describedby="days-error" required></label></div><p id="price-error" class="error">${t(errors.price || "")}</p><p id="days-error" class="error">${t(errors.days || "")}</p>
    <label>${t("Optional context")}<textarea name="context" maxlength="300" rows="2" aria-describedby="context-error" placeholder="${t("What does this change cover?")}">${escapeHtml(values.context)}</textarea></label><p id="context-error" class="error">${t(errors.context || "")}</p>
    <button class="primary" type="submit">${t("Create decision link")} <span aria-hidden="true">↗</span></button><button class="text-button" type="button" id="sample-button">${t("Open a sample receipt")}</button>
  </form><aside class="draft-note"><p class="eyebrow">${t("A SMALL PROMISE")}</p><p>${t("One change. One clear choice.")}</p><ol class="handoff-steps"><li>${language === "zh" ? "写清新增工作与影响。" : "Write down the change and its impact."}</li><li>${language === "zh" ? "把链接发给客户。" : "Share the link with your client."}</li><li>${language === "zh" ? "请对方选择后发回结果链接。" : "Ask them to return their response link."}</li></ol><div class="boundary-note"><strong>${language === "zh" ? "这是沟通副本" : "A communication copy"}</strong><p>${language === "zh" ? "链接可被修改，并非签名凭证。请在原对话中核对结果；本工具不会发送邮件或收款。" : "Links are editable, not signed approvals. Confirm the returned choice in the original conversation. No email is sent and no payment is collected."}</p></div><div class="corner-mark" aria-hidden="true"></div></aside></section>`;
  document.querySelector("#receipt-form").addEventListener("submit", submitReceipt);
  bindLanguage();
  document.querySelector("#sample-button").addEventListener("click", () => showReceipt(language === "zh" ? { ...SAMPLE_RECEIPT, project: "海港工作室网站", change: "在现有网站首页增加一个服务报价计算器。", context: "使用已确认的服务套餐，放在套餐对比表下方。" } : SAMPLE_RECEIPT));
}

function submitReceipt(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const errors = validateReceipt(values);
  if (Object.keys(errors).length) { createView(values, errors); document.querySelector(`[name="${Object.keys(errors)[0]}"]`)?.focus(); return; }
  showReceipt(makeReceipt(values), true);
}

function showReceipt(receipt, maker = false) {
  isMaker = maker; renderAgain = () => showReceipt(receipt, maker);
  const publicLink = linkFor(receipt);
  app.innerHTML = `${wordmark()}<section class="hero receipt-hero"><p class="eyebrow">${receipt.sample ? t("SAMPLE — NOT A LIVE CLIENT DECISION") : t("SCOPE RECEIPT / READY TO DECIDE")}</p><h1>${t("Does this request belong")}<br>${t("in the agreed work?")}</h1><p class="lede">${t("Read the change and its impact. Then make one clear choice.")}</p></section><section class="receipt-wrap">${receiptDetail(receipt)}<section class="decision-panel" aria-labelledby="decision-heading"><p class="eyebrow">${t("THE DECISION")}</p><h2 id="decision-heading">${t("Choose what happens next.")}</h2><p>${t("Your selection can be carried in an updated link and returned to the freelancer. The link is editable and is not a signed or independently verified approval record.")}</p><div class="decision-actions"><button class="decision approve" data-decision="approved">${t("Approve this change")} <span>→</span></button><button class="decision decline" data-decision="declined">${t("Decline this change")} <span>→</span></button></div></section>${maker ? makerPanel(publicLink, receipt) : ""}</section>`;
  document.querySelectorAll("[data-decision]").forEach((button) => button.addEventListener("click", () => confirmDecision(receipt, button.dataset.decision)));
  bindCopies(); bindLanguage();
}

function makerPanel(link, receipt) {
  const email = language === "zh" ? `主题：请确认变更 — ${receipt.project}\n\n请查看变更并选择同意或不同意：${link}\n\n确认后，请在当前对话中发回更新后的链接。` : `Subject: Decision needed — ${receipt.project}\n\nHi,\n\nPlease review this scope receipt and choose approve or decline: ${link}\n\nIt covers: ${receipt.change}\n\nAfter confirming, please return the updated link in this conversation.\n\nThanks.`;
  return `<section class="share-panel" tabindex="-1"><div><p class="eyebrow">${t("LINK READY")}</p><h2>${t("Send the decision, not a vague follow-up.")}</h2><label class="share-link-label">${language === "zh" ? "确认链接" : "Decision link"}<input class="share-link-input" readonly value="${escapeHtml(link)}"></label></div><div class="copy-actions"><button class="primary copy-button" data-copy="${escapeHtml(link)}" data-copy-label="${t("Copy link")}">${t("Copy link")}</button><button class="secondary copy-button" data-copy="${escapeHtml(email)}" data-copy-label="${t("Copy email")}">${t("Copy email")}</button></div><p class="share-note">${t("The receipt data lives in the link itself. Anyone with the link can alter that data, so confirm the returned choice in the original conversation.")}</p></section>`;
}

function finalReturnPanel(link) {
  return `<section class="return-panel" aria-labelledby="return-heading"><p class="eyebrow">${t("RETURN THE LINK COPY")}</p><h2 id="return-heading">${t("Send this updated link back.")}</h2><p>${t("Paste it into the same email or message thread. It carries your selected response, but it is editable and is not independently verified.")}</p><label class="final-link-label" for="final-link">${t("Updated decision link")}<input id="final-link" class="final-link-input" type="url" readonly value="${escapeHtml(link)}"></label><div class="copy-actions"><button class="primary copy-button" data-copy="${escapeHtml(link)}" data-copy-label="${t("Copy updated link")}">${t("Copy updated link")}</button><button class="secondary" type="button" id="select-final-link">${t("Select link")}</button></div></section>`;
}

function confirmDecision(receipt, decision) {
  const maker = isMaker; renderAgain = () => { showReceipt(receipt, maker); confirmDecision(receipt, decision); };
  const action = decision === "approved" ? "approval" : "decline";
  const panel = document.querySelector(".decision-panel");
  panel.innerHTML = `<p class="eyebrow">${language === "zh" ? "再次确认" : "CONFIRM " + action.toUpperCase()}</p><h2>${decision === "approved" ? t("Approve this changed work?") : t("Decline this changed work?")}</h2><p>${decision === "approved" ? language === "zh" ? `你选择接受：${formatPrice(receipt.price)}，${formatDays(receipt.days)}。` : `You are confirming ${formatPrice(receipt.price)} and ${formatDays(receipt.days)}.` : t("The freelancer will see that this change is not approved.")}</p><div class="decision-actions"><button class="primary" id="confirm-decision">${language === "zh" ? (decision === "approved" ? "确认同意" : "确认不同意") : "Confirm " + action}</button><button class="secondary" id="cancel-decision">${t("Go back")}</button></div>`;
  document.querySelector("#confirm-decision").focus();
  document.querySelector("#confirm-decision").addEventListener("click", () => finalizeDecision(receipt, decision));
  document.querySelector("#cancel-decision").addEventListener("click", () => showReceipt(receipt, maker));
}

function finalizeDecision(receipt, decision) {
  const finalized = { ...receipt, decision, decidedAt: receipt.decidedAt || new Date().toISOString() };
  renderAgain = () => finalizeDecision(finalized, decision);
  const link = linkFor(finalized);
  history.replaceState({}, "", `#r=${encodeReceipt(finalized)}`);
  app.innerHTML = `${wordmark()}<section class="final-state ${decision}"><p class="eyebrow">${t("DECISION LINK COPY CREATED")}</p><h1>${decision === "approved" ? t("Approval selected.") : t("Decline selected.")}</h1><p>${escapeHtml(finalized.project)} · ${formattedTime(finalized.decidedAt)}</p><div class="final-stamp">${decision === "approved" ? t("✓ APPROVAL SELECTED") : t("× DECLINE SELECTED")}</div>${finalReturnPanel(link)}<button class="text-button" id="view-receipt">${t("View receipt")}</button></section>`;
  bindCopies(); bindLanguage();
  document.querySelector("#select-final-link").addEventListener("click", () => { const input = document.querySelector("#final-link"); input.focus(); input.select(); });
  document.querySelector("#view-receipt").addEventListener("click", () => showFinalReceipt(finalized));
}

function showFinalReceipt(receipt) {
  renderAgain = () => showFinalReceipt(receipt);
  app.innerHTML = `${wordmark()}<section class="hero receipt-hero"><p class="eyebrow">${t("DECISION LINK COPY")}</p><h1>${receipt.decision === "approved" ? t("This link says: approved.") : t("This link says: declined.")}</h1><p class="lede">${language === "zh" ? `链接记录的选择时间：${formattedTime(receipt.decidedAt)}。它并非签名或独立验证的凭证。` : `The encoded link includes a selection timestamp of ${formattedTime(receipt.decidedAt)}. It is not signed or independently verified.`}</p></section><section class="receipt-wrap">${receiptDetail(receipt)}<section class="decision-panel locked"><p class="eyebrow">${t("PORTABLE COPY")}</p><h2>${receipt.decision === "approved" ? t("Approval selected") : t("Decline selected")}</h2><p>${t("Anyone with the link can alter its encoded data. Confirm the choice in the original conversation before relying on it.")}</p></section></section>`;
  bindLanguage();
}

function bindCopies() {
  document.querySelectorAll(".copy-button").forEach((button) => button.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = t("Copied"); setTimeout(() => { button.textContent = button.dataset.copyLabel || t("Copy"); }, 1800); }
    catch { button.textContent = t("Copy failed — select the link"); }
  }));
}

function renderFromLocation() {
  const existing = receiptFromHash(location.hash);
  if (existing?.decision && existing.decidedAt) showFinalReceipt(existing);
  else if (existing) showReceipt(existing);
  else { createView(); if (location.hash) { const warning = document.createElement("p"); warning.className = "link-error"; warning.setAttribute("role", "alert"); warning.textContent = language === "zh" ? "这个链接不完整或无效。请索取新链接，或在下方重新创建。" : "This link is incomplete or invalid. Ask for a new link, or create a receipt below."; document.querySelector(".hero").after(warning); } }
}

function bindLanguage() {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title = language === "zh" ? "ScopeFence 范围确认 — 把变更说清楚" : "ScopeFence — scope decisions, made clear";
  document.querySelectorAll("[data-lang]").forEach(button => button.addEventListener("click", () => {
    language = button.dataset.lang;
    const url = new URL(location.href); url.searchParams.set("lang", language); history.replaceState({}, "", url);
    renderAgain();
  }));
}
window.addEventListener("hashchange", renderFromLocation);
renderFromLocation();
