/**
 * Visual check for the revision request with attachments.
 *
 * Drives the PM's "طلب تعديل" dialog end to end: type a note, attach two real
 * images, submit, then confirm the attachments come back on the timeline.
 *
 *   BASE=http://localhost:3000 TOKEN=… PROJECT=45 node ui-revision-attachments.mjs
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.SHOTS ?? "revision-shots";
const TOKEN = process.env.TOKEN;
const PROJECT = process.env.PROJECT ?? "45";
mkdirSync(OUT, { recursive: true });

/** A small solid-colour PNG, built inline so the check needs no fixtures. */
function png(rgb) {
  const w = 320, h = 200;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let table;
function crc32(buf) {
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

const browser = await chromium.launch();

async function run(label, { width, height, theme, isMobile = false }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: isMobile ? 2 : 1,
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

  await page.goto(`${BASE}/projects/${PROJECT}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  await page.locator('button:has-text("طلب تعديل")').first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });

  await page.locator("#rev-note").fill("الختم في غير موضعه على الصفحة الأخيرة — انظر الصورة المرفقة.");

  const chooser = page.waitForEvent("filechooser");
  await page.locator('button:has-text("إضافة صورة")').click();
  const fc = await chooser;
  await fc.setFiles([
    { name: "stamp-position.png", mimeType: "image/png", buffer: png([190, 30, 45]) },
    { name: "page-two.png", mimeType: "image/png", buffer: png([21, 35, 65]) },
  ]);
  await page.waitForTimeout(700);

  await page.screenshot({ path: `${OUT}/${label}-dialog.png` });
  const previews = await page.locator('[role="dialog"] ul li img').count();

  await page.locator('[role="dialog"] button[type="submit"]').click();
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${label}-after.png`, fullPage: !isMobile });

  const body = await page.locator("body").innerText();
  const onTimeline = /stamp-position\.png/.test(body);

  console.log(
    `${label.padEnd(18)} previews=${previews} timeline-shows-attachment=${onTimeline} ` +
      (errors.length ? `ERRORS: ${errors[0].slice(0, 70)}` : "clean"),
  );
  await ctx.close();
}

await run("revision-light", { width: 1440, height: 950, theme: "light" });
await browser.close();
