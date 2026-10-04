#!/usr/bin/env node
// Capture recorded journals, optionally filling unavailable display-only runtime fields.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');

const help = `Usage: node scripts/media/capture_showcase.cjs --previews <private-targets.json> --evidence <private-results.json> [--out <image-directory>] [--presentation-demo]

Each target requires product, language (en/zh-CN), url (local read-only /journal),
translation and originalSnapshot paths. cycleCount is optional.
--presentation-demo fills unavailable runtime/slot labels and hides the read-only
notice in the captured page only. Publish its disclosure with the screenshots.
Paths resolve from the repository root; absolute operator paths are also accepted.
Output defaults to presentation/showcase. Detailed evidence contains source text
and must stay in an ignored private directory. See presentation/showcase/README.md.
Requires Node >=20 and the pinned tests/browser Playwright installation.`;
const options = {};
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index];
  if (flag === '--help' || flag === '-h') { console.log(help); process.exit(0); }
  if (flag === '--presentation-demo') { options.presentationDemo = true; continue; }
  if (!['--previews','--evidence','--out'].includes(flag) || !process.argv[index+1] || process.argv[index+1].startsWith('--')) {
    console.error(`Invalid or incomplete argument: ${flag}\n${help}`); process.exit(1);
  }
  options[flag.slice(2)] = process.argv[++index];
}
if (!options.previews || !options.evidence) { console.error(help); process.exit(1); }
const { chromium } = require('../../tests/browser/node_modules/playwright');
const manifestFile = path.resolve(root, options.previews);
const outputDir = path.resolve(root, options.out || 'presentation/showcase');
const evidenceFile = path.resolve(root, options.evidence);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const reportSha = value => sha(JSON.stringify(canonical(value)));
const inventory = data => data.cycles.map(cycle => ({
  id: cycle.id, sequenceNumber: cycle.sequenceNumber, number: cycle.number,
  identityKind: cycle.identityKind, status: cycle.status,
  startedAt: cycle.startedAt, endedAt: cycle.endedAt,
  recordedAt: cycle.workReport?.recorded_at ?? null,
}));
const readJSON = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));

async function settle(page, count) {
  await page.locator('#panel-work').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.getElementById('refreshButton').disabled);
  await page.waitForFunction(expected => document.querySelectorAll('#historyList .history-row').length + document.querySelectorAll('#currentCycle .current-cycle').length === expected, count);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  // A lazy image inside a closed disclosure is not part of the actual shot.
  await page.waitForFunction(() => [...document.images].filter(image => {
    const box=image.getBoundingClientRect();
    return image.src && image.checkVisibility() && box.bottom>0 && box.top<innerHeight;
  }).every(image=>image.complete), null, {timeout:15000});
  if (options.presentationDemo) await page.evaluate(() => {
    const messages = window.JOURNAL_MESSAGES[document.documentElement.lang];
    const missing = new Set([messages.unknown, messages.statusUnavailable]);
    const changes = window.showcasePresentationChanges ||= {};
    const status = document.getElementById('projectRuntimeStatus');
    if (status && missing.has(status.textContent.trim())) {
      changes.runtimeState = { original: status.textContent.trim(), displayed: messages.lastWorkEnded, simulated: true };
      const marker = status.querySelector('.progress-node');
      if (marker) {
        const symbol = window.DashboardIcons.icon('circle-pause'); symbol.classList.add('size-full'); symbol.setAttribute('viewBox', '1 1 22 22');
        marker.className = 'progress-node progress-paused'; marker.replaceChildren(symbol); marker.title = messages.lastWorkEnded;
      }
      const label = status.lastElementChild;
      if (label) label.textContent = messages.lastWorkEnded;
    }
    const state = document.getElementById('sidebarRuntimeState');
    if (state && missing.has(state.textContent.trim())) state.textContent = messages.lastWorkEnded;
    const slot = document.getElementById('sidebarSlot');
    if (slot && missing.has(slot.textContent.trim())) {
      changes.concurrencyOccupied = { original: slot.textContent.trim(), displayed: messages.no, simulated: true };
      slot.textContent = messages.no;
    }
    const notice = document.getElementById('runtimeNotice');
    if (notice?.textContent.trim() === messages.readOnly) { notice.hidden = true; changes.readOnlyNoticeHidden = true; }
    const header = document.getElementById('runtimeState');
    if (header?.textContent.trim() === messages.historicalRecord) { header.textContent = messages.lastWorkEnded; header.dataset.state = 'ended'; changes.historicalHeaderReplaced = true; }
  });
}

