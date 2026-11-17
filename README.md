# Owner's Manual

Personal site. Plain HTML + one CSS file. No framework, no build step.

- `index.html` — the manual (home page). Placeholders are in `[BRACKETS]`.
- `style.css` — all styling. Change `--spot` at the top to recolor everything.
- `writing/` — posts ("service bulletins").

## Writing a new bulletin

1. Copy `writing/_template.html` to `writing/sb-000N.html`.
2. Fill it in.
3. Add a `<li>` for it at the top of `writing/index.html` and in section 4.0 of `index.html`.

## Hosting

GitHub Pages: Settings → Pages → Deploy from branch → `main` / `(root)`.
`.nojekyll` makes Pages serve files as-is.
