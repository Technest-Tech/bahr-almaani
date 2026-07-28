/**
 * End-to-end M9a check: approve an in_review project through the real dialog and
 * confirm the selection lands on the project (needs an in_review project — the
 * scratchpad `prep_review_project.py` creates one).
 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

const EXECUTABLE = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1148/chrome-mac/headless_shell`;
const API = "http://localhost:8000/api/v1";
mkdirSync("rt-shots", { recursive: true });

const login = async (email) =>
  (await (await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  })).json()).token;

const errors = [];
const pmToken = await login("pm@bahr.local");
const get = async (path) =>
  (await (await fetch(`${API}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${pmToken}` },
  })).json());

const target = (await get("/projects?status=in_review")).data?.[0];
if (!target) {
  console.log("!! no in_review project — run prep_review_project.py first");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: EXECUTABLE });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem("bahr_token", t), pmToken);
  await page.goto(`http://localhost:3000/projects/${target.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  await page.getByRole("button", { name: "اعتماد وإنهاء" }).first().click();
  await page.waitForTimeout(1500);

  // Approve must stay blocked until both are picked.
  const dialog = page.getByRole("dialog");
  const approve = dialog.getByRole("button", { name: "اعتماد وإنهاء" });
  console.log(`approve disabled before selection = ${await approve.isDisabled()} (expected true)`);

  await dialog.locator("button", { hasText: "ترويسة بحر المعاني الرسمية" }).first().click();
  await dialog.locator("button", { hasText: "ختم الاعتماد الرسمي" }).first().click();
  await page.waitForTimeout(300);
  console.log(`approve disabled after selection  = ${await approve.isDisabled()} (expected false)`);

  await approve.click();
  await page.waitForTimeout(4000); // finalize job runs on the queue worker
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "rt-shots/project-completed-templates.png", fullPage: true });

  const after = (await get(`/projects/${target.id}`)).data;
  console.log(
    `project ${after.code}: status=${after.status} letterhead=${after.letterhead?.name ?? "—"} ` +
      `stamp=${after.stamp?.name ?? "—"} final_files=${after.files.filter((f) => f.category === "final").length}`,
  );
  await context.close();
} finally {
  await browser.close();
  console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "no console errors");
}
