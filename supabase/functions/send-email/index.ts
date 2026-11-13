// send-email: envia uma campanha da aba E-mail marketing.
// Corpo: { campaign_id, test_to? }. Com test_to manda só para esse endereço (precisa ser de alguém da equipe).
// Sem test_to: manda para a lista com consentimento (no máximo 400 por chamada; o painel chama de novo até acabar).
// Corpo alternativo: { coupon_email: coupon_id } manda ao dono do cupom (owner_email, ou o e-mail do comediante) o cupom e o link do Eventbrite já com desconto.
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

// ---------- cupom do comediante ----------
const fdate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Madrid" });
function withDiscount(url: string, code: string) { try { const u = new URL(url); u.searchParams.set("discount", code); return u.toString(); } catch { return null; } }
async function sendCoupon(id: string, mailer: any, me: any) {
  const { data: c } = await db.from("coupons").select("*").eq("id", id).maybeSingle();
  if (!c) throw new Error("Cupom não encontrado");
  const { data: com } = c.comedian_id ? await db.from("comedians").select("*").eq("id", c.comedian_id).maybeSingle() : { data: null };
  const to = String(c.owner_email || com?.email || "").trim().toLowerCase();
  if (!to) throw new Error("O cupom não tem e-mail do dono");
  const tpl = "coupon:" + c.id + ":" + to;
  const { data: sent } = await db.from("email_log").select("id").eq("template", tpl).eq("status", "sent").limit(1);
  if (sent?.length) return { ok: true, to, already: true };
  const today = new Date().toISOString().slice(0, 10);
  let show: any = null;
  if (c.show_id) ({ data: show } = await db.from("shows").select("*").eq("id", c.show_id).maybeSingle());
  if (!show?.eb_url || show.date < today) {
    const { data: up } = await db.from("shows").select("*").gte("date", today).neq("status", "cancelled").not("eb_url", "is", null).order("date").limit(1);
    show = up?.[0] || show;
  }
  const link = show?.eb_url ? withDiscount(show.eb_url, c.code) : null;
  const name = first(c.owner_name || com?.name);
  const isComic = !!com;
  const when = show?.date ? fdate(show.date) + (show.time ? " às " + String(show.time).slice(0, 5) : "") : "";
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#3772B4;font-family:Inter,Arial,sans-serif;color:#0f1e3b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#3772B4"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td align="center" style="padding:0 0 20px"><img src="https://www.brasileuros.com/assets/logo.webp" alt="Brasileuros" height="44" style="height:44px"></td></tr>
<tr><td style="background:#ffffff;border-radius:18px;padding:28px 26px">
<p style="margin:0 0 14px;font-size:20px;font-weight:800">Oi, ${esc(name || "")}!</p>
<p style="margin:0 0 14px;font-size:15.5px;line-height:1.55">${isComic ? `Que bom ter você no palco do Brasileuros` : `Aqui está o seu cupom do Brasileuros`}${when ? ` para <b>${esc(when)}</b>` : ""}${show?.venue ? `, no ${esc(show.venue)}` : ""}. ${isComic ? "Criamos um cupom com o seu nome para você divulgar: quem" : "Quem"} usar ganha <b>${Number(c.percent) || 10}% de desconto</b> no ingresso.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr><td align="center" style="background:#0f1e3b;border-radius:14px;padding:16px">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#cfdcf0">Seu cupom</div>
<div style="font-size:30px;font-weight:800;letter-spacing:.04em;color:#FDD929;margin-top:4px">${esc(c.code)}</div></td></tr></table>
${link ? `<p style="margin:0 0 10px;font-size:15.5px;line-height:1.55">Se preferir, mande direto este link: ele já abre o Eventbrite com o desconto aplicado.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 14px"><tr><td style="background:#FDD929;border-radius:999px"><a href="${esc(link)}" style="display:inline-block;padding:13px 22px;font-weight:800;color:#0f1e3b;text-decoration:none;font-size:15px">Ingresso com ${Number(c.percent) || 10}% off</a></td></tr></table>
<p style="margin:0 0 14px;font-size:12.5px;color:#5b6b84;word-break:break-all">${esc(link)}</p>` : ""}
<p style="margin:0;font-size:15.5px;line-height:1.55">A pessoa pode digitar o nome do cupom no Eventbrite ou usar o link, os dois funcionam. ${isComic ? "Nos vemos no palco!" : "Nos vemos no show!"}</p>
<p style="margin:16px 0 0;font-size:15.5px;font-weight:700">Patrick e Pipo · Brasileuros</p>
</td></tr></table></td></tr></table></body></html>`;
  await mailer.sendMail({ from: FROM, to, subject: `Seu cupom do Brasileuros: ${c.code}`, html });
  await db.from("email_log").insert({ recipient: to, template: tpl, status: "sent", detail: { link } });
  await db.from("activity_log").insert({ user_id: me.id, action: "coupon_sent", detail: { coupon: c.code, to } });
  return { ok: true, to, link };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const me = await staff(req);
    if (!me) return json({ error: "Not allowed" }, 401);
    if (!Deno.env.get("SMTP_PASSWORD")) return json({ error: "Falta o segredo SMTP_PASSWORD (senha de app do Gmail)" }, 400);
    const { campaign_id, test_to, comedian_coupon, coupon_email } = await req.json().catch(() => ({}));
    const mailerC = () => nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: SMTP_USER, pass: Deno.env.get("SMTP_PASSWORD") } });
    if (coupon_email || comedian_coupon) return json(await sendCoupon(coupon_email || comedian_coupon, mailerC(), me));
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
