# Build Guidelines — read before touching scope

These are hard constraints for this project, not suggestions. If a change
would violate one of these, it goes in DOCUMENTATION.md's Phase 2 list
instead of getting built now.

1. **No backend, except the sanctioned exceptions below.** If a new
   feature seems to need a server, default answer is still no — redesign
   the feature. The AI Verdict proxy and the visit counter are the only
   approved exceptions, and neither opens the door to adding others
   without the same explicit sign-off.
2. **No paid or approval-gated third-party service, except Gemini's free
   tier for AI Verdict and Google AdSense (see its sanctioned-exception
   entry below — approved once an actual AdSense account existed to wire
   up).** No Stripe integration, no other ML API. This is the entire
   reason this idea replaced the CRM — don't reintroduce the same
   bottleneck outside the carved-out cases. Cloudflare KV (backing the
   visit counter) doesn't count as a new third-party dependency either —
   it's the free tier of the same host already serving the site, not an
   external service being added.
3. **No dataset.** Any list the matching logic needs (stopwords, skill
   hints) must be a small hardcoded array committed in the source, not
   fetched, not trained, not scraped.
4. **No resume or JD text ever leaves the browser, except when a user
   explicitly clicks "Get AI verdict."** The keyword-matching core must
   keep working exactly as before with zero network calls carrying that
   text. The AI feature is opt-in per click, never automatic, and always
   disclosed on the control that triggers it. (The visit counter is a
   narrow, disclosed carve-out to the *automatic* half of this rule — see
   its sanctioned-exception entry below — but it never carries resume/JD
   content or any per-visitor identifier, so the substance of this rule
   still holds.)
5. **One page, one job.** Paste JD, paste resume, get score + gaps. Any
   feature request that isn't that gets written down for Phase 2, not
   bolted on now.
6. **Zero build tooling.** No npm, no bundler, no framework. Open
   `index.html` in a browser and it works. This keeps iteration instant
   and hosting free (any static host, no build step to configure).
7. **Accessible by default.** Never encode meaning in color alone (score
   bands need a text label, not just red/green). Keep contrast readable.
   Layout must work on a phone screen — recruiter traffic checking a CV
   link is likely mobile-heavy.
8. **Finish the MVP before polishing the algorithm.** Good-enough keyword
   matching that ships beats a perfect matcher that doesn't.
9. **Before adding anything not listed in DOCUMENTATION.md's MVP scope,
   ask: does this cost money, require third-party approval, or need a
   dataset?** If yes to any, it's Phase 2 — stop and flag it instead of
   building it.

## Sanctioned exception: the AI Verdict proxy

This exists because an LLM API key cannot be embedded in client-side JS
without being stealable. Its scope is locked to exactly this:
- Holds one secret (the Gemini API key) and relays one request type
  (resume + JD + our computed score/keywords → short verdict text).
- No logging of request or response bodies. No database. No user
  identifiers of any kind pass through it.
- If a future idea needs the proxy to do a *second* thing, that is a new
  decision requiring the same explicit go-ahead this one got — it does
  not get bundled in silently because "the proxy already exists."
- Any account/API-key creation this requires is done by the human running
  this project, never by an agent acting on their behalf.

## Sanctioned exception: the visit counter

`site-worker.js` (the Worker serving gudanah.com itself, per root
`wrangler.toml`) handles exactly one dynamic route, `/api/visits` —
increments a single Workers KV counter and returns the new total. Scope:
- One KV key, one number. No per-visitor tracking, no IP/user-agent
  logging, no cookies — the count is a shared aggregate, not analytics.
- Best-effort, not strictly atomic (KV get-then-put has a race window
  under concurrent requests) — accepted tradeoff rather than pulling in a
  Durable Object for a vanity number.
- Same rule as the AI proxy: a second responsibility for this endpoint is
  a new decision, not a silent add-on.

## Sanctioned exception: Google AdSense

The site's monetization plan (see DOCUMENTATION.md) always intended
AdSense once an account existed to wire up — this is that. Scope:
- Site-wide verification/loader script in `index.html`
  (`adsbygoogle.js?client=ca-pub-...`) and `public/ads.txt`, both required
  by Google for the site to be reviewable and for ads to serve at all.
- Manual ad units only, one per reserved slot, gated by `AD_SLOTS` in
  `app.js` — a slot renders a real ad only once given an actual ad-slot
  ID from the AdSense dashboard; until then it's the same plain
  placeholder as before. No Auto ads (Google choosing placement anywhere
  on the page), by explicit choice.
- Ad slots never render into a `display:none` container (checked at
  render time) — AdSense policy prohibits requesting ads into hidden
  elements, which the skyscraper slots are below 1400px viewport width.
- Publisher ID (`pub-9516689459519928`) is not a secret — it's public in
  every AdSense site's page source — but ad-slot IDs and any account
  changes (creating units, toggling Auto ads, requesting review) are the
  human running this project's to do, never an agent's.
