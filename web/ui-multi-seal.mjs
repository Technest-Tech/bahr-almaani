/**
 * Several seals on one document (2026-09-19): the PM picks two seals at approval,
 * places the second one on a file while the first shows faintly where it will land,
 * approves, and the certified PDF carries both.
 *
 * Needs an in_review project (PROJECT=<id> to pick one) and at least two active seals
 * (SEALS="name,name" to pick them).
 * Approves for real, so run it against data you can spend. API / WEB / CHROME
 * override the defaults for a stack on other ports.
 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";

const EXECUTABLE =
  process.env.CHROME ??
  `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const API = process.env.API ?? "http://localhost:8000/api/v1";
const WEB = process.env.WEB ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "rt-shots";
mkdirSync(OUT, { recursive: true });

const login = async (email) =>
  (await (await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  })).json()).token;

const token = await login("pm@bahr.local");
const get = async (path) =>
  (await fetch(`${API}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  })).json();

const projectId = process.env.PROJECT ?? (await get("/projects?status=in_review")).data?.[0]?.id;
if (!projectId) throw new Error("no in_review project");

// LETTERHEAD="name" and SEALS="name,name" pick specific templates; otherwise the first ones.
const templates = (await get("/letterheads?active=1")).data;
const named = (kind, name) => templates.find((t) => t.kind === kind && (!name || t.name === name));
const letterhead = named("letterhead", process.env.LETTERHEAD);
const [first, second] = process.env.SEALS
  ? process.env.SEALS.split(",").map((name) => named("stamp", name))
  : templates.filter((t) => t.kind === "stamp");
if (!letterhead || !second) throw new Error("needs a letterhead and two active seals");

const errors = [];
const browser = await chromium.launch({ executablePath: EXECUTABLE });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);

try {
  await page.goto(`${WEB}/projects/${projectId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "اعتماد وإنهاء" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("الأختام (اختياري)").waitFor();

  // Seals are picked by clicking their cards; the second click adds, not replaces.
  await dialog.locator("button", { hasText: letterhead.name }).first().click();
  await dialog.locator("button[aria-pressed]", { hasText: first.name }).first().click();
  await dialog.locator("button[aria-pressed]", { hasText: second.name }).first().click();
  const pressed = await dialog.locator('button[aria-pressed="true"]').count();
  console.log(`cards pressed (letterhead + 2 seals) = ${pressed} (expected 3)`);
  const perSeal = await dialog.getByRole("button", { name: /^ضبط موضع / }).count();
  console.log(`position buttons = ${perSeal} (expected 2 per file)`);
  await page.screenshot({ path: `${OUT}/multi-seal-approve.png` });

  // Place the second seal; the first must show faintly where it will land.
  await dialog.getByRole("button", { name: `ضبط موضع ${second.name}` }).first().click();
  const seal = page.locator('[role="application"]');
  await seal.waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  const faint = await page.locator(`img[title="${first.name}"]`).count();
  console.log(`faint other seal shown = ${faint > 0}`);

  const box = await seal.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 160, { steps: 10 });
  await page.mouse.up();
  await page.screenshot({ path: `${OUT}/multi-seal-position.png` });
  await page.getByRole("button", { name: "تثبيت الموضع" }).click();

  const placed = await dialog.getByRole("button", { name: `${second.name}: مضبوط` }).count();
  console.log(`second seal marked placed = ${placed > 0}`);

  await dialog.getByRole("button", { name: "اعتماد وإنهاء" }).click();
  await page.waitForTimeout(6000);
  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/multi-seal-project.png`, fullPage: true });

  const after = (await get(`/projects/${projectId}`)).data;
  console.log(
    `status=${after.status} seals=${after.stamps.map((s) => s.name).join(" + ")} ` +
      `finals=${after.files.filter((f) => f.category === "final").length}`,
  );

  const pdf = await fetch(`${API}/projects/${projectId}/final-file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (pdf.ok) {
    writeFileSync(`${OUT}/multi-seal-final.pdf`, Buffer.from(await pdf.arrayBuffer()));
    console.log(`final saved to ${OUT}/multi-seal-final.pdf`);
  }
} finally {
  await browser.close();
}

console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
