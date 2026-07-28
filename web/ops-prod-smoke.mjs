/**
 * Post-deploy smoke test against a running stack (docker-compose.prod.yml or staging).
 *
 *   BASE=http://localhost:8081 EMAIL=admin@bahr.local PASSWORD=password node ops-prod-smoke.mjs
 *
 * Checks the pieces nginx has to route correctly: the Next.js app, the API,
 * the websocket upgrade to Reverb, and the browser console.
 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

const EXECUTABLE = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1148/chrome-mac/headless_shell`;
const BASE = process.env.BASE ?? "http://localhost:8081";
const EMAIL = process.env.EMAIL ?? "admin@bahr.local";
const PASSWORD = process.env.PASSWORD ?? "password";
mkdirSync("rt-shots", { recursive: true });

const token = (await (await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})).json()).token;
console.log("api login:", token ? "ok" : "FAILED");

const errors = [];
const sockets = [];
const browser = await chromium.launch({ executablePath: EXECUTABLE });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("websocket", (ws) => {
    sockets.push(ws.url());
    ws.on("framereceived", (f) => {
      const text = typeof f.payload === "string" ? f.payload : "";
      if (text.includes("connection_established")) console.log("reverb handshake: ok");
    });
  });

  await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "rt-shots/prod-dashboard.png" });

  console.log("dashboard heading:", await page.locator("h1").first().innerText());
  console.log("websockets:", sockets.length ? sockets.join(", ") : "NONE OPENED");
  await context.close();
} finally {
  console.log(errors.length ? "CONSOLE ERRORS:\n" + errors.join("\n") : "no console errors");
  await browser.close();
}
