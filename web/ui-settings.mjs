/** Drive the settings page: user-menu entry, toggle a family, save, verify persistence, dark mode. */
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
const browser = await chromium.launch({ executablePath: EXECUTABLE });
const token = await login("pm@bahr.local");

async function open(dark, path = "/settings") {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    colorScheme: dark ? "dark" : "light",
  });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);
  await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  return { context, page };
}

try {
  // 1) reach settings the way a user would: avatar → user menu → الإعدادات
  const { context, page } = await open(false, "/");
  await page.locator("header button:has(.rounded-full), header button >> nth=-1").last().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "rt-shots/settings-user-menu.png" });
  await page.getByRole("menuitem", { name: "الإعدادات" }).click();
  await page.waitForURL("**/settings");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "rt-shots/settings-light.png", fullPage: true });

  // 2) toggle two families off and save
  const switches = page.locator('button[role="switch"]');
  console.log("switch count:", await switches.count());
  await switches.nth(0).click();
  await switches.nth(4).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "rt-shots/settings-dirty.png", fullPage: true });

  await page.getByRole("button", { name: "حفظ التفضيلات" }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "rt-shots/settings-saved.png", fullPage: true });

  // 3) reload — the API must return the persisted values
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const states = await page.locator('button[role="switch"]').evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-state")),
  );
  console.log("after reload:", states.join(", "));

  const api = await page.evaluate(async () => {
    const r = await fetch("http://localhost:8000/api/v1/notification-preferences", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${localStorage.getItem("bahr_token")}`,
      },
    });
    return (await r.json()).data;
  });
  console.log("API says:", JSON.stringify(api));
  await context.close();

  // 4) dark mode
  const { context: c2, page: p2 } = await open(true);
  await p2.screenshot({ path: "rt-shots/settings-dark.png", fullPage: true });
  await c2.close();

  console.log("done");
} finally {
  console.log(errors.length ? "CONSOLE ERRORS:\n" + errors.join("\n") : "no console errors");
  await browser.close();
}
