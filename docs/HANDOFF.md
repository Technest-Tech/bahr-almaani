# Session Handoff — Bahr Al-Maaani (بحر المعاني)

> Read this top-to-bottom before writing any code. It is the accumulated context of the
> sessions that built Sprints 0–4 (through M10 + the local half of M12). The owner
> (Ahmed) expects you to behave as a senior architect/developer who verifies everything
> and never claims unverified work.

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
  `docker/postgres-init.sql`). **109 tests / 441 assertions green** at handoff.
- Production stack is `docker-compose.prod.yml` + `deploy.sh` + `docs/DEPLOYMENT.md`
  (nginx → Next.js + php-fpm + Reverb on one origin; queue/scheduler/reverb are
  separate containers of the same API image). It has been run locally end-to-end.
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
- **A new notification class must use `RespectsMailPreference::channelsFor()`** in
  `via()`. Returning a literal `['database','mail','broadcast']` silently bypasses the
  user's opt-out, and no test will catch it for *that* class.
- `MAIL_SCHEME` accepts only `smtp` (587/STARTTLS) or `smtps` (465). `tls`/`ssl` throw
  Symfony's UnsupportedSchemeException on every send — cost a real debugging round
  during the prod smoke test.
- In containers, `config:cache` only helps if `bootstrap/cache` is a **shared volume**;
  otherwise the cache dies with the throwaway container that wrote it. Same volume also
  holds the package-discovery manifest, so `package:discover` runs before the caches.
- Reverb has two addresses in production: browsers dial the public host (`REVERB_*`,
  proxied by nginx at `/app`), while PHP pushes in-network via `REVERB_PUSH_*`
  (`http://reverb:8080`). Both read from `config/broadcasting.php`; unset in dev.
- Docker CLI on this machine needs `/Applications/Docker.app/Contents/Resources/bin` on
  PATH or every build fails with `docker-credential-desktop: executable file not found`.
- `vendor/bin/pint --test` now gates CI. Run `vendor/bin/pint` before committing.

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

## 6b. Shipped after the Sprint-4 handoff (this session)

- **M10 — notification preferences** (`f191941`): `notification_preferences` table
  (row per user × family, missing row = default), `App\Support\NotificationPreferences`
  registry of six families with Arabic labels, `RespectsMailPreference` trait that every
  `via()` now goes through, `GET|PUT /notification-preferences` (personal, no permission
  gate, partial map accepted), and a `/settings` page reachable from the user menu.
  ProjectAvailable and ReportReady gained real `toMail()` bodies — **behaviour change**:
  translators now get mail per matching published project unless they opt out. Flip the
  default in `NotificationPreferences::FAMILIES` if Ahmed disagrees.
- **M12 local half** (`9d2b037`): production Dockerfiles, `docker-compose.prod.yml`,
  `deploy.sh`, `.env.production.example` (Arabic), `docs/DEPLOYMENT.md`, CI audit
  (extensions matched to the image, Pint gate, image-build job). `trustProxies(at: '*')`
  and the `REVERB_PUSH_*` split landed here because the container topology needs them.
- **M12 training docs** (`0500b74`): `docs/guide-admin.md`, `guide-pm.md`,
  `guide-translator.md` + 19 real screenshots in `docs/screenshots/`, regenerable with
  `web/ui-guides.mjs`.
- Verified by running things, not by reading code: full prod stack up locally on
  :8081 (ten containers, dashboard through nginx, websocket handshake, xlsx export
  through the queue container, scheduler tick, scout:import, SMTP mail delivered),
  and the preferences slice proven end-to-end through the dev stack (mail on → Mailpit,
  mail off → nothing, bell either way).

## 7. What's next, in order

1. ~~**M9a — letterheads & stamps, everything except the merge**~~ **SHIPPED**:
   CRUD API + admin gallery + approval selection are live (see §8).
