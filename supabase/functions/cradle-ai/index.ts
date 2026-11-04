// Cradle AI: the server side of the web app's `sample(prompt)` / `sample.json(prompt)` calls (reading messy typed
// notes, explaining the day's pattern). Holds the model key (secret GEMINI_API_KEY, shared with Gainsboard's coach in
// this project), only answers calls that carry a known family key, and caps each family per day.
// Deploy with verify_jwt = false: callers have no account, the family key is the check.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = Deno.env.get("CRADLE_MODEL") ?? Deno.env.get("COACH_MODEL") ?? "gemini-3.8-flash";
const DAILY_CAP = Number(Deno.env.get("CRADLE_DAILY_CAP") ?? "60");
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const SYSTEM = "You help tired parents keep a baby log in an app called Cradle. Follow the instructions in the message exactly. " +
  "Stay on baby care, feeding, sleep, diapers and the parents' log. You are not a doctor: for anything that sounds like a health worry, say to call the pediatrician.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  let body: { key?: string; prompt?: string; mode?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "Couldn't read that request." }); }
  const prompt = String(body.prompt ?? "").slice(0, 20000), json = body.mode === "json";
  if (!prompt) return reply(400, { error: "Nothing to read." });
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply(503, { error: "Reading notes isn't set up yet. Simple entries like \"fed 120 8:15\" still work." });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ok = await admin.rpc("cradle_ai_ok", { p_key: String(body.key ?? ""), p_cap: DAILY_CAP });
  if (ok.error) return reply(401, { error: "This family link isn't working. Open Cradle from your family link again." });
  if (ok.data !== true) return reply(429, { error: "That's a lot of notes today. Simple entries like \"fed 120 8:15\" still work; try again tomorrow." });

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM + (json ? " Reply with exactly one JSON value, no prose and no code fences." : "") }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: "low" }, ...(json ? { responseMimeType: "application/json" } : {}) },
    }),
  });
  if (!res.ok) { console.error("gemini", res.status, (await res.text()).slice(0, 300)); return reply(502, { error: "Couldn't read that right now. Try again in a minute." }); }
  const out = await res.json();
  const text = (out.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  if (!json) return reply(200, { text });
  try { return reply(200, { json: JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) }); }
  catch { return reply(502, { error: "Couldn't read that right now. Try again in a minute." }); }
});
