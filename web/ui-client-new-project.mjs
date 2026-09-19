/**
 * Visual check for a client starting a project from their own account
 * (client request 2026-09-19): the button on every tab, the form, the draft on the
 * client's side with its files still changeable, and the office seeing where it
 * came from.
 *
 *   BASE=http://localhost:3000 API=http://localhost:8000/api/v1 \
 *   EMAIL=… PASSWORD=… SHOTS=/tmp/shots node ui-client-new-project.mjs
 *
 * Deletes the project it created when it finishes, so it can be run repeatedly.
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
const OUT = process.env.SHOTS ?? "client-new-project-shots";
const EMAIL = process.env.EMAIL ?? "demo.client@example.com";
const PASSWORD = process.env.PASSWORD ?? "demo-passphrase";
const STAFF_EMAIL = process.env.STAFF_EMAIL ?? "pm@bahr.local";
const STAFF_PASSWORD = process.env.STAFF_PASSWORD ?? "password";
mkdirSync(OUT, { recursive: true });

async function login(path, email, password) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
    });
    // Logins are throttled to 5 a minute; a re-run straight after another waits it out.
    if (response.status === 429 && attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      continue;
    }
    const { token } = await response.json();
    if (!token) throw new Error(`login failed for ${email}`);
    return token;
  }
}

const CLIENT_TOKEN = await login("/client/auth/login", EMAIL, PASSWORD);
const STAFF_TOKEN = await login("/auth/login", STAFF_EMAIL, STAFF_PASSWORD);

// Real JPEG bytes: the endpoint validates the file, so a renamed text file would be
// refused and prove nothing about the screen.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);
const file = (name) => {
  const path = join(tmpdir(), name);
  writeFileSync(path, JPEG);
  return path;
};
const CONTRACT = file("ui-check-contract.jpg");
const ANNEX = file("ui-check-annex.jpg");

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const problems = [];

async function context({ theme = "light", isMobile = false, tokens }) {
  const ctx = await browser.newContext({
    viewport: isMobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 },
    colorScheme: theme,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: isMobile ? 2 : 1,
  });
  await ctx.addInitScript(
    ([entries, s]) => {
      for (const [k, v] of entries) localStorage.setItem(k, v);
      localStorage.setItem("theme", s);
    },
    [Object.entries(tokens), theme],
  );
  ctx._mobile = isMobile;
  return ctx;
}

async function open(ctx, path, { wait = 2500 } = {}) {
  const page = await ctx.newPage();
  page._errors = [];
  const noise = (text) => /WebSocket|Pusher|reverb/i.test(text);
  page.on("pageerror", (e) => !noise(e.message) && page._errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !noise(m.text()) && page._errors.push(m.text()));
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
  return page;
}

function check(label, ok, detail = "") {
  console.log(`${label.padEnd(44)} ${ok ? "ok" : "NO " + detail}`);
  if (!ok) problems.push(`${label} ${detail}`);
}

async function shoot(page, label) {
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: !page.context()._mobile });
  if (page._errors.length) problems.push(`${label}: ${page._errors[0].slice(0, 90)}`);
  console.log(`${label.padEnd(44)} ${page._errors.length ? "ERR: " + page._errors[0].slice(0, 60) : "no console errors"}`);
}

const client = { bahr_client_token: CLIENT_TOKEN };
let projectId = null;

// ── 1. The way in: on every tab of the account, and in the site header ───────
for (const theme of ["light", "dark"]) {
  const ctx = await context({ theme, tokens: client });
  const page = await open(ctx, "/account");
  check(`new-project button on the account (${theme})`, (await page.getByRole("link", { name: "مشروع جديد" }).count()) >= 1);
  await shoot(page, `account-${theme}`);
  await ctx.close();
}

{
  const ctx = await context({ tokens: client });
  const page = await open(ctx, "/request");
  check("quote form points a client to their account", (await page.getByText("أضف مشروعك مباشرة من حسابك").count()) === 1);
  const header = page.locator("header");
  check("header CTA is the new project", (await header.getByRole("link", { name: "مشروع جديد" }).count()) === 1);
  await page.screenshot({ path: `${OUT}/request-signed-in.png` });
  await ctx.close();
}

// ── 2. The form: empty, refused, then filled and sent ────────────────────────
for (const theme of ["light", "dark"]) {
  const ctx = await context({ theme, tokens: client });
  const page = await open(ctx, "/account/projects/new");
  await shoot(page, `new-project-${theme}`);
  await ctx.close();
}

{
  const ctx = await context({ isMobile: true, tokens: client });
  const page = await open(ctx, "/account/projects/new");
  await shoot(page, "new-project-mobile");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check("no sideways scroll on a phone", !overflow);
  await ctx.close();
}

{
  const ctx = await context({ tokens: client });
  const page = await open(ctx, "/account/projects/new");

  await page.getByRole("button", { name: "إرسال المشروع" }).click();
  await page.waitForTimeout(600);
  check("an empty form is refused before upload", (await page.getByText("أرفق مستنداً واحداً على الأقل").count()) === 1);
  await shoot(page, "new-project-refused");

  const pick = async (id, name) => {
    await page.locator(`#${id}`).click();
    await page.getByRole("option", { name, exact: true }).first().click();
  };
  await pick("p-source", "العربية");
  await pick("p-target", "الإنجليزية");

  await page.locator("#p-deadline").click();
  await page.locator("td[data-day]:not([data-disabled]) button").last().click();
  await page.keyboard.press("Escape");

  await page.locator("#p-pages").fill("2");
  await page.getByRole("button", { name: /عاجل/ }).click();
  await page.locator("#p-notes").fill("مطلوب للسفارة الألمانية.");
  await page.locator('input[type="file"]').setInputFiles([CONTRACT, ANNEX]);
  await page.waitForTimeout(400);
  await shoot(page, "new-project-filled");

  await page.getByRole("button", { name: "إرسال المشروع" }).click();
  // A client-side push, not a page load — watch the path rather than a load event.
  await page
    .waitForFunction(() => /\/account\/projects\/\d+$/.test(location.pathname), null, { timeout: 30_000 })
    .catch(async (error) => {
      await shoot(page, "new-project-stuck");
      throw error;
    });
  await page.waitForTimeout(2500);
  projectId = page.url().match(/(\d+)$/)[1];

  check("lands on the new project", Boolean(projectId));
  check("shown as awaiting the office", (await page.getByText("بانتظار مراجعة المكتب").count()) >= 1);
  check("named after the first file", (await page.getByRole("heading", { name: "ui-check-contract" }).count()) === 1);
  check("the date reads as the client's ask", (await page.getByText("الموعد المطلوب").count()) === 1);
  const sources = page.locator("section").filter({ has: page.getByRole("heading", { name: "الملفات المطلوب ترجمتها" }) });
  check("both files listed to translate", (await sources.locator("li").count()) === 2);
  await shoot(page, "client-draft");

  // Still theirs to change: one more, then one out.
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    sources.getByRole("button", { name: "إضافة ملفات" }).click(),
  ]);
  await chooser.setFiles(file("ui-check-page-3.jpg"));
  await page.waitForTimeout(3500);
  check("a page added afterwards", (await sources.locator("li").count()) === 3);

  await sources.getByRole("button", { name: "حذف ui-check-annex.jpg" }).click();
  await page.waitForTimeout(700);
  await shoot(page, "client-draft-remove-confirm");
  await page.getByRole("alertdialog").getByRole("button", { name: "حذف" }).click();
  await page.waitForTimeout(2500);
  check("the removed file is gone", (await sources.getByText("ui-check-annex.jpg").count()) === 0);
  // Work files, not supporting documents: that panel stays empty.
  const supporting = page.locator("section").filter({ has: page.getByRole("heading", { name: "مستندات أرسلتها" }) });
  check("nothing listed as a supporting document", (await supporting.locator("li").count()) === 0);
  await shoot(page, "client-draft-after-changes");
  await ctx.close();
}

{
  const ctx = await context({ tokens: client });
  const page = await open(ctx, "/account/projects");
  await page.getByRole("button", { name: "بانتظار مراجعة المكتب" }).click();
  await page.waitForTimeout(1500);
  check("filter shows the submitted project", (await page.getByText("ui-check-contract").count()) === 1);
  await shoot(page, "client-list-submitted");
  await ctx.close();
}

// ── 3. The office: a draft marked as the client's, waiting to be published ───
{
  const ctx = await context({ tokens: { bahr_token: STAFF_TOKEN } });
  const page = await open(ctx, "/projects");
  const row = page.locator("tr").filter({ hasText: "ui-check-contract" });
  check("office list marks it as the client's", (await row.getByText("من العميل").count()) === 1);
  await shoot(page, "office-list");

  const detail = await open(ctx, `/projects/${projectId}`);
  check("office project marks it as the client's", (await detail.getByText("أضافه العميل من حسابه").count()) === 1);
  check("office can publish it", (await detail.getByRole("button", { name: "نشر للمترجمين" }).count()) === 1);
  await shoot(detail, "office-project");
  await ctx.close();
}

{
  const response = await fetch(`${API}/notifications`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${STAFF_TOKEN}` },
  });
  const { data } = await response.json();
  check("office notified of the new project", data.some((n) => n.data.type === "client_project_submitted"));
}

await browser.close();

// ── Leave the demo data as it was ────────────────────────────────────────────
if (projectId) {
  const response = await fetch(`${API}/projects/${projectId}`, {
    method: "DELETE",
    headers: { Accept: "application/json", Authorization: `Bearer ${STAFF_TOKEN}` },
  });
  check("cleanup: test project deleted", response.ok, String(response.status));
}

console.log(problems.length ? `\n${problems.length} problem(s):\n- ${problems.join("\n- ")}` : "\nall checks passed");
process.exit(problems.length ? 1 : 0);