async function inspect(page, language) {
  return page.evaluate(language => {
    const text = document.body.innerText;
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const languageWarnings = language === 'en'
      ? lines.filter(line => /[\u3400-\u9fff]/.test(line))
      : lines.filter(line => /\b(?:[A-Za-z]+[ ,;:]+){5,}[A-Za-z]+/.test(line));
    const histories = [...document.querySelectorAll('#historyList .history-row')];
    const box = node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, bottom: b.bottom, right: b.right }; };
    const titles = [...document.querySelectorAll('#cycleTitle, .history-title')].map(node => ({text:node.textContent,box:box(node),clipped:node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1}));
    const description = document.querySelector('.project-description');
    return {
      language: document.documentElement.lang,
      presentationChanges: window.showcasePresentationChanges || null,
      viewport: {width:innerWidth,height:innerHeight},
      document: {width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
      visibleText: text,
      languageWarnings,
      titleBounds: titles,
      descriptionClipped: Boolean(description && description.scrollHeight > description.clientHeight + 1),
      currentNumber: document.querySelector('#cycleNumber')?.textContent,
      historyIds: histories.map(node => node.dataset.cycleId),
      openHistories: histories.filter(node => node.open).map(node => node.dataset.cycleId),
      productMediaOpen: Boolean(document.querySelector('.product-media')?.checkVisibility()),
      productMediaBounds: document.querySelector('.product-media') ? box(document.querySelector('.product-media')) : null,
      cycleBounds: [document.querySelector('#currentCycle'),...histories].filter(Boolean).map(box),
      footerBounds: document.querySelector('.page-footer') ? box(document.querySelector('.page-footer')) : null,
      failedImages: [...document.images].filter(image => image.src && image.checkVisibility() && (!image.complete || !image.naturalWidth)).map(image=>image.src),
    };
  }, language);
}

async function saveShot(page, filename, fullPage = false) {
  const file = path.join(outputDir, filename);
  await page.mouse.move(0,0);
  const bytes = await page.screenshot({path:file,fullPage});
  return {file:path.relative(root,file).replaceAll('\\','/'),sha256:sha(bytes),image:{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)},fullPage,capturedAt:new Date().toISOString(),viewport:page.viewportSize()};
}

