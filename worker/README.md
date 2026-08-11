# Deploying the AI Verdict proxy

This is the one piece I can't do for you — it needs your own free accounts
and API key. Everything else (the code, the prompt, the UI) is already
built and wired to call whatever URL you end up with.

## 1. Get a free Gemini API key
1. Go to Google AI Studio (ai.google.dev) and sign in with a Google account.
2. Create an API key (no payment method required for the free tier).
3. Copy the key somewhere safe — you'll paste it once in step 3 below and
   never need to put it in any file in this repo.

## 2. Get a free Cloudflare account
1. Sign up at cloudflare.com (free plan is enough — Workers free tier
   covers 100,000 requests/day, far beyond what this tool needs to start).
2. Install Wrangler (Cloudflare's CLI), from this `worker/` folder:
   ```
   npm install -g wrangler
   wrangler login
   ```
   This opens a browser window to authorize the CLI against your account.

## 3. Configure and deploy
From this `worker/` folder:
```
wrangler secret put GEMINI_API_KEY
```
Paste the key from step 1 when prompted — this stores it encrypted on
Cloudflare's side, never in a file, never in this repo.

Then deploy:
```
wrangler deploy
```
Wrangler prints a URL like `https://gudanah-ats-ai-verdict.<your-subdomain>.workers.dev`.
That's your `AI_VERDICT_ENDPOINT`.

## 4. Wire it into the site
Open `../app.js` and set:
```js
const AI_VERDICT_ENDPOINT = "https://gudanah-ats-ai-verdict.<your-subdomain>.workers.dev";
```
The "Get AI verdict" button is hidden until this is set — leaving it empty
is exactly how the tool behaves today, with the keyword checker working
standalone.

## 5. Lock down CORS (do this before going live — not optional)
`wrangler.toml` currently sets `ALLOWED_ORIGIN = "*"`, which lets any
website call your proxy — fine for local testing, but once gudanah.com is
live, tighten it to stop other sites from riding your free Gemini quota:
```
wrangler secret put ALLOWED_ORIGIN
```
(or edit the `[vars]` value in wrangler.toml) and set it to
`https://gudanah.com`.

The worker now actively rejects requests whose `Origin` header doesn't
match `ALLOWED_ORIGIN` once it's set to something other than `"*"` (not
just advisory CORS response headers) — see `index.js`. This blocks
browser-based abuse from other sites; it does not stop someone calling the
URL directly with curl (no `Origin` header to check), so treat the Worker
URL itself as something not worth publicizing beyond what the page needs.

## 6. Optional: add a Cloudflare rate-limiting rule
The Worker has no built-in per-IP throttling (adding stateful rate
limiting would be a second responsibility for this proxy — see
GUIDELINES.md). If abuse becomes a real problem, add a rate-limiting rule
in the Cloudflare dashboard in front of the Worker route instead of
building it into the code here.

## Notes
- The worker logs nothing and stores nothing — it's a stateless relay.
- If Gemini's free-tier rate limit is ever hit, the button shows a plain
  "couldn't get an AI verdict" message; the keyword checker itself is
  unaffected either way.
