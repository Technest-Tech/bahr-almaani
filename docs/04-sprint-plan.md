# 04 — Sprint Plan (8 weeks / 4 sprints)

Vertical slices: every sprint ends with something the client can click on the **staging server**.
Contract value shown per sprint for invoicing milestones (total 85,000 EGP).

## Sprint 1 — Foundation & Users (weeks 1–2) · M1 + M2 + merge spike · 14,000 EGP

**Goal:** production-grade skeleton deployed; login and user management working end-to-end.

- Repos (`api`, `web`), Docker Compose (Postgres, Redis, Meilisearch, Gotenberg, Reverb), GitHub Actions CI/CD, staging server + Sentry
- All migrations from [01-database-schema.md](01-database-schema.md), seeders (roles, languages, admin)
- Auth (Sanctum), RBAC, user CRUD, suspend with token revoke, language-pair management
- Next.js shell: RTL Arabic layout, theme, navigation per role, login, users screens
- **⚠️ Letterhead merge spike (de-risk the 11k item):** prototype Gotenberg + FPDI pipeline on a real client letterhead/stamp sample → client approves output quality
- **Client sign-off gate:** state machine document ([02](02-state-machine.md))

**Demo:** login as admin → create PM & translator users → suspend one live → show merged sample PDF.

## Sprint 2 — Projects & Lifecycle Core (weeks 3–4) · M3 + M8-infra + part M5 · ~17,000 EGP

**Goal:** PM can run the full intake flow; state machine enforced in code.

- Clients CRUD, project create/edit/publish/cancel with code generation (`BM-2026-NNNNN`)
- Direct-to-S3 uploads (source + reference), `CountWordsJob` (DOCX + readable PDF, manual fallback)
- `TransitionService` + policies + `status_transitions` history + activity log recording (spatie) on everything
- Projects list: TanStack Table with server-side filters/search (Meilisearch), project detail with timeline
- **Demo:** create client → create project with passport reference file → watch word count appear → publish → timeline shows every step.

## Sprint 3 — Translator Portal & Realtime (weeks 5–6) · M4 + rest of M5 + M10 · ~26,000 EGP

**Goal:** the heart of the system — concurrency-safe claiming with live updates.

- Portal queue (priority + deadline ordering, language-pair filtered), atomic claim (`FOR UPDATE` + partial unique indexes), one-active-file enforcement
- Reverb realtime: claimed files vanish from other portals instantly; live notification badge
- Deliver flow, PM review (open / request revision / approve), revision loop, withdraw flow
- Automatic time tracking (claim → deliver), visible on assignment & history
- Notifications: in-app + email (delivery, revision, withdraw, due-soon, late) + `DeadlineScannerCommand`
- **Load test the claim race:** scripted 50 concurrent claims on one file → exactly one winner, 49 clean 409s
- **Demo (the wow moment):** two translator accounts side-by-side — one claims, file vanishes from the other screen in real time; deliver → PM gets notified → requests revision → re-deliver → approve.

## Sprint 4 — Dashboard, Reports, Letterhead & Launch (weeks 7–8) · M6 + M7 + M9 + M12 · ~28,000 EGP

**Goal:** management value layer + production launch.

- Dashboard: KPIs by status, late list, words/pages totals, throughput charts, per-translator workload
- Reports (translator / PM / monthly / registry) + async Excel & PDF exports
- Letterhead & stamp CRUD with previews; production merge pipeline on approve; retry on failure
- Activity log UI (admin-only), notification preferences
- Hardening: rate limits, backup automation + restore drill, permission audit, RTL/browser QA pass
- UAT week with real staff on staging → fixes → **production deployment**
- Training session (recorded) + Arabic user guide + handover docs
- **Demo:** full lifecycle client → final letterheaded file, then dashboard + exported monthly report.

## Rules of engagement

1. **Sprint demo every 2 weeks with the client** — feedback goes into the backlog; anything beyond contract scope is a written change request (protects the fixed price).
2. **Definition of Done:** code reviewed, feature tests green in CI (state machine transitions 100% covered), deployed to staging, RTL-checked, activity-logged.
3. **No horizontal work:** nothing is "done" until it's clickable in the UI against real API.
4. **Weekly risk check:** merge quality (S1 spike), claim concurrency (S3 load test), scanned-file counts (manual fallback communicated to client early).

## Milestone → invoice mapping

| Milestone | When | Value delivered |
|---|---|---|
| S1 accepted | end W2 | 14,000 EGP |
| S2 accepted | end W4 | ~17,000 EGP |
| S3 accepted | end W6 | ~26,000 EGP |
| S4 accepted + production live | end W8 | ~28,000 EGP |
