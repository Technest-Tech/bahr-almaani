/**
 * Visual check for the two deletion requests of 2026-09-13.
 *
 *   1. A translator corrects a delivery before the PM opens review: swaps a wrong
 *      file, takes out an extra one, and loses the option the moment review opens.
 *   2. A PM deletes a project nobody claimed, and cannot delete one that was.
 *
 * Builds its own projects through the API, so it needs only the dev logins:
 *
 *   BASE=http://localhost:3000 API=http://localhost:8000/api/v1 \
 *   SHOTS=/tmp/shots node ui-delivery-corrections.mjs
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
const OUT = process.env.SHOTS ?? "delivery-correction-shots";
const PASSWORD = process.env.PASSWORD ?? "password";
mkdirSync(OUT, { recursive: true });

async function call(token, path, { method = "GET", json, form } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
    body: json ? JSON.stringify(json) : form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${body.message ?? ""}`);
  return body;
}

// Login is throttled to 5 a minute; a re-run straight after another one waits it out.
async function staffLogin(email) {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await call(null, "/auth/login", { method: "POST", json: { email, password: PASSWORD } }))
        .token;
    } catch (err) {
      if (!String(err.message).includes("429") || attempt === 6) throw err;
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
}

const PM = await staffLogin("pm@bahr.local");

// Whichever dev translator is free — the portal allows one file in hand at a time.
let TRANSLATOR = null;
for (const email of ["translator1@bahr.local", "translator2@bahr.local"]) {
  const token = await staffLogin(email);
  if ((await call(token, "/portal/current")).data === null) {
    TRANSLATOR = token;
    break;
  }
}
if (!TRANSLATOR) throw new Error("every dev translator already holds a file");

const languages = (await call(PM, "/languages")).data;
const idOf = (code) => languages.find((l) => l.code === code).id;

function textFile(name, content) {
  return new File([content], name, { type: "text/plain" });
}

async function draft(title) {
  const project = (
    await call(PM, "/projects", {
      method: "POST",
      json: {
        title,
        source_language_id: idOf("en"),
        target_language_id: idOf("ar"),
        service_type: "certified",
        priority: "normal",
        deadline_at: new Date(Date.now() + 3 * 86400e3).toISOString(),
      },
    })
  ).data;

  const form = new FormData();
  form.append("files[]", textFile("birth-certificate.txt", "Birth certificate of the holder"));
  form.append("category", "source");
  await call(PM, `/projects/${project.id}/files`, { method: "POST", form });

  return project;
}

// A delivered project with two files, one of them wrong and one extra.
const delivered = await draft("شهادة ميلاد — تصحيح التسليم");
await call(PM, `/projects/${delivered.id}/publish`, { method: "POST" });
await call(TRANSLATOR, `/portal/claim/${delivered.id}`, { method: "POST" });
{
  const form = new FormData();
  form.append("files[]", textFile("birth-certificate-OLD-DRAFT.txt", "شهادة ميلاد مسودة قديمة"));
  form.append("files[]", textFile("my-notes-not-for-client.txt", "ملاحظات شخصية"));
  await call(TRANSLATOR, "/portal/deliver", { method: "POST", form });
}

const FIXED = join(tmpdir(), "birth-certificate-FINAL.txt");
writeFileSync(FIXED, "شهادة ميلاد — الترجمة النهائية المصححة");

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const problems = [];

async function context({ theme = "light", isMobile = false, token }) {
  const ctx = await browser.newContext({
    viewport: isMobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 },
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
    [token, theme],
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

async function shoot(page, label, { expect, absent } = {}) {
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: !page.context()._mobile });
  let verdict = "        ";
  if (expect) {
    verdict = (await page.getByText(expect).count()) > 0 ? "ok      " : "MISSING ";
    if (verdict.trim() === "MISSING") problems.push(`${label}: "${expect}" not found`);
  }
  if (absent && (await page.getByText(absent).count()) > 0) {
    verdict = "PRESENT ";
    problems.push(`${label}: "${absent}" should be gone`);
  }
  if (page._errors.length) problems.push(`${label}: ${page._errors[0].slice(0, 90)}`);
  console.log(
    `${label.padEnd(34)} ${verdict} ${page._errors.length ? "ERR: " + page._errors[0].slice(0, 60) : "no console errors"}`,
  );
}

// ── 1. The translator sees the delivery they can still correct ───────────────
for (const theme of ["light", "dark"]) {
  const ctx = await context({ theme, token: TRANSLATOR });
  const page = await open(ctx, "/portal");
  await shoot(page, `portal-awaiting-${theme}`, { expect: "بانتظار المراجعة" });
  await ctx.close();
}
{
  const ctx = await context({ isMobile: true, token: TRANSLATOR });
  const page = await open(ctx, "/portal");
  await page.getByText("بانتظار المراجعة").first().scrollIntoViewIfNeeded();
  await shoot(page, "portal-awaiting-mobile", { expect: "إضافة ملف نسيته" });
  await ctx.close();
}

// ── 2. Swap the wrong file, then take out the extra one ──────────────────────
// Everything is scoped to this run's card: an earlier run can leave its own delivery
// awaiting review, with the very same file names.
const awaiting = (page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: /بانتظار المراجعة/ }) });
const card = (page) => awaiting(page).locator('[data-slot="card"]').filter({ hasText: delivered.code });
const row = (page, name) => card(page).locator("li").filter({ hasText: name });

{
  const ctx = await context({ token: TRANSLATOR });
  const page = await open(ctx, "/portal");

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    row(page, "birth-certificate-OLD-DRAFT.txt").getByRole("button", { name: "استبدال" }).click(),
  ]);
  await chooser.setFiles(FIXED);
  await page.waitForTimeout(900);
  await shoot(page, "portal-replace-dialog", { expect: "يحلّ الملف الجديد محل القديم" });

  await page.getByRole("dialog").getByRole("button", { name: "استبدال" }).click();
  await page.waitForTimeout(3000);
  await card(page).screenshot({ path: `${OUT}/portal-replaced-card.png` });
  const swapped =
    (await row(page, "birth-certificate-FINAL.txt").count()) === 1 &&
    (await row(page, "birth-certificate-OLD-DRAFT.txt").count()) === 0;
  console.log(`swap replaced the wrong file         ${swapped ? "ok" : "NO"}`);
  if (!swapped) problems.push("the swap did not replace OLD-DRAFT with FINAL");

  await row(page, "my-notes-not-for-client.txt").getByTitle("حذف من التسليم").click();
  await page.waitForTimeout(700);
  await shoot(page, "portal-remove-confirm", { expect: "حذف «my-notes-not-for-client.txt» من التسليم؟" });
  await page.getByRole("alertdialog").getByRole("button", { name: "حذف" }).click();
  await page.waitForTimeout(2500);
  await card(page).screenshot({ path: `${OUT}/portal-one-file-left-card.png` });
  const removed = (await row(page, "my-notes-not-for-client.txt").count()) === 0;
  console.log(`extra file removed                   ${removed ? "ok" : "NO"}`);
  if (!removed) problems.push("the extra file is still in the delivery");

  // One file left: its delete is disabled, the swap is the way out.
  const lastDelete = card(page).getByTitle("لا يمكن حذف آخر ملف — استبدله بالملف الصحيح");
  const disabled = (await lastDelete.count()) === 1 && (await lastDelete.isDisabled());
  console.log(`last file delete disabled            ${disabled ? "ok" : "NOT DISABLED"}`);
  if (!disabled) problems.push("the last file's delete button is not disabled");
  await ctx.close();
}

// ── 3. The PM sees the corrected delivery; no delete on a claimed file ────────
{
  const ctx = await context({ token: PM });
  const page = await open(ctx, `/projects/${delivered.id}`);
  await shoot(page, "pm-corrected-delivery", { expect: "birth-certificate-FINAL.txt" });
  const offered = await page.getByRole("button", { name: "حذف المشروع" }).count();
  console.log(`no delete on a claimed project       ${offered === 0 ? "ok" : "OFFERED"}`);
  if (offered !== 0) problems.push("delete offered on a project a translator claimed");

  await page.getByRole("button", { name: "فتح المراجعة" }).click();
  await page.waitForTimeout(2000);
  await ctx.close();
}

// ── 4. Review opened: the translator's correction window is closed ───────────
{
  const ctx = await context({ token: TRANSLATOR });
  const page = await open(ctx, "/portal");
  await page.screenshot({ path: `${OUT}/portal-after-review-opened.png`, fullPage: true });
  const gone = (await card(page).count()) === 0;
  console.log(`card gone once review opened         ${gone ? "ok" : "STILL THERE"}`);
  if (!gone) problems.push("the delivery is still correctable after the review opened");
  if (page._errors.length) problems.push(`portal-after-review-opened: ${page._errors[0].slice(0, 90)}`);
  await ctx.close();
}

// ── 5. The PM deletes a draft entered by mistake ─────────────────────────────
const mistake = await draft("مشروع مكرر بالخطأ");
for (const theme of ["light", "dark"]) {
  const ctx = await context({ theme, token: PM });
  const page = await open(ctx, `/projects/${mistake.id}`);
  await shoot(page, `pm-draft-with-delete-${theme}`, { expect: "حذف المشروع" });
  await ctx.close();
}
{
  const ctx = await context({ token: PM });
  const page = await open(ctx, `/projects/${mistake.id}`);
  await page.getByRole("button", { name: "حذف المشروع" }).click();
  await page.waitForTimeout(700);
  await shoot(page, "pm-delete-confirm", { expect: "مناسب للمشاريع المكررة" });

  await page.getByRole("alertdialog").getByRole("button", { name: "حذف المشروع" }).click();
  await page.waitForURL(`${BASE}/projects`, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const landed = new URL(page.url()).pathname === "/projects";
  console.log(`redirected to the projects list      ${landed ? "ok" : "NO — " + page.url()}`);
  if (!landed) problems.push(`after delete the page stayed on ${page.url()}`);
  await shoot(page, "pm-after-delete", { absent: "مشروع مكرر بالخطأ" });
  await ctx.close();
}

await browser.close();

console.log(problems.length ? `\n${problems.length} problem(s):\n- ${problems.join("\n- ")}` : "\nAll checks passed.");
process.exitCode = problems.length ? 1 : 0;
