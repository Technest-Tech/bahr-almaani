/**
 * Visual check for the client area on the website (M15).
 *
 * Drives it the way a client does: the landing header's login button, the sign-in
 * screen, the account overview, projects, a project file, invoices and the profile
 * form — light, dark and mobile. Then the office side: the client file page.
 *
 *   BASE=http://localhost:3000 API=http://localhost:8000/api/v1 \
 *   EMAIL=… PASSWORD=… STAFF_TOKEN=… CLIENT_ID=4 node ui-client-portal.mjs
 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { globSync, mkdirSync } from "node:fs";

// The cached build's layout and revision move with playwright-core, so the shell
// is discovered rather than hard-coded — the older ui-*.mjs scripts pin a
// revision that no longer exists locally.
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
const OUT = process.env.SHOTS ?? "client-portal-shots";
const EMAIL = process.env.EMAIL ?? "demo.client@example.com";
const PASSWORD = process.env.PASSWORD ?? "demo-passphrase";
const STAFF_TOKEN = process.env.STAFF_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID ?? "4";
mkdirSync(OUT, { recursive: true });

const login = await fetch(`${API}/client/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const { token: CLIENT_TOKEN } = await login.json();
if (!CLIENT_TOKEN) throw new Error("client login failed — check EMAIL/PASSWORD");

const browser = await chromium.launch({ executablePath: EXECUTABLE });

async function context({ theme, isMobile = false, tokens = {} }) {
  const ctx = await browser.newContext({
    viewport: isMobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
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
  return ctx;
}

const problems = [];

async function shoot(ctx, label, path, { wait = 1800, expect } = {}) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: !ctx._mobile });

  let found = "";
  if (expect) {
    found = (await page.getByText(expect).count()) > 0 ? "ok" : "MISSING";
    if (found === "MISSING") problems.push(`${label}: expected text "${expect}" not found`);
  }
  if (errors.length) problems.push(`${label}: ${errors[0].slice(0, 90)}`);
  console.log(
    `${label.padEnd(26)} url=${page.url().replace(BASE, "").padEnd(28)} ${expect ? found.padEnd(8) : "        "} ${errors.length ? "ERR: " + errors[0].slice(0, 70) : "no console errors"}`,
  );
  return page;
}

// 1. Anonymous: the landing header must offer the *client* door, not the staff one.
{
  const ctx = await context({ theme: "light" });
  const page = await shoot(ctx, "landing-anon", "/", { expect: "تسجيل الدخول" });
  await page.getByRole("link", { name: "تسجيل الدخول" }).first().click();
  await page.waitForTimeout(1200);
  const landed = new URL(page.url()).pathname;
  console.log(`header login click        -> ${landed} ${landed === "/account/login" ? "ok" : "WRONG"}`);
  if (landed !== "/account/login") problems.push(`header login went to ${landed}`);
  await page.screenshot({ path: `${OUT}/client-login.png`, fullPage: true });
  await shoot(ctx, "client-register", "/account/register", { expect: "إنشاء حساب عميل" });
  await ctx.close();
}

// 2. Signed in as a client.
for (const theme of ["light", "dark"]) {
  const ctx = await context({ theme, tokens: { bahr_client_token: CLIENT_TOKEN } });
  await shoot(ctx, `account-overview-${theme}`, "/account", { expect: "إجمالي الصفحات" });
  await shoot(ctx, `account-projects-${theme}`, "/account/projects", { expect: "قيد التنفيذ" });
  await shoot(ctx, `account-invoices-${theme}`, "/account/invoices");
  await shoot(ctx, `account-profile-${theme}`, "/account/profile", { expect: "بيانات التواصل" });
  if (theme === "light") {
    // Open the first project from the list to reach the file/download screen.
    const page = await ctx.newPage();
    await page.goto(`${BASE}/account/projects`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.locator('a[href^="/account/projects/"]').first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/account-project-detail.png`, fullPage: true });
    const stage = await page.getByText("الملفات المعتمدة").count();
    console.log(`project detail            files section=${stage ? "ok" : "MISSING"}`);
    if (!stage) problems.push("project detail: files section missing");
  }
  await ctx.close();
}

// 3. Mobile.
{
  const ctx = await context({ theme: "light", isMobile: true, tokens: { bahr_client_token: CLIENT_TOKEN } });
  ctx._mobile = true;
  await shoot(ctx, "account-overview-mobile", "/account", { expect: "إجمالي الصفحات" });
  await shoot(ctx, "account-projects-mobile", "/account/projects");
  await ctx.close();
}

// 4. The office side: the client file the admin opens.
if (STAFF_TOKEN) {
  for (const theme of ["light", "dark"]) {
    const ctx = await context({ theme, tokens: { bahr_token: STAFF_TOKEN } });
    await shoot(ctx, `admin-clients-${theme}`, "/clients", { expect: "حساب الموقع" });
    await shoot(ctx, `admin-client-file-${theme}`, `/clients/${CLIENT_ID}`, {
      expect: "حساب الموقع",
      wait: 2500,
    });
    await ctx.close();
  }
} else {
  console.log("STAFF_TOKEN not set — skipped the office screens");
}

await browser.close();

console.log(problems.length ? `\n${problems.length} PROBLEM(S):\n- ${problems.join("\n- ")}` : "\nAll checks clean.");
