/**
 * Polish batch check: server-side sorting on clients + users, the archive action
 * on a completed project, and the command palette against Meilisearch typos.
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
const token = await login("admin@bahr.local");
const browser = await chromium.launch({ executablePath: EXECUTABLE });

async function open(path, dark = false) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: dark ? "dark" : "light",
  });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`[${path}] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[${path}] ${e.message}`));
  page.on("request", (r) => {
    const url = r.url();
    if (url.includes("sort=")) console.log("   request:", url.replace(API, ""));
  });
  await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);
  await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  return { context, page };
}

try {
  // 1) Clients: sorting must hit the server and reorder the whole set
  {
    const { context, page } = await open("/clients");
    const first = () => page.locator("tbody tr td:first-child").first().innerText();
    console.log("clients default first:", (await first()).trim());
    await page.getByRole("button", { name: "العميل" }).click();
    await page.waitForTimeout(1200);
    console.log("clients name-asc first:", (await first()).trim());
    await page.getByRole("button", { name: "المشاريع" }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: "rt-shots/clients-sorted.png" });
    await context.close();
  }

  // 2) Users: same
  {
    const { context, page } = await open("/users");
    await page.getByRole("button", { name: "المستخدم" }).click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "آخر دخول" }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: "rt-shots/users-sorted.png" });
    await context.close();
  }

  // 3) Archive action on a completed project
  {
    const completed = (await (await fetch(`${API}/projects?status=completed`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    })).json()).data?.[0];

    if (!completed) {
      console.log("!! no completed project to archive");
    } else {
      const { context, page } = await open(`/projects/${completed.id}`);
      await page.screenshot({ path: "rt-shots/project-archive-button.png" });
      await page.getByRole("button", { name: "أرشفة المشروع" }).click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: "rt-shots/project-archive-confirm.png" });
      await page.getByRole("button", { name: "أرشفة", exact: true }).click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "rt-shots/project-archived.png" });

      const after = (await (await fetch(`${API}/projects/${completed.id}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      })).json()).data;
      console.log(`archive: ${after.code} → ${after.status} (expected archived)`);
      await context.close();
    }
  }

  // 4) Command palette with a typo (Meilisearch tolerance)
  {
    const { context, page } = await open("/", true);
    await page.keyboard.press("ControlOrMeta+k");
    await page.waitForTimeout(600);
    await page.keyboard.type("ترجمه عقد", { delay: 60 }); // ه instead of ة
    await page.waitForTimeout(1800);
    await page.screenshot({ path: "rt-shots/palette-typo.png" });
    const results = await page.locator("[cmdk-item]").count();
    console.log(`palette typo "ترجمه عقد" → ${results} items`);
    await context.close();
  }
} finally {
  await browser.close();
  console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "no console errors");
}
