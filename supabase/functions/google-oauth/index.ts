// google-oauth: liga o painel ao GA4 e ao Search Console com o login Google de alguém da equipe
// e à planilha de contatos (alternativa à chave de conta de serviço, que a organização bloqueia).
// POST { action: "start" }  (equipe logada) → { url } para abrir a tela de permissão do Google
// GET  ?code=…&state=…      (volta do Google) → troca o código, guarda o refresh token e volta ao painel
// Segredos: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (cliente OAuth "Aplicativo da Web" do projeto brasileuros-painel)
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
// aceita o ID/segredo puros ou o JSON baixado do Google ({"web":{"client_id":…,"client_secret":…}})
const gcred = (() => { for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) { const v = (Deno.env.get(k) || "").trim(); if (v.startsWith("{")) { try { const j = JSON.parse(v); const w = j.web || j.installed || j; if (w.client_id) return { id: w.client_id, secret: w.client_secret }; } catch (_) { /* não é JSON */ } } } return { id: (Deno.env.get("GOOGLE_CLIENT_ID") || "").trim(), secret: (Deno.env.get("GOOGLE_CLIENT_SECRET") || "").trim() }; })();
const REDIRECT = `${env("SUPABASE_URL")}/functions/v1/google-oauth`;
const PANEL = "https://www.brasileuros.com/admin";
const SCOPES = "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/spreadsheets.readonly openid email";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sign(msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(gcred.secret + env("SUPABASE_SERVICE_ROLE_KEY")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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
const back = (q: string) => new Response(null, { status: 302, headers: { Location: `${PANEL}?google=${q}` } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!gcred.id || !gcred.secret) return json({ error: "Faltam os segredos GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET" }, 400);

    if (req.method === "POST") {
      const uid = await staffId(req);
      if (!uid) return json({ error: "Not allowed" }, 401);
      const payload = `${uid}.${Date.now()}`;
      const state = `${payload}.${await sign(payload)}`;
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      Object.entries({ client_id: gcred.id, redirect_uri: REDIRECT, response_type: "code", scope: SCOPES, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state })
        .forEach(([k, v]) => u.searchParams.set(k, v));
      return json({ url: u.toString() });
    }

    // GET: volta do Google
    const q = new URL(req.url).searchParams;
    if (q.get("error")) return back("cancelado");
    const [uid, t, sig] = (q.get("state") || "").split(".");
    if (!uid || !t || !sig || sig !== (await sign(`${uid}.${t}`)) || Date.now() - Number(t) > 15 * 6e4) return back("expirado");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: q.get("code") || "", client_id: gcred.id, client_secret: gcred.secret, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
    });
    const j = await r.json();
    if (!j.refresh_token) return back("erro");
    let email = "";
    try { email = JSON.parse(atob(j.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email || ""; } catch (_) { /* sem e-mail */ }
    await db.from("integrations").upsert({ key: "google_refresh_token", value: j.refresh_token, meta: { email, by: uid }, at: new Date().toISOString() });
    await db.from("activity_log").insert({ user_id: uid, action: "google_connected", detail: { email } }).then(() => {}, () => {});
    return back("ok");
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
