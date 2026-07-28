/**
 * Capture the screenshots used by docs/guide-*.md, straight from the running app.
 * Writes to ../docs/screenshots/. Light mode, 1440×950, one context per role.
 *
 *   node ui-guides.mjs
 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

const EXECUTABLE = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1148/chrome-mac/headless_shell`;
const API = "http://localhost:8000/api/v1";
const APP = "http://localhost:3000";
const OUT = "../docs/screenshots";
mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({ executablePath: EXECUTABLE });

const login = async (email) =>
  (await (await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  })).json()).token;

async function contextFor(email) {
  const token = await login(email);
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${email}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);
  return { context, page, token };
}

const shot = async (page, name, full = false) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("  ▸", name);
};

const go = async (page, path, wait = 1600) => {
  await page.goto(`${APP}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(wait);
};

/** Best-effort click: a missing element skips the shot instead of failing the run. */
async function tryClick(page, locator, label) {
  try {
    await locator.first().click({ timeout: 4000 });
    await page.waitForTimeout(700);
    return true;
  } catch {
    console.log("  ! skipped:", label);
    return false;
  }
}

try {
  // ── login screen (shared by every guide) ─────────────────────────────────
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await context.newPage();
    await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    await shot(page, "login");
    await context.close();
  }

  // ── admin ────────────────────────────────────────────────────────────────
  {
    console.log("admin@bahr.local");
    const { context, page } = await contextFor("admin@bahr.local");

    await go(page, "/");
    await shot(page, "admin-dashboard");

    await go(page, "/users");
    await shot(page, "admin-users");

    if (await tryClick(page, page.getByRole("button", { name: /مستخدم جديد|إضافة/ }), "user form")) {
      await shot(page, "admin-user-form");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }

    await go(page, "/letterheads");
    await shot(page, "admin-letterheads");

    if (await tryClick(page, page.getByRole("button", { name: /قالب جديد|رفع|إضافة/ }), "letterhead form")) {
      await shot(page, "admin-letterhead-form");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }

    await go(page, "/activity");
    await shot(page, "admin-activity");

    await go(page, "/settings");
    await shot(page, "settings");

    await context.close();
  }

  // ── project manager ──────────────────────────────────────────────────────
  {
    console.log("pm@bahr.local");
    const { context, page } = await contextFor("pm@bahr.local");

    await go(page, "/");
    await shot(page, "pm-dashboard");

    await go(page, "/projects");
    await shot(page, "pm-projects");

    await go(page, "/projects/new");
    await shot(page, "pm-project-new", true);

    await go(page, "/clients");
    await shot(page, "pm-clients");

    // A project awaiting review shows the whole PM toolbox: files, timeline, actions.
    const review = await fetch(`${API}/projects?status=in_review&per_page=1`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${(await login("pm@bahr.local"))}` },
    }).then((r) => r.json());
    const target = review.data?.[0];
    if (target) {
      await go(page, `/projects/${target.id}`, 2200);
      await shot(page, "pm-project-detail", true);

      if (await tryClick(page, page.getByRole("button", { name: /اعتماد|الاعتماد/ }), "approve dialog")) {
        await shot(page, "pm-approve");
        await page.keyboard.press("Escape");
      }
    } else {
      console.log("  ! no in_review project — detail/approve shots skipped");
    }

    await go(page, "/reports", 2400);
    await shot(page, "pm-reports");

    // The bell is captured here because the PM account actually has traffic.
    if (await tryClick(page, page.locator("header button").filter({ has: page.locator("svg.lucide-bell") }), "bell")) {
      await shot(page, "bell");
    }

    await context.close();
  }

  // ── translator ───────────────────────────────────────────────────────────
  {
    console.log("translator1@bahr.local");
    const { context, page } = await contextFor("translator1@bahr.local");

    await go(page, "/portal", 2000);
    await shot(page, "translator-portal");

    // Claim the first available file so the "current task" screen has content.
    const claimed = await tryClick(page, page.getByRole("button", { name: /استلام/ }), "claim");
    if (claimed) {
      await page.waitForTimeout(2000);
      await shot(page, "translator-current", true);

      if (await tryClick(page, page.getByRole("button", { name: /تسليم الترجمة|تسليم التعديل/ }), "deliver dialog")) {
        await shot(page, "translator-deliver");
        await page.keyboard.press("Escape");
      }
    } else {
      // Already holding a file — that screen is the one we want anyway.
      await shot(page, "translator-current", true);
    }

    await context.close();
  }

  console.log("done");
} finally {
  console.log(errors.length ? "CONSOLE ERRORS:\n" + errors.join("\n") : "no console errors");
  await browser.close();
}
