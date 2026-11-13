// instagram: grava 1 linha por dia em ig_stats com seguidores, alcance e visitas ao perfil do @osbrasileuros.
// Segredos: META_TOKEN (token de longa duração com instagram_basic + instagram_manage_insights)
//           IG_USER_ID (id da conta profissional; o @osbrasileuros é 17841476704355857)
//           GRAPH_HOST opcional: "graph.facebook.com" (login pelo Facebook, padrão) ou "graph.instagram.com" (login pelo Instagram)
// Quem chama: o agendador (x-cron-secret) ou alguém da equipe logado no painel.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const HOST = Deno.env.get("GRAPH_HOST") || "graph.facebook.com";
const madrid = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(d);

async function graph(path: string, params: Record<string, string> = {}) {
  const u = new URL(`https://${HOST}/v21.0/${path}`);
  Object.entries({ ...params, access_token: Deno.env.get("META_TOKEN")! }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Meta ${r.status}: ${j.error?.message || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function collect() {
  const ig = Deno.env.get("IG_USER_ID")!;
  const me = await graph(ig, { fields: "followers_count,media_count,username" });
  const today = madrid(), yesterday = madrid(new Date(Date.now() - 864e5));
  const notes: string[] = [];
  let reach: number | null = null, visits: number | null = null;
  try {
    const r = await graph(`${ig}/insights`, { metric: "reach", period: "day" });
    const vals = r.data?.[0]?.values || [];
    reach = vals.length ? Number(vals[vals.length - 1].value) || 0 : null;
  } catch (e) { notes.push("reach: " + (e as Error).message); }
  try {
    const since = Math.floor(new Date(yesterday + "T00:00:00Z").getTime() / 1000), until = since + 86400;
    const r = await graph(`${ig}/insights`, { metric: "profile_views", period: "day", metric_type: "total_value", since: String(since), until: String(until) });
    visits = r.data?.[0]?.total_value?.value ?? null;
  } catch (e) { notes.push("profile_views: " + (e as Error).message); }
  // seguidores valem para hoje; alcance e visitas são do dia anterior completo
  await db.from("ig_stats").upsert({ id: today, date: today, followers: me.followers_count, notes: notes.join(" | ") || null }, { onConflict: "id" });
  if (reach != null || visits != null) {
    const { data: prev } = await db.from("ig_stats").select("*").eq("id", yesterday).maybeSingle();
    await db.from("ig_stats").upsert({ ...(prev || { id: yesterday, date: yesterday }), reach, profile_visits: visits }, { onConflict: "id" });
  }
  return { ok: true, username: me.username, followers: me.followers_count, reach, profile_visits: visits, notes };
}

async function authorized(req: Request) {
  const cron = req.headers.get("x-cron-secret");
  if (cron) { const { data } = await db.rpc("check_cron_token", { t: cron }); if (data === true) return true; }
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data: p } = await db.from("profiles").select("active").eq("id", user.id).maybeSingle();
  return !!p?.active;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!(await authorized(req))) return json({ error: "Not allowed" }, 401);
    if (!Deno.env.get("META_TOKEN") || !Deno.env.get("IG_USER_ID")) return json({ error: "Faltam os segredos META_TOKEN e IG_USER_ID" }, 400);
    return json(await collect());
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
