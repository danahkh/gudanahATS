// Worker script for the gudanahats service (serves gudanah.com). Handles
// exactly one dynamic route (the visit counter) and falls through to
// static assets for everything else — see GUIDELINES.md "Sanctioned
// exceptions" for why this is scoped this narrowly.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/visits") {
      return handleVisits(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleVisits(request, env) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Best-effort counter, not a strictly atomic one: KV get-then-put has a
  // race window under concurrent requests, so a handful of simultaneous
  // visits can undercount by a few. Accepted tradeoff for a vanity counter
  // — a Durable Object would fix it but is real added infrastructure for
  // a number nobody's making decisions from.
  const current = parseInt((await env.VISITS.get("count")) || "0", 10);
  const next = current + 1;
  await env.VISITS.put("count", String(next));

  return new Response(JSON.stringify({ count: next }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
