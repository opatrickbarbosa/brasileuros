// metrics: cruza Google Analytics 4, Search Console, Instagram e Meta Ads num resumo de 28 dias
// e grava em public.insights (1 linha por execução, id = data/hora). O painel lê a mais recente.
// Segredos: GOOGLE_SERVICE_ACCOUNT (JSON da conta de serviço com acesso de leitor ao GA4 e ao Search Console)
//           GA4_PROPERTY_ID (562750879) · GSC_SITE (https://www.brasileuros.com/)
//           META_TOKEN + IG_USER_ID (Instagram) · META_AD_ACCOUNT_ID opcional (act_… dos anúncios)
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
const env = (k: string) => Deno.env.get(k) || "";
const BOT_CITIES = ["Singapore", "Springfield", "Ashburn"]; // padrões de robô vistos no GA4 do site
const BOT_COUNTRIES = ["China"];
const day = (n = 0) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/* ---------- Google: token da conta de serviço ---------- */
const b64url = (b: ArrayBuffer | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
async function googleToken(): Promise<string> {
  const sa = JSON.parse(env("GOOGLE_SERVICE_ACCOUNT"));
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claim));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: head + "." + claim + "." + b64url(sig) }) });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google: " + (j.error_description || j.error || "sem token"));
  return j.access_token;
}

/* ---------- GA4 ---------- */
const notBots = { notExpression: { orGroup: { expressions: [
  { filter: { fieldName: "city", inListFilter: { values: BOT_CITIES } } },
  { filter: { fieldName: "country", inListFilter: { values: BOT_COUNTRIES } } },
] } } };
const andF = (...f: any[]) => ({ andGroup: { expressions: f } });
const eq = (fieldName: string, value: string) => ({ filter: { fieldName, stringFilter: { value, matchType: "EXACT" } } });
async function ga(token: string, body: any) {
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env("GA4_PROPERTY_ID")}:runReport`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ dateRanges: [{ startDate: "28daysAgo", endDate: "today" }], ...body }) });
  const j = await r.json();
  if (j.error) throw new Error("GA4: " + j.error.message);
  return (j.rows || []).map((row: any) => [...(row.dimensionValues || []).map((v: any) => v.value), ...(row.metricValues || []).map((v: any) => Number(v.value))]);
}
async function gaBlock(token: string) {
  const users = async (extra?: any) => { const r = await ga(token, { metrics: [{ name: "totalUsers" }, { name: "eventCount" }], dimensionFilter: extra ? andF(notBots, extra) : notBots }); return { users: r[0]?.[0] || 0, events: r[0]?.[1] || 0 }; };
  const site = await users(eq("hostName", "www.brasileuros.com"));
  const entradas = await users(andF(eq("hostName", "www.brasileuros.com"), eq("pagePath", "/entradas")));
  const buy = await users(eq("eventName", "comprar_entradas"));
  const eb = await users(eq("hostName", "www.eventbrite.com"));
  const checkout = await users(andF(eq("hostName", "www.eventbrite.com"), eq("pagePath", "/checkout-external")));
  const signups = await users(eq("eventName", "sign_up"));
  const leads = await users(eq("eventName", "generate_lead"));
  const wa = await users(eq("eventName", "whatsapp_click"));
  const daily = (await ga(token, { dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "totalUsers" }], dimensionFilter: notBots, orderBys: [{ dimension: { dimensionName: "date" } }] }))
    .map(([d, s, u]: any[]) => ({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, sessions: s, users: u }));
  const ch = await ga(token, { dimensions: [{ name: "sessionSourceMedium" }], metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "averageSessionDuration" }], dimensionFilter: notBots, limit: 12, orderBys: [{ metric: { metricName: "sessions" }, desc: true }] });
  const chBuy = await ga(token, { dimensions: [{ name: "sessionSourceMedium" }], metrics: [{ name: "eventCount" }, { name: "totalUsers" }], dimensionFilter: andF(notBots, eq("eventName", "comprar_entradas")) });
  const channels = ch.map(([src, s, u, dur]: any[]) => { const b = chBuy.find((x: any[]) => x[0] === src); return { src, sessions: s, users: u, dur: Math.round(dur), buy_clicks: b?.[1] || 0, buy_users: b?.[2] || 0 }; });
  const landing = (await ga(token, { dimensions: [{ name: "landingPage" }], metrics: [{ name: "sessions" }, { name: "engagedSessions" }], dimensionFilter: andF(notBots, eq("hostName", "www.brasileuros.com")), limit: 8, orderBys: [{ metric: { metricName: "sessions" }, desc: true }] }))
    .map(([path, s, e]: any[]) => ({ path, sessions: s, engaged: e }));
  const devices = (await ga(token, { dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "totalUsers" }], dimensionFilter: notBots })).map(([d, u]: any[]) => ({ device: d, users: u }));
  const hours = (await ga(token, { dimensions: [{ name: "hour" }], metrics: [{ name: "sessions" }], dimensionFilter: notBots })).map(([h, s]: any[]) => ({ hour: Number(h), sessions: s }));
  return { site_users: site.users, entradas_users: entradas.users, buy_users: buy.users, buy_clicks: buy.events, eb_users: eb.users, checkout_users: checkout.users, signups: signups.users, leads: leads.users, wa_users: wa.users, daily, channels, landing, devices, hours };
}

/* ---------- Search Console ---------- */
async function gscBlock(token: string) {
  const call = async (body: any) => {
    const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(env("GSC_SITE"))}/searchAnalytics/query`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ startDate: day(-28), endDate: day(), ...body }) });
    const j = await r.json(); if (j.error) throw new Error("Search Console: " + j.error.message); return j.rows || [];
  };
  const tot = (await call({}))[0] || {};
  const queries = (await call({ dimensions: ["query"], rowLimit: 10 })).map((r: any) => ({ q: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 }));
  return { clicks: tot.clicks || 0, impressions: tot.impressions || 0, ctr: tot.ctr || 0, position: tot.position ? Math.round(tot.position * 10) / 10 : null, queries };
}

