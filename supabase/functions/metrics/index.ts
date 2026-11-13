// metrics: cruza Google Analytics 4, Search Console, Instagram e Meta Ads.
// Sem corpo: resumo dos últimos 28 dias gravado em public.insights (o painel lê o mais recente).
// Com { start, end } (AAAA-MM-DD): devolve o resumo daquele período sem gravar (seletor de período do painel).
// Segredos: GOOGLE_SERVICE_ACCOUNT (JSON da conta de serviço) OU GOOGLE_CLIENT_ID/SECRET + login feito pelo botão "Conectar Google" (função google-oauth)
//           GA4_PROPERTY_ID (562750879) · GSC_SITE (https://www.brasileuros.com/)
//           META_TOKEN + IG_USER_ID (Instagram) · META_AD_ACCOUNT_ID opcional (act_… dos anúncios)
//           FB_PAGE_ID opcional · TIKTOK_CLIENT_KEY/SECRET + login pelo botão "Conectar TikTok" · CONTACTS_SHEET_ID opcional
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
// aceita o ID/segredo puros ou o JSON baixado do Google ({"web":{"client_id":…,"client_secret":…}})
const gcred = (() => { for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) { const v = (Deno.env.get(k) || "").trim(); if (v.startsWith("{")) { try { const j = JSON.parse(v); const w = j.web || j.installed || j; if (w.client_id) return { id: w.client_id, secret: w.client_secret }; } catch (_) { /* não é JSON */ } } } return { id: (Deno.env.get("GOOGLE_CLIENT_ID") || "").trim(), secret: (Deno.env.get("GOOGLE_CLIENT_SECRET") || "").trim() }; })();
const BOT_CITIES = ["Singapore", "Springfield", "Ashburn"]; // padrões de robô vistos no GA4 do site
const BOT_COUNTRIES = ["China"];
const day = (n = 0) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let RANGE = { start: day(-28), end: day() }; // período pedido (padrão: últimos 28 dias)
const ts = (d: string, end = false) => Math.floor(new Date(d + (end ? "T23:59:59Z" : "T00:00:00Z")).getTime() / 1000);

