# Build Guidelines — read before touching scope

These are hard constraints for this project, not suggestions. If a change
would violate one of these, it goes in DOCUMENTATION.md's Phase 2 list
instead of getting built now.

1. **No backend, except the one sanctioned exception below.** If a new
   feature seems to need a server, default answer is still no — redesign
   the feature. The AI Verdict proxy is the single approved exception,
   and it doesn't open the door to adding others without the same
   explicit sign-off.
2. **No paid or approval-gated third-party service, except Gemini's free
   tier for AI Verdict.** No AdSense script, no Stripe integration, no
   other ML API. This is the entire reason this idea replaced the CRM —
   don't reintroduce the same bottleneck outside the one carved-out case.
3. **No dataset.** Any list the matching logic needs (stopwords, skill
   hints) must be a small hardcoded array committed in the source, not
   fetched, not trained, not scraped.
4. **Nothing leaves the browser, except when a user explicitly clicks "Get
   AI verdict."** The keyword-matching core must keep working exactly as
   before with zero network calls. The AI feature is opt-in per click,
   never automatic, and always disclosed on the control that triggers it.
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
