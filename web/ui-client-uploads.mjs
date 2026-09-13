/**
 * Visual check for files a client sends to their project without being asked
 * (client request 2026-09-13): several at once, then again later, then one removed —
 * and the office seeing them on the project, marked as the client's.
 *
 *   BASE=http://localhost:3000 API=http://localhost:8000/api/v1 \
 *   EMAIL=… PASSWORD=… PROJECT=31 SHOTS=/tmp/shots node ui-client-uploads.mjs
 *
 * Removes what it uploaded when it finishes, so it can be run repeatedly.
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
const OUT = process.env.SHOTS ?? "client-upload-shots";
const EMAIL = process.env.EMAIL ?? "demo.client@example.com";
const PASSWORD = process.env.PASSWORD ?? "demo-passphrase";
const STAFF_EMAIL = process.env.STAFF_EMAIL ?? "pm@bahr.local";
const STAFF_PASSWORD = process.env.STAFF_PASSWORD ?? "password";
const PROJECT = process.env.PROJECT ?? "31";
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

// Real JPEG bytes: the endpoint validates by mime, so a renamed text file would be
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
const PASSPORT = file("ui-check-passport.jpg");
const RESIDENCE = file("ui-check-residence-card.jpg");
const LATER = file("ui-check-sent-later.jpg");
const OURS = ["ui-check-passport.jpg", "ui-check-residence-card.jpg", "ui-check-sent-later.jpg"];

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
  console.log(`${label.padEnd(40)} ${ok ? "ok" : "NO " + detail}`);
  if (!ok) problems.push(`${label} ${detail}`);
}

async function shoot(page, label) {
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: !page.context()._mobile });
  if (page._errors.length) problems.push(`${label}: ${page._errors[0].slice(0, 90)}`);
  console.log(`${label.padEnd(40)} ${page._errors.length ? "ERR: " + page._errors[0].slice(0, 60) : "no console errors"}`);
}

const panel = (page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "مستندات أرسلتها" }) });

// ── 1. The client's page, before anything is sent ─────────────────────────────
for (const theme of ["light", "dark"]) {
  const ctx = await context({ theme, tokens: { bahr_client_token: CLIENT_TOKEN } });
  const page = await open(ctx, `/account/projects/${PROJECT}`);
  check(`upload button offered (${theme})`, (await panel(page).getByRole("button", { name: "رفع ملفات" }).count()) === 1);
  await shoot(page, `client-project-${theme}`);
  await ctx.close();
}

// ── 2. Two files at once, then one more later, then remove one ───────────────
{
  const ctx = await context({ tokens: { bahr_client_token: CLIENT_TOKEN } });
  const page = await open(ctx, `/account/projects/${PROJECT}`);

  const upload = async (paths) => {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      panel(page).getByRole("button", { name: "رفع ملفات" }).click(),
    ]);
    await chooser.setFiles(paths);
    await page.waitForTimeout(3500);
  };

  await upload([PASSPORT, RESIDENCE]);
  check("two files sent at once", (await panel(page).getByText(/ui-check-(passport|residence-card)/).count()) === 2);
  await panel(page).screenshot({ path: `${OUT}/client-panel-two-sent.png` });

  await upload([LATER]);
  check("a second upload is still possible", (await panel(page).getByText("ui-check-sent-later.jpg").count()) === 1);
  await shoot(page, "client-project-three-sent");

  await panel(page).getByRole("button", { name: "حذف ui-check-residence-card.jpg" }).click();
  await page.waitForTimeout(700);
  await shoot(page, "client-remove-confirm");
  await page.getByRole("alertdialog").getByRole("button", { name: "حذف" }).click();
  await page.waitForTimeout(2500);
  check("the removed file is gone", (await panel(page).getByText("ui-check-residence-card.jpg").count()) === 0);
  await panel(page).screenshot({ path: `${OUT}/client-panel-after-remove.png` });
  await ctx.close();
}

{
  const ctx = await context({ isMobile: true, tokens: { bahr_client_token: CLIENT_TOKEN } });
  const page = await open(ctx, `/account/projects/${PROJECT}`);
  await panel(page).scrollIntoViewIfNeeded();
  await shoot(page, "client-project-mobile");
  await ctx.close();
}

// ── 3. The office: the files on the project, marked as the client's ──────────
{
  const ctx = await context({ tokens: { bahr_token: STAFF_TOKEN } });
  const page = await open(ctx, `/projects/${PROJECT}`);
  const supporting = page.locator('[data-slot="card"]').filter({ hasText: "مستندات داعمة" });
  const rows = supporting.locator("li").filter({ hasText: "ui-check-" });
  check("office sees the client's files", (await rows.count()) === 2);
  check("marked as from the client", (await rows.filter({ hasText: "من العميل" }).count()) === 2);
  check("office can remove them on a live project", (await rows.getByTitle("حذف").count()) === 2);
  await supporting.scrollIntoViewIfNeeded();
  await shoot(page, "office-project");
  await ctx.close();
}

{
  const response = await fetch(`${API}/notifications`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${STAFF_TOKEN}` },
  });
  const { data } = await response.json();
  check("office notified of an unprompted upload", data.some((n) => n.data.message.includes("دون طلب")));
}

await browser.close();

// ── Leave the demo project as it was ─────────────────────────────────────────
const project = await fetch(`${API}/client/projects/${PROJECT}`, {
  headers: { Accept: "application/json", Authorization: `Bearer ${CLIENT_TOKEN}` },
}).then((r) => r.json());
for (const leftover of project.data.files.filter((f) => OURS.includes(f.original_name))) {
  await fetch(`${API}/client/projects/${PROJECT}/files/${leftover.id}`, {
    method: "DELETE",
    headers: { Accept: "application/json", Authorization: `Bearer ${CLIENT_TOKEN}` },
  });
}

console.log(problems.length ? `\n${problems.length} problem(s):\n- ${problems.join("\n- ")}` : "\nAll checks passed.");
process.exitCode = problems.length ? 1 : 0;