/* ---------- Google: token da conta de serviço ---------- */
const b64url = (b: ArrayBuffer | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
async function googleToken(): Promise<string> {
  if (!env("GOOGLE_SERVICE_ACCOUNT")) {
    // login Google da equipe (botão "Conectar Google" no painel → função google-oauth)
    const { data: row } = await db.from("integrations").select("value").eq("key", "google_refresh_token").maybeSingle();
    if (!row?.value) throw new Error("Google ainda não conectado");
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.value, client_id: gcred.id, client_secret: gcred.secret }) });
    const j = await r.json();
    if (!j.access_token) throw new Error("Google: " + (j.error_description || j.error || "sem token") + " — conecte de novo");
    return j.access_token;
  }
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
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env("GA4_PROPERTY_ID")}:runReport`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ dateRanges: [{ startDate: RANGE.start, endDate: RANGE.end }], ...body }) });
  const j = await r.json();
  if (j.error) throw new Error("GA4: " + j.error.message);
  return (j.rows || []).map((row: any) => [...(row.dimensionValues || []).map((v: any) => v.value), ...(row.metricValues || []).map((v: any) => Number(v.value))]);
}
async function gaBlock(token: string) {
  const users = async (extra?: any) => { const r = await ga(token, { metrics: [{ name: "totalUsers" }, { name: "eventCount" }], dimensionFilter: extra ? andF(notBots, extra) : notBots }); return { users: r[0]?.[0] || 0, events: r[0]?.[1] || 0 }; };
  // tudo em paralelo para o painel responder rápido
  const [site, entradas, buy, eb, checkout, signups, leads, wa, dailyR, ch, chBuy, landingR, devicesR, hoursR] = await Promise.all([
    users(eq("hostName", "www.brasileuros.com")),
    users(andF(eq("hostName", "www.brasileuros.com"), eq("pagePath", "/entradas"))),
    users(eq("eventName", "comprar_entradas")),
    users(eq("hostName", "www.eventbrite.com")),
    users(andF(eq("hostName", "www.eventbrite.com"), eq("pagePath", "/checkout-external"))),
    users(eq("eventName", "sign_up")),
    users(eq("eventName", "generate_lead")),
    users(eq("eventName", "whatsapp_click")),
    ga(token, { dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "totalUsers" }], dimensionFilter: notBots, orderBys: [{ dimension: { dimensionName: "date" } }] }),
    ga(token, { dimensions: [{ name: "sessionSourceMedium" }], metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "averageSessionDuration" }], dimensionFilter: notBots, limit: 12, orderBys: [{ metric: { metricName: "sessions" }, desc: true }] }),
    ga(token, { dimensions: [{ name: "sessionSourceMedium" }], metrics: [{ name: "eventCount" }, { name: "totalUsers" }], dimensionFilter: andF(notBots, eq("eventName", "comprar_entradas")) }),
    ga(token, { dimensions: [{ name: "landingPage" }], metrics: [{ name: "sessions" }, { name: "engagedSessions" }], dimensionFilter: andF(notBots, eq("hostName", "www.brasileuros.com")), limit: 8, orderBys: [{ metric: { metricName: "sessions" }, desc: true }] }),
    ga(token, { dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "totalUsers" }], dimensionFilter: notBots }),
    ga(token, { dimensions: [{ name: "hour" }], metrics: [{ name: "sessions" }], dimensionFilter: notBots }),
  ]);
  const daily = dailyR.map(([d, s, u]: any[]) => ({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, sessions: s, users: u }));
  const channels = ch.map(([src, s, u, dur]: any[]) => { const b = chBuy.find((x: any[]) => x[0] === src); return { src, sessions: s, users: u, dur: Math.round(dur), buy_clicks: b?.[1] || 0, buy_users: b?.[2] || 0 }; });
  const landing = landingR.map(([path, s, e]: any[]) => ({ path, sessions: s, engaged: e }));
  const devices = devicesR.map(([d, u]: any[]) => ({ device: d, users: u }));
  const hours = hoursR.map(([h, s]: any[]) => ({ hour: Number(h), sessions: s }));
  return { site_users: site.users, entradas_users: entradas.users, buy_users: buy.users, buy_clicks: buy.events, eb_users: eb.users, checkout_users: checkout.users, signups: signups.users, leads: leads.users, wa_users: wa.users, daily, channels, landing, devices, hours };
}

/* ---------- Search Console ---------- */
async function gscBlock(token: string) {
  const call = async (body: any) => {
    const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(env("GSC_SITE"))}/searchAnalytics/query`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ startDate: RANGE.start, endDate: RANGE.end, ...body }) });
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
  // a Meta aceita no máximo 30 dias por consulta: soma em blocos
  const tv = async (metric: string) => {
    let total: number | null = null;
    for (let a = ts(RANGE.start); a <= ts(RANGE.end, true); a += 30 * 86400) {
      const b = Math.min(a + 30 * 86400, ts(RANGE.end, true));
      try { const r = await graph(`${ig}/insights`, { metric, period: "day", metric_type: "total_value", since: String(a), until: String(b) }); const v = r.data?.[0]?.total_value?.value; if (v != null) total = (total || 0) + Number(v); } catch { /* métrica indisponível */ }
    }
    return total;
  };
  const [reach, profile_visits, link_taps, views] = await Promise.all([tv("reach"), tv("profile_views"), tv("profile_links_taps"), tv("views")]);
  const media = await graph(`${ig}/media`, { fields: "id,caption,permalink,timestamp,media_type,media_product_type,media_url,thumbnail_url", limit: "50" });
  const inRange = (media.data || []).filter((m: any) => { const d = String(m.timestamp).slice(0, 10); return d >= RANGE.start && d <= RANGE.end; });
  const posts = await Promise.all(inRange.map(async (m: any) => {
    let ins: any = {};
    for (const metrics of ["reach,shares,saved,profile_visits,follows,total_interactions", "reach,shares,saved,total_interactions"]) {
      try { const r = await graph(`${m.id}/insights`, { metric: metrics }); (r.data || []).forEach((x: any) => ins[x.name] = x.values?.[0]?.value ?? x.total_value?.value ?? 0); break; } catch { /* reels não aceitam algumas métricas */ }
    }
    return { permalink: m.permalink, caption: String(m.caption || "").slice(0, 140), ts: m.timestamp, type: m.media_product_type || m.media_type, thumb: m.thumbnail_url || (m.media_type === "VIDEO" ? null : m.media_url) || null, ...ins };
  }));
  return { reach_28d: reach, profile_visits_28d: profile_visits, link_taps_28d: link_taps, views_28d: views, posts };
}
/* ---------- Página do Facebook (Graph API, mesmo META_TOKEN) ---------- */
async function fbBlock() {
  const page = env("FB_PAGE_ID") || "761885047013471";
  const p = await graph(page, { fields: "name,followers_count,fan_count,access_token,link" });
  const out: any = { name: p.name, followers: p.followers_count ?? p.fan_count ?? null, link: p.link || null };
  if (!p.access_token) return out;
  // métricas da página pedem o token da própria página
  const pg = async (metric: string) => {
    let total: number | null = null;
    for (let a = ts(RANGE.start); a <= ts(RANGE.end, true); a += 90 * 86400) {
      const b = Math.min(a + 90 * 86400, ts(RANGE.end, true));
      const u = new URL(`https://graph.facebook.com/v21.0/${page}/insights`);
      Object.entries({ metric, period: "day", since: String(a), until: String(b), access_token: p.access_token }).forEach(([k, v]) => u.searchParams.set(k, v));
      const j = await (await fetch(u)).json().catch(() => ({}));
      const vals = j.data?.[0]?.values; if (vals) total = (total || 0) + vals.reduce((x: number, v: any) => x + Number(v.value || 0), 0);
    }
    return total;
  };
  [out.reach, out.engagement, out.views] = await Promise.all([pg("page_impressions_unique"), pg("page_post_engagements"), pg("page_views_total")]);
  return out;
}

