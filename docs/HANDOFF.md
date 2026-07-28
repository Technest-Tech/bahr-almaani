# Session Handoff — Bahr Al-Maaani (بحر المعاني)

> Read this top-to-bottom before writing any code. It is the accumulated context of the
> sessions that built Sprints 0–3. The owner (Ahmed) expects you to behave as a senior
> architect/developer who verifies everything and never claims unverified work.

## 1. What this project is

Translation Services Management System for a certified-translation company (100+ employees,
thousands of files). Fixed-price 85,000 EGP / 8 weeks; AI expansions (OCR, TM, MT) are a
later paid phase. Client requirement docs (Arabic) sit in the repo root; the engineering
docs are `docs/00-overview.md` … `docs/04-sprint-plan.md` — schema, state machine (client
must sign off), API contract mapped to priced modules, sprint plan mapped to invoices.

## 2. Environment (this machine)

- `api/` — Laravel 12, PHP 8.2, serve on **:8000** (`php artisan serve`; use
  `PHP_CLI_SERVER_WORKERS=12` when testing concurrency).
- `web/` — Next.js 16 + React 19, `npm run dev` on **:3000**. npm commands MUST run from `web/`.
- `docker compose up -d` — Postgres 16 host port **5434** (5432/5433 are taken by other
  projects), Redis :6379, Meilisearch :7700, Gotenberg :**3300**, Mailpit UI :8025.
- `php artisan reverb:start` — websockets on **:8080** (portal + bell realtime). Full dev
  stack = serve + reverb + queue:work + npm run dev.
- Tests: `cd api && php artisan test` → runs on `bahr_test` DB (created by
  `docker/postgres-init.sql`). **46 tests / 162 assertions green** at handoff.
- Dev logins (password `password`): `admin@bahr.local`, `pm@bahr.local`,
  `translator1@bahr.local` (en↔ar pairs), `translator2@bahr.local` (fr→ar),
  `accountant@bahr.local`.
- Queued mail/notifications in dev need `php artisan queue:work` (or `--stop-when-empty`).

## 3. Owner's working style — CRITICAL

