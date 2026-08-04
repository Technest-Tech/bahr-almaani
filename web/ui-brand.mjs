/** Brand rollout: logo placements and the navy/gold palette, light and dark. */
import { chromium } from "playwright-core";
import { homedir } from "node:os";

const EXECUTABLE = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1148/chrome-mac/headless_shell`;
const API = "http://localhost:8000/api/v1";
const token = (await (await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ email: "admin@bahr.local", password: "password" }),
})).json()).token;

// /login and / must be visited signed-OUT: an injected token makes the login
// screen redirect to the dashboard, so a shared context would shoot the wrong page.
const PAGES = [
  { path: "/login", shot: "login", auth: false },
  { path: "/", shot: "site", auth: false },
  { path: "/dashboard", shot: "dashboard", auth: true },
  { path: "/projects", shot: "projects", auth: true },
];

const errors = [];
const browser = await chromium.launch({ executablePath: EXECUTABLE });

try {
  for (const scheme of ["light", "dark"]) {
    for (const { path, shot, auth } of PAGES) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 950 },
        colorScheme: scheme,
      });
      const page = await context.newPage();
      page.on("console", (m) => m.type() === "error" && errors.push(`[${scheme}] ${m.text()}`));
      page.on("pageerror", (e) => errors.push(`[${scheme}] ${e.message}`));
      if (auth) await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);

      await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1400);
      await page.screenshot({ path: `rt-shots/brand-${shot}-${scheme}.png` });
      console.log(`${scheme} ${path} -> brand-${shot}-${scheme}.png (${page.url()})`);

      // The footer carries the third logo placement — it is below the fold.
      if (path === "/") {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(900);
        await page.screenshot({ path: `rt-shots/brand-footer-${scheme}.png` });
        console.log(`${scheme} / footer -> brand-footer-${scheme}.png`);
      }
      await context.close();
    }
  }

  // Narrow viewport: the glyph sits in the mobile top bar and the site header.
  for (const { path, shot, auth } of [
    { path: "/", shot: "site", auth: false },
    { path: "/dashboard", shot: "dashboard", auth: true },
  ]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: "light",
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`[mobile] ${e.message}`));
    if (auth) await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `rt-shots/brand-${shot}-mobile.png` });
    console.log(`mobile ${path} -> brand-${shot}-mobile.png`);
    await context.close();
  }
} finally {
  await browser.close();
  console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "no console errors");
}