/* ---------- TikTok (API oficial; login pelo botão "Conectar TikTok" → função tiktok-oauth) ---------- */
async function tiktokToken() {
  const { data: row } = await db.from("integrations").select("value,meta").eq("key", "tiktok_refresh_token").maybeSingle();
  if (!row?.value) throw new Error("TikTok ainda não conectado");
  const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_key: env("TIKTOK_CLIENT_KEY"), client_secret: env("TIKTOK_CLIENT_SECRET"), grant_type: "refresh_token", refresh_token: row.value }) });
  const j = await r.json();
  if (!j.access_token) throw new Error("TikTok: " + (j.error_description || j.error || "sem token") + " — conecte de novo");
  if (j.refresh_token && j.refresh_token !== row.value) await db.from("integrations").upsert({ key: "tiktok_refresh_token", value: j.refresh_token, meta: row.meta, at: new Date().toISOString() });
  return j.access_token as string;
}
async function tiktokBlock() {
  const tok = await tiktokToken();
  const h = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const u = await (await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name,username,follower_count,likes_count,video_count,profile_deep_link", { headers: h })).json();
  if (u.error?.code && u.error.code !== "ok") throw new Error("TikTok: " + u.error.message);
  const user = u.data?.user || {};
  const videos: any[] = []; let cursor: number | undefined; let more = true;
  for (let i = 0; i < 5 && more; i++) {
    const v = await (await fetch("https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count", { method: "POST", headers: h, body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }) })).json();
    (v.data?.videos || []).forEach((x: any) => videos.push(x));
    more = !!v.data?.has_more; cursor = v.data?.cursor;
    if (videos.length && new Date(videos.at(-1).create_time * 1000).toISOString().slice(0, 10) < RANGE.start) break;
  }
  const inR = videos.filter((x) => { const d = new Date(x.create_time * 1000).toISOString().slice(0, 10); return d >= RANGE.start && d <= RANGE.end; });
  const s = (k: string) => inR.reduce((a, x) => a + Number(x[k] || 0), 0);
  return { username: user.username, followers: user.follower_count ?? null, likes: user.likes_count ?? null, videos_total: user.video_count ?? null, link: user.profile_deep_link || (user.username ? `https://www.tiktok.com/@${user.username}` : null),
    videos: inR.length, views: s("view_count"), video_likes: s("like_count"), shares: s("share_count"), comments: s("comment_count"),
    top: inR.sort((a, b) => Number(b.view_count || 0) - Number(a.view_count || 0)).slice(0, 5).map((x) => ({ title: String(x.title || x.video_description || "").slice(0, 120), url: x.share_url, views: x.view_count, likes: x.like_count, shares: x.share_count, ts: new Date(x.create_time * 1000).toISOString() })) };
}

