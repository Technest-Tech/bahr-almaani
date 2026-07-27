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
GET  /reports/pms            (projects managed, on-time %, revision rates)
GET  /reports/monthly        (company summary)
GET  /reports/projects       (filterable registry)
POST /reports/export         ({report_type, params, format: xlsx|pdf} → report_exports job)
GET  /reports/exports        (my exports + status + signed download URLs)
```

### M8 — Activity log (admin only)
```
GET /activity-log            (filter: user, project, action type, date range; read-only — no mutations exist)
```

### M9 — Letterheads & stamps (admin)
```
GET|POST /letterheads · PUT|DELETE /letterheads/{id}
POST /letterheads/{id}/preview   (render sample merge on a test page)
```

### M10 — Notifications
```
GET  /notifications · PUT /notifications/read (ids[]) · PUT /notifications/read-all
GET|PUT /notification-preferences
```

## Document-processing pipeline (queue jobs)

| Job | Trigger | Does |
|---|---|---|
| `CountWordsJob` | source file uploaded | DOCX → parse XML (PHPWord); readable PDF → pdftotext; scanned → mark `not_applicable`, prompt manual count |
| `MergeFinalFileJob` | approve transition | deliverable → PDF via Gotenberg → overlay letterhead (FPDI) + stamp per `placement` config → store as `final` file → transition to `completed` |
| `GenerateReportJob` | export request | build xlsx (Laravel Excel) / PDF, store, notify requester |
| `DeadlineScannerCommand` | scheduler (5 min) | flag due-soon/late, fire one-time notifications per escalation level |
