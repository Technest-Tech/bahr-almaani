# 03 — Modules & API Contract

Modules map 1:1 to the client's priced contract items (total 85,000 EGP), so scope tracking = billing tracking.

| # | Module | Contract item (Arabic) | EGP | Sprint |
|---|---|---|---|---|
| M1 | Infrastructure & database | البنية الأساسية وقاعدة البيانات | 6,000 | S1 |
| M2 | Users, roles & permissions | المستخدمون والأدوار والصلاحيات | 8,000 | S1 |
| M3 | Project management | وحدة إدارة المشاريع | 12,000 | S2 |
| M4 | Translator portal | بورتال المترجم | 14,000 | S3 |
| M5 | Time tracking & project states | تتبع وقت العمل وحالات المشاريع | 7,000 | S2–S3 |
| M6 | Statistics dashboard | لوحة الإحصائيات | 9,000 | S4 |
| M7 | Comprehensive reports & exports | إدارة المشاريع الشاملة والتقارير | 5,000 | S4 |
| M8 | Activity log | سجل النشاطات | 3,000 | S2 (infra) / S4 (UI) |
| M9 | Letterhead & stamps | الـ Letterhead والأختام | 11,000 | S4 (spike in S1) |
| M10 | Notifications | نظام الإشعارات | 5,000 | S3 |
| M11 | QA & testing | الاختبار وضمان الجودة | included | all |
| M12 | Deployment, training & docs | النشر والتدريب والتوثيق | 5,000 | S1 + S4 |

**Outside the 85,000** — built on request, priced separately:

| # | Module | Contract item (Arabic) | EGP | Sprint |
|---|---|---|---|---|
| M13 | Public website & quote requests | الموقع العام وطلبات التسعير | change request | post-S4 |

> M13 is **not** one of the twelve priced items. It is the "client-facing portal"
> change request from `HANDOFF.md` §7b, and it carries the manual half of the
> quotation engine (a manager types the price; there is still no rate card). Keep it
> in its own line on any invoice — the twelve modules above are already sold.

## API conventions

- Base: `/api/v1` · Auth: Sanctum bearer tokens · JSON only.
- **Authorization:** every endpoint behind policy checks; translators can only ever read/write their own assignments.
- **Pagination:** cursor-based for portals/feeds, page-based for admin tables (`per_page` ≤ 100).
- **Filtering:** query params (`status`, `priority`, `client_id`, `lang_pair`, `date_from/to`, `late=1`, `q` for search).
- **Errors:** RFC-style envelope `{ "message", "errors": {field: []}, "code" }`; 409 for claim races, 422 for forbidden transitions.
- **Files:** direct-to-S3 multipart upload via presigned URLs; downloads via short-lived signed URLs only.
- **Localization:** `Accept-Language: ar|en` switches validation/notification strings.
- **Rate limits:** auth 5/min; claim endpoint 10/min per user; default 60/min.

## Endpoints by module

### M2 — Auth, users & roles
```
POST   /auth/login · POST /auth/logout · GET /auth/me · PUT /auth/me/password
GET|POST /users · GET|PUT|DELETE /users/{id}
PUT    /users/{id}/status            (activate / suspend — immediate token revoke)
GET|PUT /users/{id}/language-pairs   (translator portal visibility)
GET    /roles · GET /permissions · PUT /roles/{id}/permissions
```

### M3 — Clients & projects (PM)
```
GET|POST /clients · GET|PUT|DELETE /clients/{id}
GET|POST /projects · GET|PUT /projects/{id}
POST   /projects/{id}/publish        (draft → available)
POST   /projects/{id}/cancel         (reason required)
POST   /projects/{id}/withdraw       (claimed → available, reason required)
POST   /projects/{id}/files          (presigned upload init: category source|reference)
DELETE /projects/{id}/files/{fileId} (draft only)
PUT    /projects/{id}/files/{fileId}/manual-count   (scanned-doc fallback)
GET    /projects/{id}/timeline       (status_transitions history)
GET    /languages · GET /countries
```

### M4 — Translator portal
```
GET    /portal/queue                 (available projects for my language pairs,
                                      ordered: priority DESC, deadline ASC — server-enforced)
POST   /portal/claim/{projectId}     (atomic; 409 on race/active-file conflict)
GET    /portal/current               (my active assignment + files + instructions)
POST   /portal/deliver               (attach deliverable file, claimed → delivered)
GET    /portal/history               (my delivered work, read-only, with work durations)
```

**Realtime (Reverb websockets, replaces portal/bell polling):**
```
POST /broadcasting/auth              (Sanctum bearer + active middleware)

private-portal.{srcLangId}.{tgtLangId}   requires portal.access + owning the pair
  .project.published | .project.claimed | .project.withdrawn | .project.cancelled
  payload: portal-safe project summary (never client identity or pricing)

private-App.Models.User.{id}             owner only
  .project.delivered                     (to the project creator — data freshness)
  Laravel broadcast notifications        (all in-app notifications → live bell/toasts)
```

