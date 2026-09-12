# Shingo Voice

A tiny, static, no-build two-page site for collecting playful, off-the-cuff
reflections on the Shingo Guiding Principles, hosted on GitHub Pages and
backed directly by Supabase.

## Pages

- **`/` (`index.html`)** — the public survey. Shows a visitor one randomly
  chosen Shingo Guiding Principle, asks them to explain what it means to
  them in their own words, then reveals a lighthearted, invented "assessors
  panel" verdict (three fictional judges, heuristic + random scoring) on a
  celebratory "certificate of insight" card. Not a real evaluation of
  anything — just for fun.
- **`/dashboard/` (`dashboard/index.html`)** — a manager-facing live
  analytics view: visit/submission counts and trend, conversion rate,
  average panel score, submissions per principle, a score-distribution
  histogram, and a table of recent (truncated) submissions. Gated behind a
  client-side passphrase prompt (see below) that is a UI deterrent, not real
  access control.

## How it talks to Supabase

Both pages load the Supabase JS client from a CDN
(`@supabase/supabase-js@2` UMD build) and connect directly to the project
using its public anon ("publishable") key, hardcoded in
`assets/config.js` (survey page) and duplicated inline in
`dashboard/dashboard.js` (dashboard page — duplicated rather than shared
via a module, since there's no bundler in this project).

**This is intentional and safe.** The anon key is meant to be public; it
grants no privileged access. All real access control is enforced by
Postgres Row Level Security (RLS) policies already applied to the database,
scoped as follows:

| Object | Type | Anon access | Purpose |
|---|---|---|---|
| `principles` | table | `SELECT` only | `id`, `title`, `summary`, `sort_order` — the 10 seeded Shingo Guiding Principles, used to pick and display one at random. |
| `page_views` | table | `INSERT` only (no `SELECT`) | Logs `session_id` + `principle_id` the moment a principle is shown, to measure visits vs. conversions. |
| `responses` | table | `INSERT` only (no `SELECT`) | Logs `session_id`, `principle_id`, `response_text` (1-4000 chars), `score` (0-100), and `panel` (jsonb array of judge verdicts) on submit. |
| `analytics_events` | view | `SELECT` | `created_at`, `principle_id`, `kind` (`'view'` \| `'response'`), `score` (null for views). No raw text or session ids — safe to pull in full for the dashboard's KPIs/trend/histogram. |
| `review_feed` | view | `SELECT` | Most recent 200 submissions: `id`, `created_at`, `principle_id`, `response_excerpt` (already truncated to 150 chars by the DB), `score`. The untruncated `response_text` is never exposed to anon. |

Because the anon key can only ever reach these tightly-scoped
tables/views, it's fine that it's committed in plain text to this public
repository. No names, emails, IP addresses, or other personal data are
collected — only an anonymous, per-tab `session_id` (a random UUID) and the
free-text answer the visitor chooses to type.

## Changing the dashboard passphrase

The dashboard prompt is a **UI deterrent only** — it hides the page from
casual visitors; it is not real security (real protection is the RLS setup
above). To change it:

1. Pick a new passphrase.
2. Compute its SHA-256 hex digest, e.g. in any browser console:
   ```js
   crypto.subtle.digest("SHA-256", new TextEncoder().encode("your-new-phrase"))
     .then(buf => console.log(Array.from(new Uint8Array(buf))
       .map(b => b.toString(16).padStart(2, "0")).join("")));
   ```
3. Replace the `PASSPHRASE_SHA256_HEX` constant near the top of
   `dashboard/dashboard.js` with the new hex string. The plaintext
   passphrase itself is never stored in the shipped file, only its hash.

## Local structure

```
index.html                 survey page
assets/config.js           Supabase URL + anon key
assets/app.js               survey logic (principle fetch, panel heuristics, submit)
assets/style.css            shared design tokens + survey styles
dashboard/index.html        manager dashboard page
dashboard/dashboard.js       passphrase gate + data fetch/render + 30s auto-refresh
dashboard/dashboard.css      dashboard styles (duplicates the shared tokens from assets/style.css)
.nojekyll                    tells GitHub Pages not to run Jekyll processing
```

## Deploying

This repo is plain static files with no build step. Push it to a public
GitHub repo and enable GitHub Pages on the root of the default branch —
nothing else is required.
