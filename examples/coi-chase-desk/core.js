(function(root) {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function counts(requests) {
    return {all:requests.length, chase:requests.filter(r=>r.status==='chase').length, waiting:requests.filter(r=>r.status==='waiting').length, received:requests.filter(r=>r.status==='received').length};
  }
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function csvReport(requests, labels) {
    const rows = [labels.header];
    for (const r of requests) rows.push([r.sample?labels.sample:labels.local,r.partner,r.email,r.coverage,r.due,labels.status[r.status],r.reference || '',r.events.map(e=>`${e.at} | ${labels.event[e.type]} | ${e.note}`).join('\n')]);
    return '\uFEFF' + rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
  }
  function addEvent(request, type, note, at) {
    if (!['followup','received','reopened'].includes(type)) throw new Error('Unsupported event');
    if (!String(note).trim()) throw new Error('A note is required');
    const next = {...request, events:[...request.events,{type,note:String(note).trim(),at}]};
    if (type==='followup' && request.status!=='received') next.status='waiting';
    if (type==='received') {next.status='received';next.reference=String(note).trim();}
    if (type==='reopened') {next.status='chase';next.reference='';}
    return next;
  }
  const api={escapeHtml,counts,csvCell,csvReport,addEvent};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  else root.COICore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
