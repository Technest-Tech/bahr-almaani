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
        // Wider than the screen is only a defect when nothing scrolls it. A data
        // grid inside overflow-x:auto is working as intended, so walk up and let
        // it off — otherwise every table page cries wolf and hides real breaks.
        const scrollableAncestor = (el) => {
          for (let n = el.parentElement; n; n = n.parentElement) {
            const ox = getComputedStyle(n).overflowX;
            if (ox === "auto" || ox === "scroll") return true;
          }
          return false;
        };
        const wide = [...document.querySelectorAll("body *")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;
            if (r.width <= de.clientWidth + 1) return false;
            return !scrollableAncestor(el);
          })
          .slice(0, 6)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return `${el.tagName.toLowerCase()}.${String(el.className).split(" ").filter(Boolean).slice(0, 3).join(".")} w=${Math.round(r.width)}`;
          });
        // innerText falls back to textContent on a display:none element, so a
        // hidden crumb still reads as present. Check what is actually rendered.
        const crumbs = [...document.querySelectorAll("nav[aria-label='breadcrumb'] li")]
          .filter((n) => getComputedStyle(n).display !== "none" && n.offsetParent !== null)
          .map((n) => n.innerText.trim()).filter(Boolean);
        const h1 = document.querySelector("h1");
        const h1Box = h1?.getBoundingClientRect();
        // The trail lives in a fixed h-14 bar; a second line means it wrapped.
        const ol = document.querySelector("nav[aria-label='breadcrumb'] ol");
        const olH = ol ? ol.getBoundingClientRect().height : 0;
        return {
          overflow,
          wide,
          crumbs,
          crumbWraps: olH > 28,
          crumbH: Math.round(olH),
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
  if (f.overflow > 0) flags.push(`PAGE-OVERFLOW +${f.overflow}px`);
  if (f.wide.length) flags.push(`UNSCROLLABLE-WIDE[${f.wide.join(" ; ")}]`);
  if (f.crumbWraps) flags.push(`CRUMB-WRAP ${f.crumbH}px`);
  if (f.h1Overflows) flags.push("H1-OVERFLOW");
  if (f.errors.length) flags.push(`JS:${f.errors[0].slice(0, 60)}`);
  console.log(
    `${f.role.padEnd(11)} ${f.path.padEnd(14)} crumb=[${f.crumbs.join(" / ")}] ${String(f.crumbH).padStart(3)}px h1="${(f.h1 ?? "").slice(0, 26)}" ${flags.length ? "!! " + flags.join(" | ") : "ok"}`,
  );
}
