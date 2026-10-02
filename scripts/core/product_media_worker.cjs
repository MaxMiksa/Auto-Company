/* Isolated short-lived renderer. Python owns the process tree and final commit. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");

// The Python entry owns isolation. A direct host invocation is unsupported.
try {
  const boundary = JSON.parse(fs.readFileSync("/run/auto-company/command.json", "utf8"));
  const status = fs.readFileSync("/proc/self/status", "utf8");
  if (fs.readlinkSync("/proc/self/ns/net") === boundary.hostNetworkNamespace ||
      !/^NoNewPrivs:\s+1$/m.test(status) || !/^Seccomp:\s+2$/m.test(status) ||
      !/^CapEff:\s+0+$/m.test(status)) throw new Error("missing kernel boundary");
} catch (_) {
  console.error("Product media worker requires project isolation");
  process.exit(78);
}

const request = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let browser, server, child;
let stopping = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = code => Object.assign(new Error(code), { code });
const identityHeaders = {
  "X-Auto-Company-Media": request.token,
  "X-Auto-Company-Version": request.version,
  "Cache-Control": "no-store",
};
// Also bound lifetime if the Python owner crashes without running its finally.
// This worker is launched as its own POSIX session / Windows process tree.
const watchdog = setTimeout(async () => {
  await Promise.race([cleanup().catch(() => {}), sleep(2000)]);
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(process.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    process.kill(-process.pid, "SIGKILL");
  }
}, 55000);
watchdog.unref();

function playwright() {
  for (const location of ["../media/package.json", "../../tests/browser/package.json"]) {
    try { return createRequire(path.resolve(__dirname, location))("playwright"); }
    catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
  }
  throw fail("playwright_missing");
}

function safeFile(root, relative) {
  const normalized = relative.replaceAll("\\", "/");
  if (normalized.split("/").some(part => part === ".." || part.startsWith(".")) || normalized.includes(":")) throw fail("unsafe_path");
  let file = root;
  for (const part of normalized.split("/").filter(Boolean)) {
    file = path.join(file, part);
    if (fs.lstatSync(file).isSymbolicLink()) throw fail("unsafe_path");
  }
  const actual = fs.realpathSync(file);
  const relativeActual = path.relative(fs.realpathSync(root), actual);
  if (relativeActual.startsWith("..") || path.isAbsolute(relativeActual)) throw fail("unsafe_path");
  return file;
}

async function staticPreview() {
  const directory = path.resolve(request.project, request.profile.webRoot);
  const types = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm" };
  server = http.createServer((incoming, response) => {
    try {
      if (incoming.method !== "GET" && incoming.method !== "HEAD") throw fail("method_not_allowed");
      const url = new URL(incoming.url, "http://127.0.0.1");
      let relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      if (relative.endsWith("/") || !relative) relative += "index.html";
      const file = safeFile(directory, relative);
      const suffix = path.extname(file).toLowerCase();
      if (!request.webSuffixes.includes(suffix)) throw fail("unsupported_file");
      const info = fs.statSync(file);
      if (!info.isFile() || info.size > 24 * 1024 * 1024) throw fail("unsupported_file");
      response.writeHead(200, { ...identityHeaders, "Content-Type": types[suffix] || "application/octet-stream" });
      if (incoming.method === "HEAD") response.end();
      else fs.createReadStream(file).on("error", () => response.destroy()).pipe(response);
    } catch (_) {
      response.writeHead(404, identityHeaders);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function verifyHeaders(headers) {
  return headers["x-auto-company-media"] === request.token && headers["x-auto-company-version"] === request.version;
}

function health(url) {
  return new Promise(resolve => {
    const operation = http.get(url, { timeout: 500 }, response => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300 && verifyHeaders(response.headers));
    });
    operation.on("error", () => resolve(false));
    operation.on("timeout", () => operation.destroy());
  });
}

async function nodePreview() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const args = request.profile.command.slice(1).map(value => value.replace("{port}", String(port)));
  child = spawn(process.execPath, args, {
    cwd: request.project, shell: false, windowsHide: true, stdio: "ignore", detached: false,
    env: { ...process.env, AUTO_COMPANY_MEDIA_TOKEN: request.token, AUTO_COMPANY_MEDIA_VERSION: request.version,
      AUTO_COMPANY_MEDIA_PORT: String(port), HOST: "127.0.0.1" },
  });
  let launchError;
  child.on("error", error => { launchError = error; });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + request.profile.timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (launchError || child.exitCode !== null || child.signalCode !== null) throw fail("preview_launch_failed");
    if (await health(origin + request.profile.healthPath)) return origin;
    await sleep(75);
  }
  throw fail("preview_identity_or_readiness_failed");
}

async function cleanup() {
  if (stopping) return;
  stopping = true;
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });
  // Descendants remain in this worker's OS process tree/session. The Python
  // owner terminates that whole scope while this leader is still alive.
}

async function main() {
  let result;
  try {
    const { chromium } = playwright();
    try { browser = await chromium.launch({ headless: true, timeout: 10000 }); }
    catch (error) {
      const detail = String(error);
      throw fail(/Executable doesn't exist|browserType\.launch.*executable/i.test(detail) ? "browser_missing"
        : /error while loading shared libraries|Host system is missing dependencies/i.test(detail) ? "browser_dependencies_missing" : "browser_launch_failed");
    }
    const origin = request.profile.type === "static" ? await staticPreview() : await nodePreview();
    for (const viewport of request.viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1, isMobile: viewport.name === "mobile", hasTouch: viewport.name === "mobile",
        reducedMotion: "reduce", serviceWorkers: "block" });
      try {
        await context.route("**/*", route => {
          const target = new URL(route.request().url());
          return target.origin === origin || ["data:", "blob:"].includes(target.protocol) ? route.continue() : route.abort();
        });
        await context.routeWebSocket("**/*", socket => {
          const target = new URL(socket.url());
          if (["ws:", "wss:"].includes(target.protocol) && target.host === new URL(origin).host) socket.connectToServer();
          else socket.close();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(request.profile.timeoutSeconds * 1000);
        const response = await page.goto(origin + request.profile.entry, { waitUntil: "load", timeout: request.profile.timeoutSeconds * 1000 });
        if (!response || response.status() >= 400 || !verifyHeaders(await response.allHeaders())) throw fail("page_identity_failed");
        await page.locator(request.profile.readySelector).first().waitFor({ state: "visible" });
        for (const step of request.profile.steps) {
          const locator = page.locator(step.selector).first();
          if (step.action === "click") await locator.click();
          else await locator.fill(step.value);
        }
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(Array.from(document.images, image => image.complete ? Promise.resolve() : new Promise(resolve => {
            image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true });
          })));
        });
        // Recheck the owned endpoint immediately before image capture. A port
        // taken by another process cannot become a valid success record.
        if (!await health(origin + (request.profile.healthPath || request.profile.entry))) throw fail("preview_identity_lost");
        await page.screenshot({ path: path.join(request.output, `${viewport.name}.png`), fullPage: false, animations: "disabled", timeout: 10000 });
      } finally { await context.close(); }
    }
    result = { state: "success" };
  } catch (error) {
    result = { state: "failed", reason: typeof error.code === "string" && /^[a-z_]+$/.test(error.code) ? error.code : "capture_failed" };
  } finally {
    await cleanup();
  }
  fs.writeFileSync(path.join(request.output, "result.tmp"), JSON.stringify(result));
  fs.renameSync(path.join(request.output, "result.tmp"), path.join(request.output, "result.json"));
  // The outer namespace owner reaps all descendants. In this mode the result
  // is collected only after the complete namespace exits.
  if (request.isolatedExit === true) process.exit(0);
  // Hold the leader alive so the owner never signals a recycled PID and can
  // reap the entire short-lived preview scope after success or failure.
  setInterval(() => {}, 1000);
}

process.on("SIGTERM", () => { cleanup().catch(() => {}); });
process.on("SIGINT", () => { cleanup().catch(() => {}); });
main().catch(() => process.exit(1));
