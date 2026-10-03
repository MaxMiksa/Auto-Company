/* Shared display dates. Stored timestamps and date-filter values remain intact. */
(() => {
  const pad = value => String(value).padStart(2, '0');
  const localDay = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  function parts(value, language = 'zh-CN', now = new Date()) {
    if (!value) return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const day = localDay(date);
    const label = day === localDay(now) ? (language === 'zh-CN' ? '今天' : 'Today')
      : day === localDay(yesterday) ? (language === 'zh-CN' ? '昨天' : 'Yesterday')
      : date.getFullYear() === now.getFullYear() ? day.slice(5) : day;
    return { date: label, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
  }
  window.DashboardDate = { parts, day: () => localDay(new Date()),
    format: (value, language, now) => { const result = parts(value, language, now); return result ? `${result.date} ${result.time}` : null; },
    date: (value, language, now) => parts(value, language, now)?.date || null };
})();
