/**
 * Visual check for "this file needs an ID attached" — the document request loop.
 *
 * Drives both halves the way the two people actually do it: the PM asks from the
 * work file's own row, the client sees the ask at the top of their project page
 * and uploads a photo, and the office's board drops the badge once it arrives.
 *
 *   BASE=http://localhost:3000 API=http://localhost:8000/api/v1 \
 *   STAFF_TOKEN=… EMAIL=… PASSWORD=… PROJECT=31 node ui-document-requests.mjs
 */
import { chromium } from "playwright-core";
import { homedir, tmpdir } from "node:os";
import { globSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EXECUTABLE =
  process.env.CHROME ??
  globSync(`${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell`)
    .concat(
      globSync(`${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-*/*/headless_shell`),
    )
    .sort()
    .pop();

const BASE = process.env.BASE ?? "http://localhost:3000";
const API = process.env.API ?? "http://localhost:8000/api/v1";
const OUT = process.env.SHOTS ?? "document-request-shots";
const STAFF_TOKEN = process.env.STAFF_TOKEN;
const EMAIL = process.env.EMAIL ?? "demo.client@example.com";
const PASSWORD = process.env.PASSWORD ?? "demo-passphrase";
const PROJECT = process.env.PROJECT ?? "31";
mkdirSync(OUT, { recursive: true });

if (!STAFF_TOKEN) throw new Error("STAFF_TOKEN is required");

const login = await fetch(`${API}/client/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const { token: CLIENT_TOKEN } = await login.json();
if (!CLIENT_TOKEN) throw new Error("client login failed — check EMAIL/PASSWORD");

// A real 1x1 JPEG: the endpoint validates by mime, so a renamed text file is
// rejected exactly as it should be and would prove nothing about the UI.
const ID_PHOTO = join(tmpdir(), "national-id-front.jpg");
writeFileSync(
  ID_PHOTO,
  Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
      "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
      "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  ),
);

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const problems = [];

async function context({ theme = "light", isMobile = false, tokens = {} } = {}) {
  const ctx = await browser.newContext({
    viewport: isMobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 },
    colorScheme: theme,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: isMobile ? 2 : 1,
  });
  await ctx.addInitScript(
    ([entries, s]) => {
      for (const [k, v] of entries) if (v) localStorage.setItem(k, v);
      localStorage.setItem("theme", s);
    },
    [Object.entries(tokens), theme],
  );
  ctx._mobile = isMobile;
  return ctx;
}

async function open(ctx, path, { wait = 2200 } = {}) {
  const page = await ctx.newPage();
  page._errors = [];
  page.on("pageerror", (e) => !/WebSocket|Pusher|reverb/i.test(e.message) && page._errors.push(e.message));
  // Reverb is not part of this check; its absence is dev noise, not a defect.
  const noise = (text) => /WebSocket|Pusher|reverb/i.test(text);
  page.on("console", (m) => m.type() === "error" && !noise(m.text()) && page._errors.push(m.text()));
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
  return page;
}

async function shoot(page, label, { expect } = {}) {
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: !page.context()._mobile });
  let found = "        ";
  if (expect) {
    found = (await page.getByText(expect).count()) > 0 ? "ok      " : "MISSING ";
    if (found.trim() === "MISSING") problems.push(`${label}: "${expect}" not found`);
  }
  if (page._errors.length) problems.push(`${label}: ${page._errors[0].slice(0, 90)}`);
  console.log(
    `${label.padEnd(30)} ${found} ${page._errors.length ? "ERR: " + page._errors[0].slice(0, 60) : "no console errors"}`,
  );
}

// ── 1. The office: the board flags the project, the card lists the ask ────────
for (const theme of ["light", "dark"]) {
  const ctx = await context({ theme, tokens: { bahr_token: STAFF_TOKEN } });

  const list = await open(ctx, "/projects");
  await shoot(list, `staff-projects-list-${theme}`, { expect: "مستند مطلوب" });

  const detail = await open(ctx, `/projects/${PROJECT}`);
  await shoot(detail, `staff-project-detail-${theme}`, { expect: "مستندات مطلوبة من العميل" });

  await ctx.close();
}

// ── 2. The office: the work file's row, and the ask dialog ───────────────────
{
  const ctx = await context({ tokens: { bahr_token: STAFF_TOKEN } });
  const page = await open(ctx, `/projects/${PROJECT}`);

  // While an ask is open the row says so and offers no second ask — the button
  // is deliberately absent, which is what this asserts.
  await shoot(page, "staff-file-row-waiting", { expect: "بانتظار إثبات هوية" });
  const perFile = await page.getByTitle("طلب مستند من العميل لهذا الملف").count();
  console.log(
    `per-file ask button            ${perFile === 0 ? "hidden while open ok" : "SHOWN — should be hidden"}`,
  );
  if (perFile !== 0) problems.push("per-file ask button still offered while a request is open");

  await page.getByRole("button", { name: "طلب مستند", exact: true }).first().click();
  await page.waitForTimeout(900);
  await shoot(page, "staff-ask-dialog", { expect: "عن أي ملف؟" });
  await ctx.close();
}

// ── 3. The client: the ask on their list, at the top of their project, then
//      the upload ─────────────────────────────────────────────────────────────
{
  const ctx = await context({ tokens: { bahr_client_token: CLIENT_TOKEN } });
  const page = await open(ctx, "/account/projects");
  await shoot(page, "client-projects-list", { expect: "مستند مطلوب منك" });
  await ctx.close();
}

for (const theme of ["light", "dark"]) {
  const ctx = await context({ theme, tokens: { bahr_client_token: CLIENT_TOKEN } });
  const page = await open(ctx, `/account/projects/${PROJECT}`);
  await shoot(page, `client-project-pending-${theme}`, { expect: "مستندات مطلوبة منك" });
  await ctx.close();
}

{
  const ctx = await context({ isMobile: true, tokens: { bahr_client_token: CLIENT_TOKEN } });
  const page = await open(ctx, `/account/projects/${PROJECT}`);
  await shoot(page, "client-project-pending-mobile", { expect: "رفع المستند" });
  await ctx.close();
}

// The upload itself, through the real form.
{
  const ctx = await context({ tokens: { bahr_client_token: CLIENT_TOKEN } });
  const page = await open(ctx, `/account/projects/${PROJECT}`);
  await page.locator('input[type="file"]').first().setInputFiles(ID_PHOTO);
  await page.waitForTimeout(3000);
  await shoot(page, "client-project-supplied", { expect: "وصلنا" });
  await ctx.close();
}

// ── 4. Back to the office: the badge is gone, the file is on the project ──────
{
  const ctx = await context({ tokens: { bahr_token: STAFF_TOKEN } });
  const page = await open(ctx, `/projects/${PROJECT}`);
  await shoot(page, "staff-project-answered", { expect: "رفعه العميل" });
  await ctx.close();
}

// ── 5. The wrong file: the office asks again, the client sees why ─────────────
{
  const ctx = await context({ tokens: { bahr_token: STAFF_TOKEN } });
  const page = await open(ctx, `/projects/${PROJECT}`);

  await page.getByRole("button", { name: "طلب نسخة أخرى" }).first().click();
  await page.waitForTimeout(800);
  await shoot(page, "staff-ask-again-dialog", { expect: "سبب الرفض" });

  await page.locator("#prompt-input").fill("الصورة غير واضحة، من فضلك أعد التصوير في إضاءة أفضل.");
  await page.getByRole("button", { name: "أرسل الطلب" }).click();
  await page.waitForTimeout(2500);
  await shoot(page, "staff-superseded", { expect: "نسخ سابقة مرفوضة" });
  await ctx.close();
}

{
  const ctx = await context({ tokens: { bahr_client_token: CLIENT_TOKEN } });
  const page = await open(ctx, `/account/projects/${PROJECT}`);
  await shoot(page, "client-asked-again", { expect: "مطلوب نسخة أخرى" });

  // The client answers properly this time.
  await page.locator('input[type="file"]').first().setInputFiles(ID_PHOTO);
  await page.waitForTimeout(3000);
  await shoot(page, "client-replaced", { expect: "وصلنا" });
  await ctx.close();
}

// ── 6. The client's own fix: delete the wrong upload, the box comes back ──────
{
  const ctx = await context({ tokens: { bahr_client_token: CLIENT_TOKEN } });
  const page = await open(ctx, `/account/projects/${PROJECT}`);

  await page.getByTitle("حذف ورفع نسخة أخرى").first().click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "حذف", exact: true }).last().click();
  await page.waitForTimeout(2500);
  await shoot(page, "client-after-delete", { expect: "رفع المستند" });
  await ctx.close();
}

await browser.close();
console.log(
  problems.length ? `\n${problems.length} PROBLEM(S):\n- ${problems.join("\n- ")}` : "\nAll checks clean.",
);