- Design quality is a first-class requirement. He escalated twice ("90% basic", "why do you
  lay to me") until the UI reached enterprise level. He screenshots pages back at you.
- **Never claim UI work is done without looking at it yourself**: `playwright-core` is a
  devDependency; launch headless Chromium from the cache:
  `~/Library/Caches/ms-playwright/chromium_headless_shell-1148/chrome-mac/headless_shell`
  (see the `ui-*.mjs` patterns in git history: login → navigate → screenshot → READ the
  screenshot → check console errors). Scripts must run from `web/` for module resolution.
- Be honest about what's done vs pending. He responds well to "you're right, here's the gap".
- Commit per completed slice with descriptive messages ending in
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. He approves the general flow;
  no GitHub remote exists yet.
- UI conventions are codified in `web/AGENTS.md` — full-width pages (never `max-w-*`),
  Almarai font, RTL logical properties only, PageHeader/DataTable(toolbar)/FormSection/Field
  patterns, sonner toasts + `useConfirm()` (never browser popups), light+dark correctness.

## 4. Architecture decisions already locked

- **State machine**: `ProjectTransitionService` is the ONLY path that mutates
  `projects.status` (matrix in `docs/02`, row-locked, history in `status_transitions`).
- **Claim safety is DB-level**: partial unique indexes `one_active_per_translator` /
  `one_active_per_project` + `lockForUpdate` + status recheck. PROVEN with 50 parallel
  claims → exactly 1×201 + 49×409. Claim returns **201**.
- Late is a computed flag (`isLate()`/scope), never a status.
- Work time = accumulated windows from the transition log (claim→deliver, each
  revision→re-deliver), stored in `assignments.work_seconds` (int — cast Carbon floats!).
- Revision loop: assignment goes back to blocking via project status
  `revision_requested`; translator can't claim while it's pending.
- Translators never see client identity or pricing (`PortalProjectResource`), and can only
  download files of their current project.
- `FinalizeProjectJob` currently copies the latest deliverable as the final file — the
  Gotenberg+FPDI letterhead merge replaces that copy step in Sprint 4 (M9, 11k EGP item).
- Word counting: DOCX via docProps/app.xml→XML fallback, PDF via smalot (scan ⇒
  `not_applicable` ⇒ manual-count endpoint), Arabic-aware `preg_split` word counting.

## 5. Known gotchas (each cost real debugging time)

- zsh mangles inline Arabic in compound commands — write Python scripts to scratchpad for
  API smoke tests instead of curl one-liners with Arabic JSON.
- Arabic in PHPUnit test URLs must be `rawurlencode()`d (raw multibyte gets corrupted:
  bytes 0x84/0x86/0x88 → `_`).
- Spatie permissions live on the `web` guard; `User::$guard_name = 'web'` is set.
- Models need `$attributes` defaults for DB-defaulted columns (status/count_status) or
  fresh instances return null in resources.
- shadcn `CommandDialog` was hand-patched to forward `shouldFilter`; `use-mobile` and
  sidebar skeleton were patched for the React 19 lint rules (`set-state-in-effect`,
  no `Math.random`/`Date.now` in render — use `useSyncExternalStore`).
- Radix `Slot` (Button `asChild`) must receive exactly one child — the loading spinner
  branch is separated for that reason.
- The base `table.tsx` was fixed to `text-start` (RTL alignment) — don't regenerate it
  blindly via shadcn CLI (`--overwrite` would revert patches; re-apply if you must).
- `rescue(fn () => broadcast($e))` does NOT protect you: the arrow fn returns the
  PendingBroadcast, whose dispatching destructor then runs outside rescue's catch.
  Use `Controller::broadcastLive()` (braces closure) for all event broadcasts.
- Channel-authorization callbacks bind to the *default broadcaster at boot* — under
  phpunit that's the null driver, which skips callbacks entirely. Tests that hit
  /broadcasting/auth must switch to the reverb driver AND re-require routes/channels.php
  (see RealtimeBroadcastingTest::authTo).
- Notification broadcasts (bell/toasts) ride the queue → up to ~3s lag in dev (worker
  sleep). Portal queue events are ShouldBroadcastNow in-request → instant. Both are
  intentional; don't "fix" the former by making notifications sync.
- The queue worker holds loaded code: after composer/require or editing jobs, RESTART
  `queue:work` or new job classes fail silently (cost a debugging round with Scout).
- Scout runs Meilisearch in dev/prod (SCOUT_DRIVER=meilisearch, queued sync) but the
  `collection` engine under phpunit — no Meilisearch needed in CI. After changing
  toSearchableArray: `php artisan scout:import` both models.

## 6. State at handoff (git log tells the story)

Sprints 1–3 complete: auth/RBAC/instant-suspension → clients + projects lifecycle +
uploads + word counting → design system (deep-sea inset shell, Almarai, sortable RTL
tables) → translator portal + review cycle + withdraw + time tracking + notifications
(DB+mail, bell UI, deadline scanner every 5 min via `routes/console.php`).

Realtime (Reverb) shipped after Sprint 3: events + channels are documented in docs/03
(M4 section). Frontend: `web/src/lib/echo.ts` (lazy singleton) + `RealtimeProvider`
(user channel → bell/toasts + PM freshness; pair channels → live queue, claim removes
the card from caches instantly). Polling is fully removed; reconnects re-invalidate.
Verified end-to-end with `web/rt-demo.mjs` (two headless contexts: publish appears live
on both, claim vanishes from the other screen in ~120ms, zero console errors).

## 7. What's next, in order

1. **M9a — letterheads & stamps, everything except the merge (UNBLOCKED)**:
   `LetterheadTemplate` model exists; permissions `letterheads.view/manage` seeded.
   Build: CRUD API (`GET|POST /letterheads`, `PUT|DELETE /letterheads/{id}` — asset
   upload, kind letterhead|stamp, active flag, placement config), admin UI page,
   and the approve flow requiring `letterhead_id` + `stamp_id` (docs/03 M5) stored
   on the project so the merge job becomes a drop-in.
2. **M9b — the real merge (BLOCKED on client sample)**: when Ahmed hands over the
   sample, spike `MergeFinalFileJob` per docs/03 M9 table: deliverable → PDF via
   Gotenberg → FPDI overlay of letterhead + stamp per placement → `final` file.
   `FinalizeProjectJob` currently just copies the deliverable — replace that.
   Everything else in Sprint 4 shipped: dashboard KPIs (M6), reports + Excel/PDF
   exports (M7), activity-log UI (M8), Meilisearch search + server-side sorting.
2. **Ops**: create GitHub remote + push (CI is ready in `.github/workflows/ci.yml`),
   staging server, Horizon config (Reverb needs a supervisor entry in prod too),
   production compose + deploy script (owner's pattern: DigitalOcean, see QTD project).
3. Excel financial-summary bug in the client's proposal file was flagged to Ahmed early on
   (totals said 5k/45k/50k instead of 85k/125k/210k) — remind him before it goes to the client.
