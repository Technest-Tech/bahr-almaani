/** Screenshot M9a: letterhead gallery (light+dark), upload dialog, approval pickers. */
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

async function open(token, path, dark) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: dark ? "dark" : "light",
  });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`[${path}] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[${path}] ${e.message}`));
  await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);
  await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  return { context, page };
}

try {
  const adminToken = await login("admin@bahr.local");
  const pmToken = await login("pm@bahr.local");

  // 1) Gallery, light + dark
  for (const dark of [false, true]) {
    const { context, page } = await open(adminToken, "/letterheads", dark);
    await page.screenshot({
      path: `rt-shots/letterheads-${dark ? "dark" : "light"}.png`,
      fullPage: true,
    });
    await context.close();
  }

  // 2) Upload dialog with the anchor grid
  {
    const { context, page } = await open(adminToken, "/letterheads", false);
    await page.getByRole("button", { name: "قالب جديد" }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: "rt-shots/letterheads-form.png" });

    // switch kind → geometry defaults must re-seed
    await page.locator("#t-kind").click();
    await page.waitForTimeout(300);
    await page.getByRole("option", { name: "ختم" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "rt-shots/letterheads-form-stamp.png" });
    await context.close();
  }

  // 3) Edit dialog on an existing template (dark)
  {
    const { context, page } = await open(adminToken, "/letterheads", true);
    await page.getByTitle("تعديل").first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: "rt-shots/letterheads-edit-dark.png" });
    await context.close();
  }

  // 4) PM approval dialog on a project awaiting review
  const inReview = (await (await fetch(`${API}/projects?status=in_review`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${pmToken}` },
  })).json()).data?.[0];

  if (!inReview) {
    console.log("!! no in_review project — run prep_review_project.py first");
  } else {
    for (const dark of [false, true]) {
      const { context, page } = await open(pmToken, `/projects/${inReview.id}`, dark);
      await page.getByRole("button", { name: "اعتماد وإنهاء" }).click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `rt-shots/approve-dialog-${dark ? "dark" : "light"}.png` });

      if (!dark) {
        // pick one of each and capture the enabled state
        await page.locator("button", { hasText: "ترويسة بحر المعاني الرسمية" }).first().click();
        await page.locator("button", { hasText: "ختم الاعتماد الرسمي" }).first().click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: "rt-shots/approve-dialog-selected.png" });
      }
      await context.close();
    }
    console.log(`approval dialog shot on project ${inReview.code} (#${inReview.id})`);
  }

  // 5) Translator must not see the sidebar entry
  {
    const translatorToken = await login("translator1@bahr.local");
    const { context, page } = await open(translatorToken, "/portal", false);
    const visible = await page.getByRole("link", { name: "الترويسات والأختام" }).count();
    console.log(`translator sidebar letterheads link count = ${visible} (expected 0)`);
    await context.close();
  }
} finally {
  await browser.close();
  console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "no console errors");
}
