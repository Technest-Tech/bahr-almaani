/**
 * Visual check for the transfer progress panel (uploads + downloads).
 *
 * The panel exists because a 5–20 MB file on a ~5 Mbit/s line takes ~30 seconds
 * and the UI used to show nothing at all for that whole time. So this script
 * throttles the browser to a realistic line rate and screenshots a transfer
 * *mid-flight* — a check that only catches the bug if the network is slow.
 *
 *   BASE=http://localhost:3000 TOKEN=… PROJECT=44 node ui-transfer-progress.mjs
 */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

// Deliberately not a hardcoded path: the sibling ui-*.mjs scripts pin
// chromium_headless_shell-1148, which no longer exists in the cache. Letting
// playwright-core resolve it survives the next browser bump.
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.SHOTS ?? "transfer-shots";
const TOKEN = process.env.TOKEN;
const PROJECT = process.env.PROJECT ?? "44";

// ~4 Mbit/s down, ~3 Mbit/s up, 60 ms RTT — measured against the real server.
const THROTTLE = {
  offline: false,
  latency: 60,
  downloadThroughput: (4 * 1024 * 1024) / 8,
  uploadThroughput: (3 * 1024 * 1024) / 8,
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];

async function scene(label, { width, height, theme, isMobile = false }, drive) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: isMobile ? 2 : 1,
    acceptDownloads: true,
  });
  await ctx.addInitScript(
    ([t, s]) => {
      localStorage.setItem("bahr_token", t);
      localStorage.setItem("theme", s);
    },
    [TOKEN, theme],
  );

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", THROTTLE);

  await page.goto(`${BASE}/projects/${PROJECT}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const note = await drive(page);

  results.push(`${label.padEnd(26)} ${note} ${errors.length ? "ERRORS: " + errors[0].slice(0, 80) : "clean"}`);
  await ctx.close();
}

/** Click a download and catch the panel while the bytes are still moving. */
async function driveDownload(page, label) {
  const button = page.locator('button[title="تحميل"]').first();
  await button.waitFor({ state: "visible", timeout: 15000 });
  await button.click();

  // Mid-flight: far enough in to show a percentage, not so far it has finished.
  await page.waitForSelector('[role="status"]', { timeout: 10000 });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/${label}-midflight.png` });

  const text = await page.locator('[role="status"]').innerText();
  const percent = /(\d[\d٠-٩]*)٪/.exec(text.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));

  // And again once it lands, to prove the success state renders. 6 MB at the
  // throttled rate is ~12 s, so this has to outwait the transfer, not the clock.
  await page.waitForFunction(
    () => /تم التحميل|تم الرفع/.test(document.querySelector('[role="status"]')?.textContent ?? ""),
    { timeout: 40000 },
  );
  await page.screenshot({ path: `${OUT}/${label}-done.png` });

  return `panel="${text.replace(/\s+/g, " ").slice(0, 72)}" pct=${percent ? percent[1] : "n/a"}`;
}

await scene("download-light", { width: 1440, height: 900, theme: "light" }, (p) =>
  driveDownload(p, "download-light"),
);
await scene("download-dark", { width: 1440, height: 900, theme: "dark" }, (p) =>
  driveDownload(p, "download-dark"),
);
await scene("download-mobile", { width: 390, height: 844, theme: "light", isMobile: true }, (p) =>
  driveDownload(p, "download-mobile"),
);

// Upload: feed a real 4 MB file through the picker and catch it in flight.
await scene("upload-light", { width: 1440, height: 900, theme: "light" }, async (page) => {
  const chooser = page.waitForEvent("filechooser");
  await page.locator('button:has-text("رفع ملف")').first().click();
  const fc = await chooser;
  await fc.setFiles({
    name: "ترجمة معتمدة.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(4 * 1024 * 1024, 0x41),
  });

  await page.waitForSelector('[role="status"]', { timeout: 10000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/upload-light-midflight.png` });
  const text = await page.locator('[role="status"]').innerText();
  return `panel="${text.replace(/\s+/g, " ").slice(0, 72)}"`;
});

writeFileSync(`${OUT}/report.txt`, results.join("\n"));
console.log(results.join("\n"));
await browser.close();