### M5 — Review & finalization (PM)
```
POST   /projects/{id}/review/open        (delivered → in_review)
POST   /projects/{id}/review/request-revision   (note required)
POST   /projects/{id}/review/approve     (requires letterhead_id + stamp_id selection)
POST   /projects/{id}/merge/retry        (after merge failure)
GET    /projects/{id}/final-file         (signed download URL)
```

### M6 — Dashboard
```
GET /dashboard/summary       (counts by status, late count, words/pages totals — cached 60s)
GET /dashboard/throughput    (completed per day/week, words per week — charts)
GET /dashboard/workload      (per-translator: current file, load, late flags)
GET /dashboard/late          (late & due-soon projects with reasons/ages)
```

### M7 — Reports (async exports)
```
GET  /reports/translators    (files, pages, words, hours per translator; date range)
GET  /reports/productivity   (delivered vs declared words, monthly target, achieved %; date range)
GET  /reports/daily_words    (day-by-day detail behind the above; optional translator_id)
GET  /reports/pms            (projects managed, on-time %, revision rates)
GET  /reports/monthly        (company summary)
GET  /reports/projects       (filterable registry)
POST /reports/export         ({report_type, params, format: xlsx|pdf} → report_exports job)
GET  /reports/exports        (my exports + status + signed download URLs)
```

`productivity` and `daily_words` exist because docs/00 defines the accountant as
reading productivity reports **for payroll** — they hand over the figures, and the
incentive arithmetic stays in the accountant's own spreadsheet. **No rate, salary,
tier, bonus or deduction is computed anywhere in this system**; a payroll engine is
a separate paid module (see docs/HANDOFF.md §7b and §10).

Two columns, never one: `delivered_words` is the system's own count, credited on the
delivery date; `declared_words` is what the translator recorded for that day. The gap
between them is expected — a file claimed Monday and delivered Thursday puts every
word on Thursday — and both screens say so on the page.

### M4b — The translator's own daily word log
```
GET  /portal/daily-words     (portal.access; ?month=YYYY-MM, defaults to the current month.
                              Own rows only; the current month stops at today)
POST /portal/daily-words     (portal.access; {work_date, declared_words, note} — upsert per day.
                              Rejects the future, back-dating past 45 days, and >20,000 words.
                              Every edit is activity-logged under `daily-words`)
```

### M8 — Activity log (admin only)
```
GET /activity-log            (filter: user, project, action type, date range; read-only — no mutations exist)
```

### M9 — Letterheads & stamps (admin)
```
GET  /letterheads                (letterheads.view; filters: kind, active)
GET  /letterheads/{id}/asset     (letterheads.view; inline stream for previews)
POST /letterheads                (letterheads.manage; multipart: name, kind, asset PNG|JPG|PDF ≤10MB,
                                  is_active, placement JSON)
PUT|DELETE /letterheads/{id}     (letterheads.manage; asset replacement uses POST + _method=PUT,
                                  delete blocked while a project references the template)
POST /letterheads/{id}/preview   (letterheads.manage; renders the template over a
                                  two-page Arabic specimen and returns the PDF inline)
```

`placement` (normalized on write by `App\Support\PlacementConfig`, physical page geometry in mm):
```
pages: all|first|last · anchor: {top|middle|bottom}-{left|center|right}
offset_x_mm · offset_y_mm · width_mm (null = full page width) · opacity · layer: background|foreground
```

Letterheads carry two extra keys describing the band their own artwork occupies:
```
content_top_mm · content_bottom_mm     (default 0 = overlay only, no reflow)
```
When either is set, `MergeFinalFileJob` scales each deliverable page down to fit
between them, so translated text can never land on the header/footer artwork.
`PlacementConfig::resolveContentRect()` computes it; `web/src/lib/placement.ts`
(`contentBandStyle`) mirrors it for the admin preview — **change both together**.

Stamp assets are trimmed to their ink bounding box on upload
(`App\Support\ImageTrimmer`): offices scan a stamp on a full sheet, and without the
trim `width_mm` would size the *paper* rather than the stamp.

### M10 — Notifications
```
GET  /notifications · PUT /notifications/read (ids[]) · PUT /notifications/read-all
GET|PUT /notification-preferences     (personal — no permission gate)
```

Preferences switch the **mail channel only**; `database` (the bell, system of record) and
`broadcast` (live toast) are always on. Families are registered in
`App\Support\NotificationPreferences` — `project_available`, `project_delivered`,
`revision_requested`, `project_withdrawn`, `deadline_alerts`, `report_ready`,
`merge_status` (M9b: final file ready / merge failed), `quote_received` (M13: a new
website quote request) — all defaulting to mail-on. A missing row means "default", so `PUT` takes a partial map:
```
PUT  { "preferences": { "deadline_alerts": false } }
GET  { "data": {family: bool, …}, "families": [{key, label, description}, …] }
```
Every `via()` builds its channel list through `RespectsMailPreference::channelsFor()`;
new notification classes must do the same or they silently bypass the opt-out.

