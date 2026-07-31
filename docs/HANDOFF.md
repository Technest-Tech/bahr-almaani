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
- **FPDI needs classic TCPDF 6.x** — `tecnickcom/tcpdf:^7` is the rewritten `tc-lib-pdf`
  API and blows up with `unable to read file: helvetica.json`. Pin `^6.6`.
- Ports 8000 and 3000 are taken by *other* projects on this machine (ZadAcademy on
  8000, an Azhary site on 3000). Serve this API on **8001** and the web on **3001**
  (`npm run dev -- --port 3001`), and pass `NEXT_PUBLIC_API_URL` at start rather than
  editing `web/.env.local`. A playwright run against the wrong port silently
  screenshots someone else's site — always confirm the app in the shot is ours.
- `/auth/login` is throttled 5/min; smoke scripts must cache tokens or they lock out.
- `Http::fake()` calls **merge**, and the first matching stub wins — a stub registered
  in `setUp()` shadows a per-test override unless the body is resolved lazily
  (see `Tests\Concerns\FakesDocumentConversion`).
- `headless_shell` has no PDF plugin, so PDF-backed template previews render as an
  empty box in screenshots. Not a bug — check PNG templates when verifying visually.

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

## 6c. M13 — public website & quote requests (SHIPPED 2026-07-29, billable — see §7b)

The first unauthenticated surface in the system. Read §7b before quoting it.

- **Routing moved.** `/` now belongs to the public site (`app/(site)/`: landing,
  `/request`, `/track`); the operations app starts at **`/dashboard`**. Anything that
  linked to `/` — sidebar logo, breadcrumb root, login redirect — was repointed. If you
  add a panel page, it goes under `app/(app)/`, and `/` is no longer a valid app link.
- **The reference is the credential.** `RQ-4KX7-9M2D`, random (never sequential), ~40
  bits, confusable glyphs removed. Anyone holding it sees the quote — that is the design,
  visitors have no account. `QuoteReferenceGenerator::normalize()` forgives case, spaces
  and a missing prefix so people can retype it off a phone call.
- **Gotcha that cost real time — named rate limiters.** An inline `throttle:5,60` keys off
  domain+IP, *not* the path, so it shares one bucket with every other unauthenticated
  throttled route. Five quote submissions locked the same visitor out of `/auth/login`
  for an hour; it surfaced as Playwright suddenly failing to log in. Fixed with
  `RateLimiter::for('quote-submissions'|'quote-lookups')` in `AppServiceProvider`, and
  pinned by `test_exhausting_the_public_submission_limit_does_not_lock_the_login_endpoint`
  — that test fails if anyone inlines a throttle on a public route again.
- **The accountant answers clients, the PM opens projects.** `quotes.manage` (price,
  send the quote, triage, delete) goes to admin + PM + **accountant**; `quotes.convert`
  (create the project) to admin + PM only. The "new request" notification targets
  `quotes.manage`, so the accountant is told a request arrived — an earlier cut gave them
  `quotes.view` alone and they could see an enquiry they had no way to answer. If Ahmed
  wants accountants opening projects too, add `quotes.convert` to that role in the seeder.
- **The public resource is narrower on purpose.** `PublicQuoteRequestResource` hides the
  IP, the user agent, internal ids and staff identity, and gates the quote figures on
  `responded_at` — otherwise a price a manager is still typing would be live to a client
  refreshing the tracking page.
- **Conversion copies, never moves.** Attachments are duplicated into the project as
  source files; the originals stay under `quote-requests/{id}/` so the request remains
  evidence of what was actually priced. Conversion is terminal and idempotent-guarded.
- **The site is centred, and that is deliberate.** `web/AGENTS.md` says app pages are
  always `w-full` — that rule is about the internal data screens. Marketing pages use
  `max-w-6xl` containers; a landing page at 2000px reads as broken.
- **Placeholder content**: `web/src/lib/company.ts` holds the phone, email, address,
  working hours and the four headline stats. Replace before go-live — the stats are a
  claim, not decoration.
