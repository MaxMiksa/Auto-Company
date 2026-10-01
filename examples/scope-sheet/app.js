const form = document.querySelector('#scope-form');
const actionMessage = document.querySelector('#action-message');
const sendCheck = document.querySelector('#send-check');
const confirmationToggle = form.elements.requestConfirmation;
const confirmationMessage = document.querySelector('#confirmation-message');

const fields = ['client', 'project', 'service', 'scope', 'revisions', 'deliverable', 'deadline', 'price', 'note', 'confirmation'];
const sendRequiredFields = [
  ['project', '项目名称'],
  ['service', '本次服务'],
  ['scope', '工作范围'],
  ['revisions', '修改次数'],
  ['deliverable', '交付内容'],
  ['deadline', '交付日期'],
  ['price', '报价']
];
const example = {
  client: '春日咖啡',
  project: '秋季新品短片剪辑',
  service: '30 秒品牌短片剪辑',
  scope: '整理并筛选客户提供的素材；完成粗剪、精剪、基础调色与字幕排版。',
  revisions: '含 2 轮修改（以同一版方向为准）',
  deliverable: '1 条 9:16 竖版 MP4（1080 × 1920）',
  deadline: '2026-09-26',
  price: '2800',
  note: '请在开工前一次性提供最终文案、Logo 与品牌字体。'
};

function value(name) {
  return form.elements[name].value.trim();
}

function formatDate(input) {
  if (!input) return '—';
  const [year, month, day] = input.split('-');
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

function priceNumber(input) {
  const raw = String(input).trim().replace(/，/g, ',');
  if (!raw) return null;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return null;
  const numeric = Number(raw.replace(/,/g, ''));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function formatPrice(input) {
  const numeric = priceNumber(input);
  return numeric !== null
    ? `¥ ${numeric.toLocaleString('zh-CN')}`
    : '¥ —';
}

function setText(id, text, fallback = '—') {
  document.querySelector(id).textContent = text || fallback;
}

function missingSendFields() {
  const missing = sendRequiredFields.filter(([name]) => !value(name));
  const hasInvalidPrice = value('price') && priceNumber(value('price')) === null;
  return hasInvalidPrice ? [...missing, ['price', '报价（请填写非负金额）']] : missing;
}

function updateSendCheck() {
  const missing = missingSendFields();
  const complete = missing.length === 0;
  sendCheck.textContent = complete
    ? '发送前校对：项目、服务、范围、修改、交付、日期和报价已齐。'
    : `发送前校对：还差 ${missing.map(([, label]) => label).join('、')}。`;
  sendCheck.classList.toggle('is-ready', complete);
}

function ensureReadyToSend() {
  const missing = missingSendFields();
  if (missing.length === 0) return true;

  sendRequiredFields.forEach(([name]) => {
    const invalid = missing.some(([missingName]) => missingName === name);
    form.elements[name].classList.toggle('is-invalid', invalid);
    form.elements[name].setAttribute('aria-invalid', String(invalid));
  });
  const [firstName, firstLabel] = missing[0];
  form.elements[firstName].focus();
  actionMessage.textContent = `请先补齐${missing.map(([, label]) => label).join('、')}，再导出。`;
  return false;
}

function confirmationText() {
  const data = Object.fromEntries(fields.map((field) => [field, value(field)]));
  const rows = [
    '范围确认单',
    data.project || '未命名项目',
    '',
    `客户：${data.client || '—'}`,
    `服务：${data.service || '—'}`,
    `交付：${data.deliverable || '—'}`,
    `交付日期：${formatDate(data.deadline)}`,
    '',
    '本次包含：',
    data.scope || '—',
    '',
    `修改安排：${data.revisions || '—'}`,
    `本次合作报价：${formatPrice(data.price)}`
  ];
  if (data.note) rows.push('', '开工前请确认：', data.note);
  if (confirmationToggle.checked && data.confirmation) rows.push('', '请确认：', data.confirmation);
  return rows.join('\n');
}

function syncConfirmationRequest() {
  confirmationMessage.hidden = !confirmationToggle.checked;
}

function updatePreview() {
  const project = value('project');
  setText('#doc-project', project ? `项目：${project}` : '', '填写左侧内容后，这里会生成你的项目确认单。');
  setText('#doc-client', value('client'));
  setText('#doc-service', value('service'));
  setText('#doc-deliverable', value('deliverable'));
  setText('#doc-deadline', formatDate(value('deadline')));
  setText('#doc-scope', value('scope'), '尚未填写工作范围。');
  setText('#doc-revisions', value('revisions'));
  setText('#doc-price', formatPrice(value('price')));
  const note = value('note');
  document.querySelector('#note-section').hidden = !note;
  document.querySelector('#doc-note').textContent = note;
  const confirmation = value('confirmation');
  document.querySelector('#confirmation-section').hidden = !confirmationToggle.checked || !confirmation;
  document.querySelector('#doc-confirmation').textContent = confirmation;
  updateSendCheck();
}

async function copyText() {
  if (!ensureReadyToSend()) return;
  const text = confirmationText();
  try {
    await navigator.clipboard.writeText(text);
    actionMessage.textContent = '已复制。现在可以粘贴到微信、邮件或项目群。';
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    actionMessage.textContent = copied ? '已复制。现在可以粘贴到微信、邮件或项目群。' : '复制未成功，请使用下载文本文件。';
  }
}

function downloadText() {
  if (!ensureReadyToSend()) return;
  const blob = new Blob([confirmationText()], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = (value('project') || '范围确认单').replace(/[\\/:*?"<>|]/g, '-');
  link.href = url;
  link.download = `${safeName}-范围确认单.txt`;
  link.click();
  URL.revokeObjectURL(url);
  actionMessage.textContent = '已开始下载，可作为项目留档或直接发送给客户。';
}

form.addEventListener('submit', (event) => event.preventDefault());
form.addEventListener('input', updatePreview);
form.addEventListener('input', (event) => {
  if (event.target.name && sendRequiredFields.some(([name]) => name === event.target.name)) {
    event.target.classList.remove('is-invalid');
    event.target.setAttribute('aria-invalid', 'false');
  }
});
confirmationToggle.addEventListener('change', () => {
  syncConfirmationRequest();
  updatePreview();
});
document.querySelector('#copy-button').addEventListener('click', copyText);
document.querySelector('#download-button').addEventListener('click', downloadText);
document.querySelector('#example-button').addEventListener('click', () => {
  Object.entries(example).forEach(([name, content]) => { form.elements[name].value = content; });
  updatePreview();
  actionMessage.textContent = '已载入一组示例。可以直接改成你的项目。';
});
syncConfirmationRequest();
updatePreview();
