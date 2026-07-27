<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project UI conventions (بحر المعاني) — follow on EVERY new page

- **Full width always**: app pages use `w-full` — never `mx-auto max-w-*` wrappers (owner requirement). Only the login screen is centered.
- **Font**: Almarai via `next/font` (`--font-almarai`); do not introduce other fonts.
- **RTL-first**: logical properties only (`ms-/me-/ps-/pe-/text-start`) — never `ml-/mr-/text-left`.
- **Structure**: pages start with `<PageHeader>`; tables use `<DataTable>` with filters passed via its `toolbar` prop (sorting + column toggle come built in); forms use `<Card>` + `<FormSection>` (Stripe-style sections) with a `CardFooter` action bar; labels+errors via `<Field>`.
- **Feedback**: toasts (`sonner`) for success/error; `useConfirm()`/`prompt()` from `@/components/confirm` for destructive actions — never browser `alert/confirm/prompt`.
- **Theme**: use design tokens (`bg-card`, `text-muted-foreground`, `border`, tones via `<ToneBadge>`); must look right in light AND dark mode.
- **Verify visually**: after UI changes, run the Playwright check (playwright-core devDep + cached Chromium; see git history `ui-check*.mjs` scripts) and look at the screenshots before claiming done.