### M13 — Public website & quote requests

The only unauthenticated surface in the system. Everything here is reachable by
anyone on the internet, so each route is rate-limited and each response is
deliberately narrower than its staff-side twin.

```
GET  /public/languages                    (the form's language catalogue)
GET  /public/quote-requests/limits        (max files / size / extensions — the UI reads
                                           its own limits so it can't drift from validation)
POST /public/quote-requests               (throttle:quote-submissions — 5/hour per IP;
                                           multipart, up to 10 files × 25 MB, document
                                           formats only; returns the tracking reference)
GET  /public/quote-requests/{reference}   (throttle:quote-lookups — 20/min per IP)
```

Staff side:
```
                                          -- quotes.view --
GET  /quote-requests                      (filters: q, status, priority, open=1; server-side sort)
GET  /quote-requests/{id}
GET  /quote-requests/{id}/files/{fileId}  (attachment download)

                                          -- quotes.manage --
PUT  /quote-requests/{id}/status          (new|reviewing|accepted|declined — accepted
                                           requires a sent quote; converted is terminal)
POST /quote-requests/{id}/respond         (quoted_amount, currency, turnaround_days,
                                           response_note, notify_client — mails the requester)
DELETE /quote-requests/{id}               (soft delete; blocked once converted)

                                          -- quotes.convert --
POST /quote-requests/{id}/convert         (creates a draft Project + optional Client,
                                           copies attachments in as source files)
```

**Why answering and converting are separate permissions.** Pricing an enquiry is
accounting work, so the **accountant holds `quotes.manage`** and replies to the client
themselves — they are also notified when a request arrives (the notification targets
`quotes.manage`, not `quotes.view`). Converting is not accounting: it opens a project and
puts work in front of translators, so `quotes.convert` stays with the PM and admin. An
accepted request the viewer cannot convert shows a hand-off banner rather than looking
stuck. Same three-way shape as `projects.view|manage|review`.

**Status lane** — separate from the project state machine on purpose; nothing here is
claimable, countable or assignable:
```
new → reviewing → quoted → accepted → converted
                     ↓         ↓
                  declined ←───┘        (declined is reopenable; converted is not)
```

**The reference is the credential.** `RQ-4KX7-9M2D` is eight characters from a
31-symbol alphabet (~40 bits) with the confusable glyphs — `0/O`, `1/I/L` — removed,
generated by `App\Services\QuoteReferenceGenerator`. Anyone holding it sees the quote,
which is the point: visitors have no account. Two rules follow, and both are load-bearing:

- References are **random, never sequential**. A sequential code would let one visitor
  count up to everyone else's quote.
- `PublicQuoteRequestResource` shows quote figures only once `responded_at` is set, so a
  price a manager is still typing never leaks to a client refreshing the page.

**Rate limiters must stay named.** `RateLimiter::for('quote-submissions'|'quote-lookups')`
is registered in `AppServiceProvider`. An inline `throttle:5,60` would key off domain+IP
and *not* the path — one bucket shared with every other unauthenticated throttled route,
so five quote submissions would lock the same visitor out of `/auth/login` for an hour.
`QuoteRequestTest::test_exhausting_the_public_submission_limit_does_not_lock_the_login_endpoint`
pins this down; it fails the moment someone inlines the throttle again.

**Conversion copies, never moves.** `QuoteRequestController::copyAttachments()` duplicates
the visitor's uploads into `projects/{id}/source/`. The originals stay under
`quote-requests/{id}/` so the request remains auditable evidence of what was actually
priced, even after the project's own files are revised.

## Document-processing pipeline (queue jobs)

| Job | Trigger | Does |
|---|---|---|
| `CountWordsJob` | source file uploaded | DOCX → parse XML (PHPWord); readable PDF → pdftotext; scanned → mark `not_applicable`, prompt manual count |
| `MergeFinalFileJob` | approve transition | deliverable → PDF via Gotenberg (PDFs pass through untouched; a .docx has its page margins widened first so the text reflows inside the content band at full size) → FPDI redraw: letterhead behind, deliverable page inside the content band, stamp on top → store as `final` file → transition to `completed`. On failure the project **stays `approved`** with `merge_error` set and PM+admin notified; `POST /projects/{id}/merge/retry` re-runs it |
| `GenerateReportJob` | export request | build xlsx (Laravel Excel) / PDF, store, notify requester |
| `DeadlineScannerCommand` | scheduler (5 min) | flag due-soon/late, fire one-time notifications per escalation level |
