// tiktok-oauth: liga o painel à conta do Brasileuros no TikTok (API oficial: Login Kit + Display API).
// POST { action: "start" }  (equipe logada) → { url } para abrir a tela de permissão do TikTok
// GET  ?code=…&state=…      (volta do TikTok) → troca o código, guarda o refresh token e volta ao painel
// Segredos: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET (app "Painel Brasileuros" no TikTok for Developers)
// O refresh token fica em public.integrations (RLS sem políticas: só o service role lê).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const env = (k: string) => Deno.env.get(k) || "";
const REDIRECT = `${env("SUPABASE_URL")}/functions/v1/tiktok-oauth`;
const PANEL = "https://www.brasileuros.com/admin";
const SCOPES = "user.info.basic,user.info.profile,user.info.stats,video.list";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sign(msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("TIKTOK_CLIENT_SECRET") + env("SUPABASE_SERVICE_ROLE_KEY")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}
async function staffId(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return null;
  const { data: p } = await db.from("profiles").select("active").eq("id", user.id).maybeSingle();
  return p?.active ? user.id : null;
}
const back = (q: string) => new Response(null, { status: 302, headers: { Location: `${PANEL}?tiktok=${q}` } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!env("TIKTOK_CLIENT_KEY") || !env("TIKTOK_CLIENT_SECRET")) return json({ error: "Faltam os segredos TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET" }, 400);

    if (req.method === "POST") {
      const uid = await staffId(req);
      if (!uid) return json({ error: "Not allowed" }, 401);
      const payload = `${uid}.${Date.now()}`;
      const state = `${payload}.${await sign(payload)}`;
      const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
      Object.entries({ client_key: env("TIKTOK_CLIENT_KEY"), redirect_uri: REDIRECT, response_type: "code", scope: SCOPES, state })
        .forEach(([k, v]) => u.searchParams.set(k, v));
      return json({ url: u.toString() });
    }

    // GET: volta do TikTok
    const q = new URL(req.url).searchParams;
    if (q.get("error")) return back("cancelado");
    const [uid, t, sig] = (q.get("state") || "").split(".");
    if (!uid || !t || !sig || sig !== (await sign(`${uid}.${t}`)) || Date.now() - Number(t) > 15 * 6e4) return back("expirado");
    const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: q.get("code") || "", client_key: env("TIKTOK_CLIENT_KEY"), client_secret: env("TIKTOK_CLIENT_SECRET"), redirect_uri: REDIRECT, grant_type: "authorization_code" }),
    });
    const j = await r.json();
    if (!j.refresh_token) return back("erro");
    await db.from("integrations").upsert({ key: "tiktok_refresh_token", value: j.refresh_token, meta: { open_id: j.open_id, scope: j.scope, by: uid }, at: new Date().toISOString() });
    await db.from("activity_log").insert({ user_id: uid, action: "tiktok_connected", detail: { open_id: j.open_id } }).then(() => {}, () => {});
    return back("ok");
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