/* ---------- Instagram + Meta Ads ---------- */
async function graph(path: string, params: Record<string, string> = {}) {
  const u = new URL(`https://${env("GRAPH_HOST") || "graph.facebook.com"}/v21.0/${path}`);
  Object.entries({ ...params, access_token: env("META_TOKEN") }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u); const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Meta: ${j.error?.message || r.status}`);
  return j;
}
async function igBlock() {
  const ig = env("IG_USER_ID");
  const since = String(Math.floor(Date.now() / 1000) - 28 * 86400), until = String(Math.floor(Date.now() / 1000));
  const tv = async (metric: string) => { try { const r = await graph(`${ig}/insights`, { metric, period: "day", metric_type: "total_value", since, until }); return r.data?.[0]?.total_value?.value ?? null; } catch { return null; } };
  const [reach, profile_visits, link_taps, views] = [await tv("reach"), await tv("profile_views"), await tv("profile_links_taps"), await tv("views")];
  const media = await graph(`${ig}/media`, { fields: "id,caption,permalink,timestamp,media_type,media_product_type", limit: "25" });
  const posts: any[] = [];
  for (const m of media.data || []) {
    if (new Date(m.timestamp).getTime() < Date.now() - 45 * 864e5) continue;
    let ins: any = {};
    for (const metrics of ["reach,shares,saved,profile_visits,follows,total_interactions", "reach,shares,saved,total_interactions"]) {
      try { const r = await graph(`${m.id}/insights`, { metric: metrics }); (r.data || []).forEach((x: any) => ins[x.name] = x.values?.[0]?.value ?? x.total_value?.value ?? 0); break; } catch { /* reels não aceitam algumas métricas */ }
    }
    posts.push({ permalink: m.permalink, caption: String(m.caption || "").slice(0, 140), ts: m.timestamp, type: m.media_product_type || m.media_type, ...ins });
  }
  return { reach_28d: reach, profile_visits_28d: profile_visits, link_taps_28d: link_taps, views_28d: views, posts };
}
async function adsBlock() {
  const acc = env("META_AD_ACCOUNT_ID"); if (!acc) return null;
  const r = await graph(`${acc.startsWith("act_") ? acc : "act_" + acc}/insights`, { fields: "spend,impressions,reach,clicks,inline_link_clicks,actions", date_preset: "last_28d", time_increment: "1", limit: "60" });
  const daily = (r.data || []).map((x: any) => ({ date: x.date_start, spend: Number(x.spend || 0), clicks: Number(x.inline_link_clicks || 0), impressions: Number(x.impressions || 0) }));
  const s = (k: string) => daily.reduce((a: number, x: any) => a + x[k], 0);
  return { spend: Math.round(s("spend") * 100) / 100, link_clicks: s("clicks"), impressions: s("impressions"), daily };
}

async function collect() {
  const data: any = { period: "28d", errors: [] as string[] };
  const safe = async (k: string, fn: () => Promise<any>) => { try { data[k] = await fn(); } catch (e) { data.errors.push(String((e as Error).message || e)); } };
  if (env("GOOGLE_SERVICE_ACCOUNT")) {
    let token = ""; try { token = await googleToken(); } catch (e) { data.errors.push(String((e as Error).message)); }
    if (token && env("GA4_PROPERTY_ID")) await safe("ga", () => gaBlock(token));
    if (token && env("GSC_SITE")) await safe("gsc", () => gscBlock(token));
  } else data.errors.push("Google ainda não conectado (falta GOOGLE_SERVICE_ACCOUNT)");
  if (env("META_TOKEN") && env("IG_USER_ID")) await safe("ig", igBlock); else data.errors.push("Instagram ainda não conectado (falta META_TOKEN)");
  if (env("META_AD_ACCOUNT_ID") && env("META_TOKEN")) await safe("ads", adsBlock);
  const at = new Date().toISOString();
  await db.from("insights").upsert({ id: at.slice(0, 13), at, data });
  await db.from("insights").delete().lt("at", new Date(Date.now() - 14 * 864e5).toISOString());
  return { ok: true, at, errors: data.errors, has: Object.keys(data).filter((k) => !["period", "errors"].includes(k)) };
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
    return json(await collect());
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
