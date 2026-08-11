// Cloudflare Worker — Gemini proxy for the AI Verdict feature.
//
// Scope is intentionally narrow (see GUIDELINES.md "Sanctioned exception"):
// holds one secret (GEMINI_API_KEY) and relays one request shape
// (resume + JD + our own computed score/keywords -> short verdict text).
// No logging of bodies, no storage, no other responsibilities.

const MAX_FIELD_LENGTH = 6000;
const SYSTEM_PROMPT = `You are helping a recruiter quickly assess one candidate against one job description.
You are given the job description, the candidate's resume, and a keyword match score already computed by a separate tool (matched keywords and missing keywords). Ground your assessment in this material — do not invent qualifications that are not in the resume text, and do not contradict the provided keyword analysis without a clear reason from the resume text itself.

Respond in exactly this structure, four short lines, no preamble, no markdown formatting:
Fit: <Strong, Moderate, or Weak> — <one short reason>
Strengths: <top 2-3 genuine relevant strengths, comma separated>
Gaps: <top 2-3 real relevant gaps, comma separated>
Recommendation: <one short, direct sentence for the recruiter>

Keep the entire reply under 80 words. Be specific and honest, not generically positive — this is used to make a real hiring decision.`;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    // Fail closed, not open: an unset ALLOWED_ORIGIN used to silently mean
    // "*". Require it to be set explicitly once deployed for real — see
    // worker/README.md step 5. Local/dev testing can still set it to "*".
    const configuredOrigin = env.ALLOWED_ORIGIN || "*";
    const cors = corsHeaders(configuredOrigin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }

    // CORS response headers alone don't block anything — a browser only
    // *honors* them on the reading side, and non-browser callers (curl,
    // scripts) ignore them entirely. Actually reject mismatched origins
    // server-side once a specific origin is configured, so a stolen/found
    // Worker URL can't be pointed at from another site to ride the quota.
    if (configuredOrigin !== "*") {
      const requestOrigin = request.headers.get("Origin");
      if (requestOrigin !== configuredOrigin) {
        return json({ error: "Origin not allowed" }, 403, cors);
      }
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: "Server not configured (missing API key)" }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const jdText = String(body.jdText || "").slice(0, MAX_FIELD_LENGTH);
    const resumeText = String(body.resumeText || "").slice(0, MAX_FIELD_LENGTH);
    const score = Number.isFinite(body.score) ? body.score : null;
    const matched = Array.isArray(body.matched) ? body.matched.slice(0, 25).map(String) : [];
    const missing = Array.isArray(body.missing) ? body.missing.slice(0, 25).map(String) : [];

    if (!jdText || !resumeText) {
      return json({ error: "jdText and resumeText are required" }, 400, cors);
    }

    const userContent = `JOB DESCRIPTION:
${jdText}

CANDIDATE RESUME:
${resumeText}

AUTOMATED KEYWORD ANALYSIS (already computed, treat as ground truth for coverage):
Match score: ${score}%
Matched keywords: ${matched.join(", ") || "none"}
Missing keywords: ${missing.join(", ") || "none"}`;

    const model = env.GEMINI_MODEL || "gemini-1.5-flash";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

    let geminiRes;
    try {
      geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userContent }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 220 },
        }),
      });
    } catch {
      return json({ error: "Could not reach AI service" }, 502, cors);
    }

    if (!geminiRes.ok) {
      const detail = await geminiRes.text().catch(() => "");
      return json({ error: "AI service error", detail: detail.slice(0, 300) }, 502, cors);
    }

    const data = await geminiRes.json();
    const verdict = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    if (!verdict) {
      return json({ error: "AI service returned no content" }, 502, cors);
    }

    return json({ verdict }, 200, cors);
  },
};
