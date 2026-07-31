/**
 * Mobile responsiveness audit across every role.
 *
 * Loads each role's reachable pages at a phone viewport and reports the things
 * that actually break a small screen: horizontal overflow, the sidebar sheet,
 * the breadcrumb trail and any element wider than the viewport.
 *
 *   BASE=https://bahralmaani.com TOKENS='role=token,role=token' node ui-mobile-audit.mjs
 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

const EXECUTABLE = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1148/chrome-mac/headless_shell`;
const BASE = process.env.BASE ?? "https://bahralmaani.com";
const OUT = process.env.SHOTS ?? "mobile-shots";
const VIEWPORT = { width: 390, height: 844 }; // iPhone 14
mkdirSync(OUT, { recursive: true });

const TOKENS = Object.fromEntries(
  (process.env.TOKENS ?? "").split(",").filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    return [p.slice(0, i), p.slice(i + 1)];
  }),
);

const PAGES = {
  admin: ["/dashboard", "/projects", "/clients", "/users", "/reports", "/quotes", "/activity", "/letterheads", "/settings"],
  pm: ["/dashboard", "/projects", "/clients", "/quotes", "/reports"],
  accountant: ["/dashboard", "/reports", "/quotes", "/clients"],
  translator: ["/dashboard", "/portal"],
};

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const findings = [];

for (const [role, token] of Object.entries(TOKENS)) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  await ctx.addInitScript((t) => localStorage.setItem("bahr_token", t), token);

  for (const path of PAGES[role] ?? []) {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(1800);

      const metrics = await page.evaluate(() => {
        const de = document.documentElement;
        const overflow = de.scrollWidth - de.clientWidth;
        // Any element sticking out past the right/left edge of the viewport.
        const wide = [...document.querySelectorAll("body *")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;
            return r.width > de.clientWidth + 1;
          })
          .slice(0, 6)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return `${el.tagName.toLowerCase()}.${String(el.className).split(" ").filter(Boolean).slice(0, 3).join(".")} w=${Math.round(r.width)}`;
          });
        const crumbs = [...document.querySelectorAll("nav[aria-label='breadcrumb'] li")]
          .map((n) => n.innerText.trim()).filter(Boolean);
        const h1 = document.querySelector("h1");
        const h1Box = h1?.getBoundingClientRect();
        return {
          overflow,
          wide,
          crumbs,
          h1: h1?.innerText?.trim() ?? null,
          h1Overflows: h1Box ? h1Box.width > de.clientWidth + 1 : false,
          viewport: de.clientWidth,
        };
      });

      const slug = `${role}${path.replace(/\//g, "-")}`;
      await page.screenshot({ path: `${OUT}/${slug}.png` });

      findings.push({ role, path, ...metrics, errors: errors.slice(0, 2) });
    } catch (e) {
      findings.push({ role, path, error: e.message.split("\n")[0] });
    }
    await page.close();
  }

  // Sidebar sheet: does the hamburger actually open a usable menu on mobile?
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1500);
  const trigger = page.locator("[data-sidebar='trigger'], button:has(svg.lucide-panel-left)").first();
  let sheet = { opened: false, links: [], width: null };
  try {
    await trigger.click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    sheet = await page.evaluate(() => {
      const el = document.querySelector("[data-mobile='true'], [role='dialog'][data-state='open']");
      if (!el) return { opened: false, links: [], width: null };
      const r = el.getBoundingClientRect();
      return {
        opened: true,
        width: Math.round(r.width),
        links: [...el.querySelectorAll("a")].map((a) => a.innerText.trim()).filter(Boolean),
      };
    });
    await page.screenshot({ path: `${OUT}/${role}-sidebar-open.png` });
  } catch (e) {
    sheet.error = e.message.split("\n")[0];
  }
  findings.push({ role, path: "(sidebar sheet)", sheet });
  await page.close();
  await ctx.close();
}

await browser.close();

console.log(`\n=== MOBILE AUDIT @ ${VIEWPORT.width}x${VIEWPORT.height} — ${BASE} ===\n`);
for (const f of findings) {
  if (f.sheet) {
    console.log(`${f.role.padEnd(11)} ${f.path.padEnd(14)} sheet opened=${f.sheet.opened} width=${f.sheet.width} links=${f.sheet.links.length}${f.sheet.error ? " ERR=" + f.sheet.error : ""}`);
    continue;
  }
  if (f.error) {
    console.log(`${f.role.padEnd(11)} ${f.path.padEnd(14)} LOAD FAILED: ${f.error}`);
    continue;
  }
  const flags = [];
  if (f.overflow > 0) flags.push(`OVERFLOW +${f.overflow}px`);
  if (f.wide.length) flags.push(`WIDE[${f.wide.join(" ; ")}]`);
  if (f.h1Overflows) flags.push("H1-OVERFLOW");
  if (f.errors.length) flags.push(`JS:${f.errors[0].slice(0, 60)}`);
  console.log(
    `${f.role.padEnd(11)} ${f.path.padEnd(14)} crumbs=[${f.crumbs.join(" / ")}] h1="${(f.h1 ?? "").slice(0, 28)}" ${flags.length ? "?? " + flags.join(" | ") : "ok"}`,
  );
}