2. **M9b — the real merge (BLOCKED on client sample)**: when Ahmed hands over the
   sample, spike `MergeFinalFileJob` per docs/03 M9 table: deliverable → PDF via
   Gotenberg → FPDI overlay of letterhead + stamp per placement → `final` file.
   Everything it needs is already in place — see §8 for the seam and the geometry
   contract. `POST /letterheads/{id}/preview` (docs/03 M9) is deliberately NOT built
   yet: it renders a sample merge, so it lands with M9b.
   Everything else in Sprint 4 shipped: dashboard KPIs (M6), reports + Excel/PDF
   exports (M7), activity-log UI (M8), Meilisearch search + server-side sorting.
3. **M12 external half (waiting on Ahmed, nothing else blocks it)**:
   a. GitHub remote — he supplies the repo URL/org; push `main`, then watch the first
      Actions run and fix whatever the runner surfaces (three jobs: PHPUnit+Pint,
      Next build, production image builds).
   b. Staging droplet — he supplies SSH + domain. Then: clone to
      `/var/www/bahr-almaaani`, fill `.env` from `.env.production.example`, run the
      first-time steps in `docs/DEPLOYMENT.md`, issue TLS, and finish with
      `cd web && BASE=https://<domain> node ops-prod-smoke.mjs`.
   Provision nothing cloud-side without him.
4. ~~**Polish backlog**~~ **DONE**: server-side sorting for the clients + users tables (copy the
   controlled-sorting pattern already used by projects), a `completed → archived`
   button on the project detail page (`projects.manage` — the transition exists in
   the state machine but no UI triggers it), command-palette pass now that
   Meilisearch typo-tolerance is on.
5. **Still open, low priority**: Horizon is a composer dependency but unconfigured —
   the prod `queue` container supervises `queue:work` instead, and Horizon's dashboard
   denies access outside `local`, so nothing is exposed. Configure it only if the
   dashboard is actually wanted.
6. Excel financial-summary bug in the client's proposal file was flagged to Ahmed early on
   (totals said 5k/45k/50k instead of 85k/125k/210k) — remind him before it goes to the client.

## 8. M9a — what shipped, and where M9b plugs in

- **Geometry contract**: `App\Support\PlacementConfig` normalizes every template's
  `placement` on write, so the merge job never reads a missing key. Keys: `pages`
  (all|first|last), `anchor` (`{top|middle|bottom}-{left|center|right}`),
  `offset_x_mm`, `offset_y_mm`, `width_mm` (null = full page width), `opacity`,
  `layer` (background|foreground). **Coordinates are physical paper geometry, not
  RTL-relative** — anchors say left/right on purpose. `PlacementConfig::resolveRect()`
  turns a placement into the mm rectangle to draw; `web/src/lib/placement.ts`
  mirrors it in CSS for the admin preview — **change both together**.
- **The merge seam** is marked in `FinalizeProjectJob` (`── M9b merge seam ──`). The
  job already loads `$project->letterhead` / `->stamp` and logs them; only the
  `Storage::copy()` step is replaced. The review flow and approved→completed
  transition need no further changes.
- **Assets** are on the private `local` disk under `letterheads/`; previews stream
  through `GET /letterheads/{id}/asset` (letterheads.view) and the frontend renders
  them from blob object URLs — `<img src>` cannot carry the bearer token.
- **Approval requires both**: `POST /projects/{id}/review/approve` validates
  `letterhead_id` + `stamp_id` (must exist, be the right `kind`, and be active),
  persists them, then transitions — all in one DB transaction, so a rejected
  transition leaves no selection behind.
- **UI**: `/letterheads` gallery (sidebar gated on `letterheads.view`; PM has view,
  admin has manage), upload/edit dialog with an A4 preview whose 3×3 anchor grid
  doubles as the picker, and the PM approval dialog with thumbnail pickers.
  Screenshots: `web/rt-shots/letterheads-*.png`, `approve-dialog-*.png`,
  `project-completed-templates.png` (`web/ui-letterheads.mjs`,
  `web/ui-approve-flow.mjs` — the latter consumes an in_review project).
- **Gotchas found here**: multipart PUT does not exist — updates POST with
  `_method=PUT` (both the UI and the tests do this); and a multipart test request
  must send `Accept: application/json` or validation failures come back as a 302
  redirect instead of 422.
