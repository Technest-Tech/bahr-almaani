# Fonts for document conversion

Drop `.ttf` / `.otf` files here. They are mounted read-only into the Gotenberg
container at `/usr/share/fonts/truetype/office` and picked up by LibreOffice on the
next `docker compose up -d gotenberg`.

## Why this directory exists

LibreOffice re-paginates a document whenever it cannot find the font it was written
in. A translator delivered a `.docx` set in **Sakkal Majalla**; Word had recorded it
as 12 pages, and the converter produced **20**. Nothing was duplicated and no text
was lost — the substituted face has different metrics, so every line rewrapped and
the document simply grew. The office reported it as "the result has double the pages
of the original".

The merge is not involved: it takes whatever the converter produces, page for page.
Verified on the real file — 20 pages in, 20 pages out.

## Which fonts to add

Whatever the office actually types in. So far, from their delivered files:

| Font | Ships with | Notes |
|---|---|---|
| Sakkal Majalla | Windows / Microsoft Office | The one that caused the reflow |
| Aptos, Aptos Display | Microsoft 365 | Default in current Word |
| Arial, Times New Roman | Windows / Office | Metric-compatible substitutes already exist (Liberation) |

To find what a specific `.docx` needs:

```bash
unzip -p file.docx word/fontTable.xml | grep -o 'w:name w:val="[^"]*"'
```

## Licensing — read before adding

These are proprietary Microsoft fonts. **They must not be committed to this repo.**
The office is licensed to use them on machines they own, so copy them onto the server
from a licensed Windows/Office installation (`C:\Windows\Fonts`) rather than
downloading them, and keep them out of git:

```bash
scp "Sakkal Majalla.ttf" bahr:/var/www/bahr-almaaani/docker/fonts/
ssh bahr 'cd /var/www/bahr-almaaani && docker compose -f docker-compose.prod.yml up -d gotenberg'
```

`.gitignore` in this directory keeps every font file untracked; only this README is
committed.

## Verifying

```bash
# is the font visible to LibreOffice?
docker compose -f docker-compose.prod.yml exec gotenberg fc-list | grep -i majalla

# does the page count now match?
docker compose -f docker-compose.prod.yml exec app php artisan tinker
```

Even with the correct font installed, LibreOffice pagination is not guaranteed to
match Word to the page — hyphenation and line-breaking differ slightly. With the
right font it is close; with the wrong one it is not close at all.
