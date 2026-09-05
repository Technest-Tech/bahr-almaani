/**
 * The approve dialog after the 2026-09-05 request: the letterhead alone makes
 * it ready, «بدون ختم» is a first-class choice, and the button enables without
 * any stamp selected.
 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

const EXECUTABLE = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const API = "http://localhost:8000/api/v1";
const OUT = process.env.OUT ?? "rt-shots";
mkdirSync(OUT, { recursive: true });

const login = async (email) =>
  (await (await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  })).json()).token;

const token = await login("pm@bahr.local");

const projects = (await (await fetch(`${API}/projects?status=in_review`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
})).json()).data;
if (!projects.length) throw new Error("no in_review project on dev");
console.log("project:", projects[0].code);

const errors = [];
const browser = await chromium.launch({ executablePath: EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);

await page.goto(`http://localhost:3000/projects/${projects[0].id}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "اعتماد وإنهاء" }).first().click();
await page.waitForTimeout(1500);

// Letterhead only — the stamp stays «بدون ختم».
await page.getByText("ترويسة بحر المعاني الرسمية").first().click();
await page.waitForTimeout(400);

const approve = page.getByRole("button", { name: "اعتماد وإنهاء" }).last();
console.log("approve enabled without stamp:", await approve.isEnabled());
await page.screenshot({ path: `${OUT}/approve-no-stamp.png` });

await browser.close();
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
