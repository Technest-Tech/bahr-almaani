# Bahr Al-Maaani — Translation Services Management System

Enterprise operations platform for a certified translation company (100+ employees):
project lifecycle management, smart translator portal with concurrency-safe file claiming,
automatic time tracking, word/page counting, letterhead & stamp merging, reporting, and a full audit trail.

**Stack:** Laravel 12 (API) · PostgreSQL · Redis + Horizon · Reverb (WebSockets) · Next.js + TypeScript · Tailwind + shadcn/ui · Gotenberg (document engine) · Docker

## Documentation

| Doc | Purpose |
|---|---|
| [docs/00-overview.md](docs/00-overview.md) | Vision, personas, stack, non-functional requirements, risks |
| [docs/01-database-schema.md](docs/01-database-schema.md) | ERD, tables, indexes, locking strategy |
| [docs/02-state-machine.md](docs/02-state-machine.md) | Project lifecycle, transition permission matrix, business rules |
| [docs/03-modules-and-api.md](docs/03-modules-and-api.md) | Module breakdown (mapped to contract items), API contract |
| [docs/04-sprint-plan.md](docs/04-sprint-plan.md) | 8-week / 4-sprint delivery plan with demo milestones |

Source requirements (client documents, Arabic): `requirments.pdf`, `وثيقة مواصفات نظام إدارة خدمات الترجمة (1).docx`, `translation_system_proposal (1).xlsx`

## Local development

Prerequisites: PHP ≥ 8.2, Composer, Node ≥ 22, Docker Desktop.

```bash
# 1. Backing services (Postgres :5434, Redis :6379, Meilisearch :7700, Gotenberg :3300, Mailpit UI :8025)
docker compose up -d

# 2. API (http://localhost:8000)
cd api
composer install
cp .env.example .env && php artisan key:generate
php artisan migrate --seed
php artisan serve

# 3. Web (http://localhost:3000)
cd web
npm install
npm run dev
```

**Dev accounts** (password: `password`): `admin@bahr.local` (الإدارة), `pm@bahr.local` (مدير مشاريع), `translator1@bahr.local` / `translator2@bahr.local` (مترجمون), `accountant@bahr.local` (محاسب).

**Tests** (run against the `bahr_test` Postgres database created automatically by the Docker init script):

```bash
cd api && php artisan test
```

**Port notes for this machine:** host Postgres port is **5434** and Gotenberg is **3300** because 5432/5433/3030 are taken by other local projects.