/* ---------- Lista de e-mails (Google Sheets "Brasileuros – Lista de contatos") ---------- */
const isTest = (r: Record<string, string>) => /teste|test\b/i.test(r.nome || "") || /@brasileuros\.com$/i.test(r.email || "");
async function emailsBlock(token: string, save: boolean) {
  const id = env("CONTACTS_SHEET_ID") || "134j84PBNIKr6BkuKx-FcgtcGjPmGxo_WuMob9YygTys";
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1:Z5000`, { headers: { Authorization: "Bearer " + token } });
  const j = await r.json(); if (j.error) throw new Error("Planilha de contatos: " + j.error.message);
  const [head, ...rows] = j.values || [];
  const H = (head || []).map((x: string) => String(x).trim().toLowerCase());
  const list = rows.map((row: string[]) => Object.fromEntries(H.map((k: string, i: number) => [k, String(row[i] ?? "").trim()]))).filter((x: any) => x.email && !isTest(x));
  const seen = new Set<string>(); const uniq = list.filter((x: any) => { const e = x.email.toLowerCase(); if (seen.has(e)) return false; seen.add(e); return true; });
  const confirmed = (x: any) => /confirmad/i.test(x.status || "") || /^sim \(confirm/i.test(x.consentimento_marketing || "");
  const conf = uniq.filter(confirmed);
  const inR = (x: any) => x.data_cadastro >= RANGE.start && x.data_cadastro <= RANGE.end;
  const byLang: Record<string, number> = {}; conf.forEach((x: any) => { const l = x.idioma || "pt"; byLang[l] = (byLang[l] || 0) + 1; });
  // quem confirmou por e-mail entra na lista do painel (aba E-mail)
  if (save && conf.length) {
    const { data: have } = await db.from("signups").select("email");
    const known = new Set((have || []).map((x: any) => String(x.email).toLowerCase()));
    const fresh = conf.filter((x: any) => !known.has(x.email.toLowerCase())).map((x: any) => ({ name: x.nome || null, email: x.email, lang: x.idioma || "pt", source: x.origem || "site", consent: true }));
    if (fresh.length) await db.from("signups").insert(fresh);
  }
  return { total: uniq.length, confirmed: conf.length, pending: uniq.filter((x: any) => !confirmed(x) && x.origem === "site").length, buyers: uniq.filter((x: any) => x.origem === "eventbrite").length,
    new_in_period: uniq.filter(inR).length, confirmed_in_period: conf.filter(inR).length, by_lang: byLang,
    sheet_url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
}

async function adsBlock() {
  const acc = env("META_AD_ACCOUNT_ID"); if (!acc) return null;
  const r = await graph(`${acc.startsWith("act_") ? acc : "act_" + acc}/insights`, { fields: "spend,impressions,reach,clicks,inline_link_clicks,actions", time_range: JSON.stringify({ since: RANGE.start, until: RANGE.end }), time_increment: "1", limit: "400" });
  const daily = (r.data || []).map((x: any) => ({ date: x.date_start, spend: Number(x.spend || 0), clicks: Number(x.inline_link_clicks || 0), impressions: Number(x.impressions || 0) }));
  const s = (k: string) => daily.reduce((a: number, x: any) => a + x[k], 0);
  return { spend: Math.round(s("spend") * 100) / 100, link_clicks: s("clicks"), impressions: s("impressions"), daily };
}

async function collect(save = true) {
  const data: any = { period: "28d", start: RANGE.start, end: RANGE.end, errors: [] as string[] };
  const safe = async (k: string, fn: () => Promise<any>) => { try { data[k] = await fn(); } catch (e) { data.errors.push(String((e as Error).message || e)); } };
  const google = (async () => {
    let token = ""; try { token = await googleToken(); } catch (e) { data.errors.push(String((e as Error).message)); }
    if (!token) return;
    await Promise.all([
      env("GA4_PROPERTY_ID") ? safe("ga", () => gaBlock(token)) : null,
      env("GSC_SITE") ? safe("gsc", () => gscBlock(token)) : null,
      safe("emails", () => emailsBlock(token, save)),
    ]);
  })();
  const jobs = [google];
  if (env("META_TOKEN") && env("IG_USER_ID")) jobs.push(safe("ig", igBlock)); else data.errors.push("Instagram ainda não conectado (falta META_TOKEN)");
  if (env("META_TOKEN")) jobs.push(safe("fb", fbBlock));
  if (env("TIKTOK_CLIENT_KEY")) jobs.push(safe("tiktok", tiktokBlock)); else data.errors.push("TikTok ainda não conectado");
  if (env("META_AD_ACCOUNT_ID") && env("META_TOKEN")) jobs.push(safe("ads", adsBlock));
  await Promise.all(jobs);
  const at = new Date().toISOString();
  if (!save) return { ok: true, at, data };
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
    const body = await req.json().catch(() => ({}));
    const okDate = (x: unknown) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
    if (okDate(body.start) && okDate(body.end) && body.start <= body.end) { RANGE = { start: body.start, end: body.end }; return json(await collect(false)); }
    RANGE = { start: day(-28), end: day() };
    return json(await collect());
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