- Verified by driving it, not by reading it: a real multipart submission through
  `POST /public/quote-requests`, then the full staff lane clicked in a browser
  (بدء الدراسة → price → client accepted → convert), landing on `BM-2026-00016` with the
  auto-created company client and both attachments copied in. 20 screenshots across
  light/dark/mobile via `web/ui-quotes.mjs`; the flow walk is `web/ui-quote-flow.mjs`.

## 7. What's next, in order

1. ~~**M9a — letterheads & stamps, everything except the merge**~~ **SHIPPED**:
   CRUD API + admin gallery + approval selection are live (see §8).
2. ~~**M9b — the real merge**~~ **SHIPPED** — see §9. M9 (11k EGP) is now complete.
   Everything else in Sprint 4 shipped: dashboard KPIs (M6), reports + Excel/PDF
   exports (M7), activity-log UI (M8), Meilisearch search + server-side sorting.
3. **M12 external half**:
   a. ~~GitHub remote~~ **DONE** — `origin = git@github.com:Technest-Tech/bahr-almaani.git`,
      `main` pushed, CI green on three jobs (API PHPUnit+Pint on Postgres, Web
      lint+build, prod image builds) with **zero annotations** as of `997cefd`.
      Push after every commit and watch the run (`gh run watch`).
   b. **Staging droplet (waiting on Ahmed — SSH + domain)**. Then: clone to
      `/var/www/bahr-almaaani`, fill `.env` from `.env.production.example`, run the
      first-time steps in `docs/DEPLOYMENT.md`, issue TLS, and finish with
      `cd web && BASE=https://<domain> node ops-prod-smoke.mjs`.
   c. UAT week with real staff + the recorded training session still follow the deploy.
   Provision nothing cloud-side without him.

3b. **In-scope hardening still owed** (docs/04 Sprint 4 line 49 — these are inside the
   85k, do NOT bill them):
   - **Backup automation + restore drill** — not built. `docs/DEPLOYMENT.md` documents
     a manual `pg_dump` only, and the `storage` volume (uploads, letterhead assets,
     final files) is in no backup path at all.
   - **Sentry** — named in the docs/00 stack table and the Sprint 1 deliverables,
     absent from both `composer.json` and `package.json`.
   - **Default 60/min rate limit** (docs/03 API conventions). Login 5/min and claim
     10/min *are* live.
   Backups and Sentry need nothing from Ahmed and can be done any time.

3c. **Two architecture deviations never formally decided**: storage is a local Docker
   volume rather than the S3/DO Spaces in docs/00, and downloads stream through the
   API rather than presigned URLs. Fine for one VPS; worth a deliberate call before
   thousands of files land on it. Migrating to S3 is **in scope** (docs/00 specified
   it), not an upsell.
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

7. **Open questions for the client** (raised 2026-07-28, not yet answered):
   - **Stamp on every page vs. last page only.** Default is every page, matching the
     four hand-stamped sheets they supplied. On a text-dense page the stamp overlaps
     the last few lines — real certified practice, but a legibility trade-off.
     `pages: last` is a one-field change in the template dialog.
   - **Is there a digital original of the letterhead?** Theirs is a 17 MB 300dpi scan;
     it adds ~3 MB to every final file. A vector/high-res original would be better.
   - The stamp and footer are Abu Dhabi/UAE (Reg. No. 416, +971) while docs/00
     describes an Egyptian office — confirm that's the right entity.

## 7b. Scope: what is inside the 85k vs. billable (settled with Ahmed 2026-07-28)

Ahmed is the **vendor** here (Technest) — he prices and bills the client, so scoping
questions are commercial, not just technical. Keep these three groups straight.

**Already agreed as a later paid phase** (named in docs/00 + §1): OCR for scanned
documents, translation memory, machine translation / AI assistant.

