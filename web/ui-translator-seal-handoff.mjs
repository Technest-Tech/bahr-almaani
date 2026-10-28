/**
 * 2026-10-29: "the translator stamps and puts the letterhead, and the PM never
 * hears of it". The translator delivers with a seal placed; the PM's project page
 * marks the file, and the approve dialog opens on the translator's seal and the
 * letterhead instead of blank. Stops short of approving.
 *
 *   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   API=http://localhost:8000/api/v1 WEB=http://localhost:3000 node ui-translator-seal-handoff.mjs path/to/file.pdf
 */
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const API = process.env.API ?? "http://localhost:8000/api/v1";
const WEB = process.env.WEB ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "rt-shots";
const UPLOAD = process.argv[2];
if (!UPLOAD) throw new Error("pass a PDF to deliver");
mkdirSync(OUT, { recursive: true });

const headers = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/json" });
const call = async (token, path, init = {}) => {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers(token), ...init.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} → ${response.status} ${JSON.stringify(body)}`);
  return body;
};
const login = async (email) =>
  (await call(null, "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  })).token;

// Translator: hold a file, then deliver it with the first seal placed.
const translator = await login("translator1@bahr.local");
let current = (await call(translator, "/portal/current")).data;
if (!current) {
  const target = (await call(translator, "/portal/queue")).data[0];
  if (!target) throw new Error("no available project to claim");
  await call(translator, `/portal/claim/${target.id}`, { method: "POST" });
  current = (await call(translator, "/portal/current")).data;
}
const projectId = current.project?.id ?? current.project_id;
const seal = (await call(translator, "/portal/templates")).data.find((t) => t.kind === "stamp");
if (!seal) throw new Error("no active stamp on dev");

const form = new FormData();
form.append("files[]", new Blob([readFileSync(UPLOAD)], { type: "application/pdf" }), basename(UPLOAD));
form.append(
  "stamp_placements[0]",
  JSON.stringify({ [seal.id]: { anchor: "top-left", offset_x_mm: 120, offset_y_mm: 200 } }),
);
await call(translator, "/portal/deliver", { method: "POST", body: form });
console.log(`delivered project ${projectId} with «${seal.name}» placed`);

// PM: the delivery notification, then the review.
const pm = await login("pm@bahr.local");
const latest = (await call(pm, "/notifications")).data?.[0];
console.log("PM notification:", latest?.data?.message ?? latest?.message);
await call(pm, `/projects/${projectId}/review/open`, { method: "POST" });

const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript((t) => localStorage.setItem("bahr_token", t), pm);

await page.goto(`${WEB}/projects/${projectId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
console.log("file marked «ختمه المترجم»:", await page.getByText("ختمه المترجم").first().isVisible());
await page.screenshot({ path: `${OUT}/seal-handoff-project.png`, fullPage: true });

await page.getByRole("button", { name: "اعتماد وإنهاء" }).first().click();
await page.waitForTimeout(2000);
const dialog = page.getByRole("dialog");
console.log("notice shown:", await dialog.getByText("ختم المترجم هذا التسليم").isVisible());
console.log("approve enabled:", await dialog.getByRole("button", { name: "اعتماد وإنهاء" }).isEnabled());
await page.screenshot({ path: `${OUT}/seal-handoff-approve.png` });

// The per-file section shows the translator's position, not the template's.
await dialog.getByText("موضع الختم على كل ملف").scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/seal-handoff-positions.png` });

await browser.close();
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
