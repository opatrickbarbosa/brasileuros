// send-email: envia uma campanha da aba E-mail marketing.
// Corpo: { campaign_id, test_to? }. Com test_to manda só para esse endereço (precisa ser de alguém da equipe).
// Sem test_to: manda para a lista com consentimento (no máximo 400 por chamada; o painel chama de novo até acabar).
// Segredos: SMTP_PASSWORD (senha de app do Gmail de contato@patrickbarbosa.com.br).
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.14";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SMTP_USER = "contato@patrickbarbosa.com.br";
const FROM = '"Brasileuros" <contato@patrickbarbosa.com.br>';
const UNSUB = Deno.env.get("SUPABASE_URL") + "/functions/v1/unsubscribe?id=";
const BATCH = 400;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const first = (n?: string | null) => String(n || "").trim().split(/\s+/)[0] || "";

async function staff(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return null;
  const { data: p } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return p?.active ? p : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const me = await staff(req);
    if (!me) return json({ error: "Not allowed" }, 401);
    if (!Deno.env.get("SMTP_PASSWORD")) return json({ error: "Falta o segredo SMTP_PASSWORD (senha de app do Gmail)" }, 400);
    const { campaign_id, test_to } = await req.json().catch(() => ({}));
    const { data: c } = await db.from("campaigns").select("*").eq("id", campaign_id).maybeSingle();
    if (!c || !c.html) return json({ error: "Campanha não encontrada" }, 404);
    const mailer = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: SMTP_USER, pass: Deno.env.get("SMTP_PASSWORD") } });
    const fill = (html: string, name: string, id: string) => html.replace(/\{\{NOME\}\}/g, esc(name || "")).replace(/Oi, !/g, "Oi!").replace(/\{\{DESCADASTRO\}\}/g, UNSUB + encodeURIComponent(id));
    const subject = (name: string) => String(c.subject).replace(/\{\{NOME\}\}/g, name);

    if (test_to) {
      const { data: team } = await db.from("profiles").select("email").eq("active", true);
      if (!(team || []).some((p: any) => String(p.email).toLowerCase() === String(test_to).toLowerCase())) return json({ error: "O teste só pode ir para alguém da equipe" }, 400);
      await mailer.sendMail({ from: FROM, to: test_to, subject: "[TESTE] " + subject(first(me.name)), html: fill(c.html, first(me.name), "teste") });
      await db.from("email_log").insert({ recipient: test_to, template: "campaign-test:" + c.id, status: "sent" });
      return json({ ok: true, to: test_to });
    }

    if (c.status === "sent") return json({ error: "Essa campanha já foi enviada" }, 400);
    let q = db.from("signups").select("id, email, name, lang").eq("consent", true).eq("unsubscribed", false);
    if (c.audience && c.audience !== "all") q = q.eq("lang", c.audience);
    const { data: people } = await q;
    const { data: done } = await db.from("email_log").select("recipient").eq("template", "campaign:" + c.id).eq("status", "sent");
    const already = new Set((done || []).map((x: any) => String(x.recipient).toLowerCase()));
    const todo = (people || []).filter((p: any) => !already.has(String(p.email).toLowerCase()));
    await db.from("campaigns").update({ status: "sending" }).eq("id", c.id);
    let ok = 0;
    for (const p of todo.slice(0, BATCH)) {
      try {
        await mailer.sendMail({ from: FROM, to: p.email, subject: subject(first(p.name)), html: fill(c.html, first(p.name), p.id), headers: { "List-Unsubscribe": `<${UNSUB}${p.id}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
        await db.from("email_log").insert({ recipient: p.email, template: "campaign:" + c.id, status: "sent" });
        ok++;
      } catch (e) {
        await db.from("email_log").insert({ recipient: p.email, template: "campaign:" + c.id, status: "error", detail: { error: String(e) } });
      }
    }
    const remaining = Math.max(0, todo.length - BATCH);
    const total = already.size + ok;
    await db.from("campaigns").update({ status: remaining ? "sending" : "sent", sent_count: total, sent_at: new Date().toISOString() }).eq("id", c.id);
    await db.from("activity_log").insert({ user_id: me.id, action: "campaign_sent", detail: { id: c.id, sent: ok, total } });
    return json({ ok: true, sent: ok, sent_total: total, remaining });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