**Out of scope, surfaced during the build** — genuine change requests:
pricing/quotation engine (a rate card turning the word count into `quoted_amount` —
today the PM types the figure by hand, and no rate config exists anywhere);
client-facing portal (`Client` is a plain record with no login; the four personas are
Admin/PM/Translator/Accountant); invoicing & payments (no invoice/payment model
exists); reports beyond the fixed catalog (docs/00 says so outright); SMS/WhatsApp
notifications (channels are database + mail + broadcast only); multi-tenancy
activation (`company_id` is in the schema, Phase 1 is single-tenant); mobile app.

> **M13 shipped against this list (2026-07-29)** — the public website and quote-request
> module. It delivers the *client-facing portal* change request in its reference-code
> form (no client login: a visitor submits, gets `RQ-XXXX-XXXX`, and tracks with it),
> plus the **manual** half of the quotation engine — a manager still types the price,
> because there is still no rate card. Invoice it as its own line; it is not one of the
> twelve priced modules. What remains genuinely unbuilt from the pricing engine is the
> rate card itself: rates per language pair / service type / priority, applied to the
> `total_words` M3 already computes, to propose `quoted_amount` instead of asking for it.

**NOT billable — inside the 85k and still owed**: everything in §7 items 3b and 3c.

Word counting itself (the client's "ثالثاً" requirement) is **delivered** inside M3:
auto count on upload, Arabic-aware, manual fallback for scans, `count_source` audit
trail. Only the "تسعير فوري" (instant pricing) clause is unbuilt — that's the pricing
engine above, and the client's own text frames pricing as an *effect* of counting
rather than a deliverable, so it was never scoped or priced.

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

## 9. M9b — the merge (SHIPPED, verified against the client's real artwork)

**Pipeline** (`App\Services\DocumentMergeService`, run by `App\Jobs\MergeFinalFileJob`
which replaced `FinalizeProjectJob`): deliverable → PDF via Gotenberg
`/forms/libreoffice/convert` (a PDF deliverable passes through untouched — re-rendering
it rasterises Arabic shaping) → FPDI redraw per page: **letterhead behind → deliverable
page scaled into the content band → stamp on top** → stored as the `final` file →
`approved → completed` via `ProjectTransitionService`.

**What the client actually supplied** (`samples/`, gitignored — real legal stamp and
handwritten signature, never commit them):
- `letterhead-bahr-almaaani.pdf` — A4 300dpi scan, 17 MB. Header artwork **0–33 mm**,
  footer **270–297 mm**, faint globe watermark between. Safe text band = **33→270 mm**.
- `stamp-signature-*.png` — four A4 canvases, already background-removed (~1% opaque),
  each carrying the round stamp (**49.8 mm**) plus the signature to its left. The
  position differs per sheet because they are hand-stamped.

**Decisions taken** (Ahmed: "go with your recommendations"):
- Stamp and signature stay **one asset**, trimmed to their ink box on upload.
- Deliverable pages are **shrunk into the content band** rather than overlaid raw.
- Letterhead and stamp on **all pages**; the asset size cap moved 10 MB → **25 MB**
  because the client's own letterhead is 17 MB.
- Real placement that produced a correct document: letterhead
  `content_top_mm 33 / content_bottom_mm 27`; stamp `bottom-right, width_mm 155,
  offset_x 12, offset_y 30`. **`width_mm` must be the asset's true physical size**
  (px ÷ 300 dpi × 25.4) or the stamp renders at the wrong scale — sizing it at 78 mm
  halved the disc and dropped it into the footer.

**Verified, not assumed**: full review cycle through the real stack (publish → claim →
deliver Arabic DOCX → review → approve → merge → download), then the merged PDF was
rendered and read page by page — Arabic shaping correct, letterhead behind the text,
text clear of header and footer, stamp legible at true size. Final files run ~3 MB
because the letterhead scan is embedded (once, not per page).

**Open question for the client**: on a text-dense page the all-pages stamp overlaps
the last few lines (real certified practice, but a legibility trade-off).
`pages: last` in the template dialog is a one-field change if they prefer it.
