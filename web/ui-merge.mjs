/**
 * M9b visual check — letterhead content band, merge preview action, final-file
 * download and the merge-failure retry card.
 *
 * Run from `web/` with the dev stack up:
 *   node ui-merge.mjs                       (API on :8000)
 *   API=http://localhost:8001/api/v1 node ui-merge.mjs
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";

const EXECUTABLE = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1148/chrome-mac/headless_shell`;
const WEB = process.env.WEB ?? "http://localhost:3000";
const API = process.env.API ?? "http://localhost:8000/api/v1";
const SHOTS = "rt-shots";

mkdirSync(SHOTS, { recursive: true });

const errors = [];

async function login(context, email) {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  });
  if (!response.ok) throw new Error(`login ${email} → ${response.status}`);
  const { token } = await response.json();

  await context.addInitScript((value) => {
    window.localStorage.setItem("bahr_token", value);
  }, token);

  return token;
}

async function shot(page, name, fullPage = false) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
  console.log(`  shot  ${name}`);
}

const browser = await chromium.launch({ executablePath: EXECUTABLE });

for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
    locale: "ar",
    colorScheme: theme,
  });
  context.on("weberror", (e) => errors.push(`${theme}: ${e.error().message}`));

  const token = await login(context, "admin@bahr.local");
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${theme}: ${m.text()}`));

  // ── letterheads gallery: preview action + content-band summary ──
  await page.goto(`${WEB}/letterheads`, { waitUntil: "networkidle" });
  await shot(page, `merge-letterheads-${theme}`);

  // ── the edit dialog with the content band drawn on the A4 preview ──
  const letterheads = await fetch(`${API}/letterheads`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }).then((r) => r.json());

  // Any banded letterhead will do; some fixtures have deliberately broken assets,
  // so walk the list rather than betting the run on the first match.
  const banded = letterheads.data.filter(
    (t) => t.kind === "letterhead" && (t.placement.content_top_mm ?? 0) > 0,
  );

  let bandShot = false;
  for (const template of banded) {
    try {
      await page.goto(`${WEB}/letterheads`, { waitUntil: "networkidle" });
      const card = page.locator("article").filter({ hasText: template.name }).first();
      await card.getByTitle("تعديل").click({ timeout: 5000 });
      await page.waitForTimeout(1200);
      await shot(page, `merge-content-band-${theme}`);
      await page.keyboard.press("Escape");
      bandShot = true;
      break;
    } catch {
      // try the next one
    }
  }
  if (!bandShot) console.log("  skip  content-band dialog (no usable banded letterhead)");

  // ── a completed project: the final-file download action ──
  const projects = await fetch(`${API}/projects?status=completed&per_page=1`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }).then((r) => r.json());

  if (projects.data?.length) {
    await page.goto(`${WEB}/projects/${projects.data[0].id}`, { waitUntil: "networkidle" });
    await shot(page, `merge-final-file-${theme}`);
  } else {
    console.log("  skip  completed project (none found)");
  }

  // ── an approved project whose merge failed: the retry card ──
  const approved = await fetch(`${API}/projects?status=approved&per_page=20`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }).then((r) => r.json());

  const failed = approved.data?.find((p) => p.merge_error);

  if (failed) {
    await page.goto(`${WEB}/projects/${failed.id}`, { waitUntil: "networkidle" });
    await shot(page, `merge-failure-${theme}`);
  } else {
    console.log("  skip  merge-failure card (no failed merge found)");
  }

  await context.close();
}

await browser.close();

console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join("\n")}` : "\nno console errors");