(async () => {
  const previews = await readJSON(manifestFile);
  await fs.mkdir(outputDir,{recursive:true});await fs.mkdir(path.dirname(evidenceFile),{recursive:true});
  const evidence = {observedAt:new Date().toISOString(),captureScript:path.relative(root,__filename).replaceAll('\\','/'),captureScriptSha256:sha(await fs.readFile(__filename)),manifestSha256:sha(await fs.readFile(manifestFile)),source:'Real read-only journal HTTP pages; current report and reviewed product screenshot expanded, history collapsed; provenance preserved in manifest/API, diagnostics in Log; no mocked requests, modified records, injected UI or pixel edits.',captures:[]};
  const browser = await chromium.launch({headless:true});
  evidence.presentationDemo = Boolean(options.presentationDemo);
  if (options.presentationDemo) evidence.source = 'Recorded journals with explicitly simulated unavailable runtime/slot display fields and read-only notice omitted. Original reports, checks, dates, APIs and media remain unchanged; no pixel editing.';
  try {
    for (const target of previews) {
      const record={product:target.product,language:target.language,url:target.url,startedAt:new Date().toISOString(),shots:[],warnings:[],errors:[]};evidence.captures.push(record);
      let page;
      try {
        assert.match(target.product,/^[a-z0-9-]+$/);assert.ok(['en','zh-CN'].includes(target.language));
        const url=new URL(target.url);assert.ok(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Use a local read-only preview URL');
        assert.equal(typeof target.translation,'string','Provide an explicit reviewed translation path');
        assert.equal(typeof target.originalSnapshot,'string','Provide an explicit private original snapshot path');
        const translationFile=path.resolve(root,target.translation);
        const originalFile=path.resolve(root,target.originalSnapshot);
        const translationBytes=await fs.readFile(translationFile);const originalBytes=await fs.readFile(originalFile);
        const translation=JSON.parse(translationBytes.toString('utf8').replace(/^\uFEFF/,''));const original=JSON.parse(originalBytes.toString('utf8').replace(/^\uFEFF/,''));
        record.translationSha256=sha(translationBytes);record.sourceSnapshotSha256=sha(originalBytes);
        page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
        page.on('pageerror',error=>record.errors.push(error.message));
        const requests=[];page.on('request',request=>{if(request.method()!=='GET')requests.push({url:request.url(),method:request.method()})});
        const response=await page.request.get(new URL('/api/journal',url).href);assert.equal(response.status(),200);const responseBytes=await response.body();const data=JSON.parse(responseBytes.toString('utf8'));
        assert.equal(data.readOnly,true);assert.equal(data.language,target.language);assert.equal(data.project.stableId,translation.productId);assert.equal(translation.language,target.language);
        assert.deepEqual(inventory(data),inventory(original),'Recorded cycle IDs, chronology and statuses must match the original snapshot');
        assert.equal(data.cycles.length,target.cycleCount||original.cycles.length);
        assert.deepEqual(Object.keys(translation.cycles).sort(),data.cycles.map(cycle=>cycle.id).sort());
        record.productId=data.project.stableId;record.servedSnapshotSha256=sha(responseBytes);record.cycles=inventory(data).map(cycle=>({...cycle,sourceReportSha256:translation.cycles[cycle.id].sourceSha256}));
        record.originalScreenshot=data.productMedia?.screenshot;
        record.publishedRefinement=data.productMedia?.publishedRefinement;
        assert.deepEqual(data.productMedia?.screenshot?.latestSuccess,original.productMedia?.screenshot?.latestSuccess,'Published refinement must preserve the original screenshot success record');
        record.originalResourceDigests=[];
        for(const variant of data.productMedia?.screenshot?.latestSuccess?.variants||[]) {
          const resource=await page.request.get(new URL(variant.href,url).href);assert.equal(resource.status(),200);
          const digest=sha(await resource.body());assert.equal(digest,variant.sha256,'Original screenshot resource must retain its recorded digest');
          record.originalResourceDigests.push({href:variant.href,sha256:digest});
        }
        for(const cycle of original.cycles)assert.equal(reportSha(cycle.workReport??null),translation.cycles[cycle.id].sourceSha256,'Original report hash mismatch');
        await page.goto(url.href,{waitUntil:'networkidle'});await settle(page,data.cycles.length);
        const historyIds=data.cycles.slice(1).map(cycle=>cycle.id);
        const initial=await inspect(page,target.language);assert.deepEqual(initial.historyIds,historyIds);assert.deepEqual(initial.openHistories,[]);assert.equal(initial.currentNumber,String(data.cycles[0].sequenceNumber??data.cycles[0].number).padStart(2,'0'));
        assert.equal(initial.productMediaOpen,true,'Product screenshot must be expanded by the actual frontend default');
        assert.doesNotMatch(initial.visibleText,/Published refinement|发布精修版|Original (desktop|mobile) capture|Original run captured|原运行(桌面截图|手机截图|截取于)|About this data|数据说明/);
        assert.equal(await page.locator('#sourceNotes').count(),0);
        await page.locator('#tab-logs').click();
        assert.equal(await page.locator('#panel-logs #runtimeDiagnostics').isVisible(),true,'Diagnostics must be accessible in Log');
        await page.locator('#runtimeDiagnostics .disclosure-trigger').click();
        assert.equal(await page.locator('#rawText').isVisible(),true);
        assert.ok((await page.locator('#diagnosticSummary').innerText()).trim());
        await page.locator('#tab-usage').click();
        assert.equal(await page.locator('#runtimeDiagnostics').isVisible(),false);
        await page.locator('#tab-work').click();
        await settle(page,data.cycles.length);
        assert.equal(await page.locator('#runtimeDiagnostics').isVisible(),false);
        record.timelineCleanupChecks={removedLabels:true,removedDataNotes:true,diagnosticsOnlyInLog:true};
        // Exercise the actual history disclosure without changing recorded data.
        const history = page.locator('#historyList .history-row').first();
        await history.locator('.disclosure-trigger').click();
        assert.equal(await history.evaluate(node=>node.open),true);
        await page.reload({waitUntil:'networkidle'});await settle(page,data.cycles.length);
        assert.equal(await history.evaluate(node=>node.open),true,'The session must retain expanded history across reload');
        await history.locator('.disclosure-trigger').click();
        assert.equal(await history.evaluate(node=>node.open),false);
        record.disclosureChecks={defaultHistoryCollapsed:true,historyExpansionAfterReload:true,historyCollapse:true};
        let height = await page.evaluate(()=>Math.ceil(Math.max(...['#currentCycle','#historyList','#projectSidebar','.page-footer'].map(selector=>document.querySelector(selector)).filter(Boolean).map(node=>node.getBoundingClientRect().bottom))+24));
        height=Math.max(1000,Math.ceil(height/40)*40);assert.ok(height<=4000,'Unexpected journal height; inspect the frontend before capturing');
        await page.setViewportSize({width:1440,height});await settle(page,data.cycles.length);await page.evaluate(()=>scrollTo(0,0));
        const desktop=await inspect(page,target.language);record.desktop=desktop;
        if (options.presentationDemo) {
          assert.equal(desktop.presentationChanges?.runtimeState?.simulated,true);
          assert.equal(desktop.presentationChanges?.concurrencyOccupied?.simulated,true);
          assert.equal(await page.locator('#runtimeNotice').isVisible(),false);
          assert.doesNotMatch(await page.locator('#projectRuntimeStatus, #sidebarRuntimeState, #sidebarSlot').allTextContents().then(text=>text.join(' ')),/unknown|unavailable|未知|不可用/i);
        }
        assert.deepEqual(desktop.historyIds,historyIds);assert.deepEqual(desktop.openHistories,[]);assert.ok(desktop.cycleBounds.every(b=>b.y>=0&&b.bottom<=height),'A recorded cycle is outside the desktop shot');
        assert.ok(!desktop.footerBounds || desktop.footerBounds.bottom<=height,'The real page footer is outside the desktop shot');
        assert.ok(desktop.productMediaOpen&&desktop.productMediaBounds.bottom<=height,'Expanded product media must fit in the desktop shot');
        if(desktop.languageWarnings.length)record.warnings.push({kind:'desktop-language',lines:desktop.languageWarnings});
        if(desktop.titleBounds.some(title=>title.clipped))record.warnings.push({kind:'desktop-title-clipped',titles:desktop.titleBounds.filter(title=>title.clipped)});
        if(desktop.descriptionClipped)record.warnings.push({kind:'desktop-description-clipped'});
        if(desktop.failedImages.length)record.warnings.push({kind:'desktop-images',urls:desktop.failedImages});
        record.shots.push(await saveShot(page,`${target.product}-timeline-${target.language}.png`));
        await page.setViewportSize({width:390,height:844});await settle(page,data.cycles.length);await page.evaluate(()=>scrollTo(0,0));
        const mobile=await inspect(page,target.language);record.mobile=mobile;
        if(mobile.languageWarnings.length)record.warnings.push({kind:'mobile-language',lines:mobile.languageWarnings});
        if(mobile.document.width>390)record.warnings.push({kind:'mobile-horizontal-overflow',width:mobile.document.width});
        if(mobile.titleBounds.some(title=>title.clipped))record.warnings.push({kind:'mobile-title-clipped',titles:mobile.titleBounds.filter(title=>title.clipped)});
        if(mobile.descriptionClipped)record.warnings.push({kind:'mobile-description-clipped'});
        record.shots.push(await saveShot(page,`${target.product}-timeline-${target.language}-mobile.png`));
        await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await settle(page,data.cycles.length);
        const mobileFull=await inspect(page,target.language);record.mobileFull=mobileFull;
        assert.equal(mobileFull.productMediaOpen,true);assert.deepEqual(mobileFull.failedImages,[],'Full mobile product image must load');
        await page.evaluate(()=>scrollTo(0,0));
        record.shots.push(await saveShot(page,`${target.product}-timeline-${target.language}-mobile-full.png`,true));
        const finalResponse=await page.request.get(new URL('/api/journal',url).href);assert.equal(finalResponse.status(),200);const finalData=await finalResponse.json();assert.deepEqual(inventory(finalData),inventory(data));assert.deepEqual(finalData.productMedia?.screenshot?.latestSuccess,data.productMedia?.screenshot?.latestSuccess);assert.deepEqual(requests,[],'Read-only capture must not issue writes');
        record.status=record.warnings.length?'captured_with_warnings':'captured';record.finishedAt=new Date().toISOString();
        console.log(JSON.stringify({product:record.product,language:record.language,status:record.status,cycles:record.cycles.length,desktopViewport:record.desktop.viewport,warnings:record.warnings,errors:record.errors}));
      } catch(error){record.status='failed';record.errors.push(error.stack||String(error));console.error(JSON.stringify({product:record.product,language:record.language,status:'failed',error:error.message}));}
      finally{if(page)await page.close();await fs.writeFile(evidenceFile,JSON.stringify(evidence,null,2)+'\n');}
    }
  }finally{await browser.close();}
  if(evidence.captures.some(record=>record.status==='failed'||record.errors.length))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});
