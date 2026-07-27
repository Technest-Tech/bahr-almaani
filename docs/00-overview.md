# 00 — System Overview

## Vision

Replace WhatsApp + Excel + shared folders with a single operations platform that answers, in seconds:
who is working on which file, what is late and why, what is each translator's real productivity,
and where the final letterheaded/stamped deliverable is.

Category: **Translation Business Management System (TBMS)** — the Plunet/XTRF category,
localized for Egyptian certified translation offices (Arabic-first RTL UI, letterhead/stamp
workflow, embassy/ministry document handling).

## Personas & roles

| Role | Arabic | What they do | What they see |
|---|---|---|---|
| **Admin** | الإدارة | Full control, user management, letterheads, audit trail, all reports | Everything |
| **Project Manager** | مدير مشاريع | Creates projects, uploads files, sets deadlines/priority, reviews deliveries, approves & finalizes | Own/all projects (configurable), no salaries |
| **Translator** | مترجم | Claims available files (matching their language pairs), delivers translations | Portal queue + own history only |
| **Accountant** | محاسب | Reads productivity/financial reports for payroll & client billing | Reports only, read-only |

Roles are permission bundles (spatie/laravel-permission) — custom roles can be added later without schema changes.

## Core business rules (from client requirements)

1. **Exclusive claim** — the moment a translator claims a file it disappears from all other portals, atomically (DB-enforced, not just UI).
2. **One active file per translator** — cannot claim a new file while holding an undelivered one (DB-enforced).
3. **Priority-ordered portal** — urgent first, then by nearest deadline. Always. No manual reordering by translators.
4. **Automatic time tracking** — claim timestamp → delivery timestamp; no manual entry anywhere.
5. **Automatic word/page counting** on upload (DOCX/readable PDF; scanned files get manual count fallback until OCR phase).
6. **Letterhead & stamps merged by the system**, never by hand.
7. **Audit trail is admin-only** and records every state-changing action with actor + timestamp.
8. **Notifications**: in-app + email on delivery; early warnings for due-soon and late projects.

## Technology stack & rationale

| Layer | Choice | Why |
|---|---|---|
| Backend | Laravel 12, API-only modular monolith | Team expertise, mature ecosystem, right-sized for scale |
| Database | PostgreSQL 16 | Partial unique indexes + `SELECT … FOR UPDATE` solve claim concurrency at DB level |
| Cache/queues | Redis + Laravel Horizon | All heavy work (counting, merging, exports, mail) is async |
| Realtime | Laravel Reverb (WebSockets) | Live portal updates on claim/publish/withdraw |
| Search | Meilisearch (Laravel Scout) | Instant Arabic-friendly search over thousands of projects |
| Auth | Laravel Sanctum | SPA token auth |
| Permissions | spatie/laravel-permission | Flexible roles |
| Audit | spatie/laravel-activitylog | Battle-tested audit trail |
| Frontend | Next.js 15 + TypeScript | Bespoke enterprise UX (deliberately **not** an admin-panel generator) |
| UI kit | Tailwind CSS + shadcn/ui + TanStack Table/Query | Enterprise data grids, RTL support, full design control |
| Charts | Recharts | Dashboard KPIs |
| Documents | Gotenberg (LibreOffice, Docker) + PHPWord + FPDI/TCPDF | Conversion, word counts, letterhead/stamp overlay |
| Storage | S3-compatible (DO Spaces / MinIO) | Thousands of files off the app server |
| Infra | Docker Compose on VPS, GitHub Actions CI/CD, Sentry | Same proven pattern as previous deployments |

## Non-functional requirements

- **Arabic-first RTL UI**, English secondary. IBM Plex Sans Arabic. Light + dark themes.
- **Performance:** portal and dashboard interactions < 300 ms; all document processing async with visible job status.
- **Concurrency:** claim race conditions impossible by construction (see [01-database-schema.md](01-database-schema.md#concurrency-strategy)).
- **Security:** RBAC on every endpoint, signed temporary URLs for file downloads, no direct S3 exposure, rate limiting, full HTTPS.
- **Reliability:** nightly DB + storage backups, queue retry with dead-letter handling, Sentry alerting.
- **Auditability:** every state transition recorded; audit log immutable (no update/delete endpoints).
- **Future-proofing:** multi-tenant-ready (`company_id` discriminator from day one, single tenant in Phase 1); AI Phase 2 (MT drafts, AI assistant, OCR, translation memory) plugs into the same project/file model.

## Top risks & mitigations

| Risk | Mitigation |
|---|---|
| Letterhead/stamp merge quality (the 11k EGP item, hardest technical piece) | Prototype merge pipeline in Sprint 1 spike; client signs off on sample output early |
| Word counts disputed for scanned documents | Explicit `count_source` flag (auto/manual); OCR deferred to Phase 2 by contract |
| Hidden workflow rules (reassignment, sick translator, rejected work) | State machine document signed off by client before Sprint 2 |
| Scope creep on reports | Report catalog fixed in [03-modules-and-api.md](03-modules-and-api.md); extras are change requests |
