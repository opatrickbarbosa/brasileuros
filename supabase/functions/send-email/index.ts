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

/* ---- visual padrão dos e-mails do Brasileuros (mesmo do e-mail de boas-vindas CHORINHO10) ---- */
const BX_SITE = "https://www.brasileuros.com";
const bxEsc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]);
const bxT = (html: string, style?: string) => `<div class="gs"><div class="gd" style="color:#ffffff;${style || ""}">${html}</div></div>`;
const bxBtn = (text: string, href: string) => `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:22px auto 0"><tr><td align="center" bgcolor="#ffd400" style="background:#ffd400;background-image:linear-gradient(#ffd400,#ffd400);border-radius:999px"><a href="${bxEsc(href)}" style="display:inline-block;padding:16px 34px;font:bold 17px Arial,Helvetica,sans-serif;color:#0b1f4d;text-decoration:none;border-radius:999px">${bxEsc(text)}</a></td></tr></table>`;
const bxCard = (html: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#1e74b8" style="background:#1e74b8;background-image:linear-gradient(#1e74b8,#1e74b8);border-radius:14px"><tr><td style="padding:18px 20px">${bxT(html, "font-size:15px;line-height:1.7")}</td></tr></table>`;
function bxShell(o: { title?: string; preheader?: string; inner: string; foot?: string }) {
  const bg = (c: string) => `bgcolor="${c}" style="background:${c};background-image:linear-gradient(${c},${c});`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${bxEsc(o.title || "Brasileuros")}</title>
<style>u+.body .gs{background:#000;mix-blend-mode:screen}u+.body .gd{background:#000;mix-blend-mode:difference}</style></head>
<body class="body" style="margin:0;padding:0;background:#0b1f4d" bgcolor="#0b1f4d">
<div style="display:none;max-height:0;overflow:hidden">${bxEsc(o.preheader || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ${bg("#0b1f4d")}"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;font-family:Arial,Helvetica,sans-serif">
<tr><td align="center" ${bg("#1e74b8")}border-radius:18px 18px 0 0;overflow:hidden;font-size:0;line-height:0"><a href="${BX_SITE}/"><img src="${BX_SITE}/assets/email-header.png" width="600" alt="Brasileuros – Comédia do Nosso Jeitinho" style="display:block;width:100%;max-width:600px;height:auto;border:0"></a></td></tr>
<tr><td ${bg("#ffd400")}height:6px;line-height:6px;font-size:0">&nbsp;</td></tr>
<tr><td ${bg("#102a63")}padding:30px 28px 30px">${o.inner}</td></tr>
<tr><td align="center" ${bg("#071433")}border-radius:0 0 18px 18px;padding:24px 22px">
${bxT(`<p style="margin:0 0 12px"><a href="https://www.instagram.com/osbrasileuros/" style="color:#ffffff;text-decoration:underline;font-weight:bold">Instagram</a> &nbsp;·&nbsp; <a href="https://www.tiktok.com/@osbrasileuros" style="color:#ffffff;text-decoration:underline;font-weight:bold">TikTok</a> &nbsp;·&nbsp; <a href="https://www.youtube.com/@osbrasileuros" style="color:#ffffff;text-decoration:underline;font-weight:bold">YouTube</a> &nbsp;·&nbsp; <a href="${BX_SITE}/" style="color:#ffffff;text-decoration:underline;font-weight:bold">brasileuros.com</a></p>${o.foot ? `<p style="margin:0;color:#ffffff">${o.foot}</p>` : ""}`, "font-size:13px;line-height:1.6")}
</td></tr>
</table></td></tr></table></body></html>`;
}

// ---------- cupom ----------
const fdate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Madrid" });
const cap1 = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
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
  const when = show?.date ? cap1(fdate(show.date)) + (show.time ? ", " + String(show.time).slice(0, 5).replace(":", "h") : "") : "";
  const pct = Number(c.percent) || 10;
  const hi = name ? `Oi, ${esc(name)}!` : "Oi!";
  const inner = bxT(`<p style="margin:0 0 14px;font-size:24px;font-weight:bold;color:#ffffff">${hi}</p>
    <p style="margin:0 0 20px;color:#ffffff">${isComic ? "Seu cupom pra divulgar o show:" : "Seu cupom pro Brasileuros:"}</p>`, "font-size:16px;line-height:1.55") + `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffd400" style="background:#ffd400;background-image:linear-gradient(#ffd400,#ffd400);border-radius:16px"><tr><td align="center" style="padding:22px 16px">
      <div style="font:bold 12px Arial,Helvetica,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#0b1f4d">Seu cupom</div>
      <div style="font:900 40px/1.1 'Arial Black',Arial,Helvetica,sans-serif;letter-spacing:.04em;color:#0b1f4d;margin:6px 0 4px">${esc(c.code)}</div>
      <div style="font:bold 15px Arial,Helvetica,sans-serif;color:#0b1f4d">${pct}% de desconto no ingresso</div>
    </td></tr></table>
    ${link ? bxBtn(`Comprar com ${pct}% off`, link) : ""}
    ${bxT(`<p style="margin:16px 0 0;font-size:14px;line-height:1.55;text-align:center;color:#ffffff">${link ? "Ou digite o cupom no Eventbrite." : "Use o cupom no Eventbrite, no campo de código promocional."}</p>`)}
    ${when ? `<div style="height:22px;line-height:22px;font-size:0">&nbsp;</div>` + bxCard(`<b style="color:#ffffff">${esc(when)}</b>${show?.venue ? `<br>${esc(show.venue)} · Barcelona` : ""}`) : ""}`;
  const html = bxShell({ title: `Seu cupom ${c.code}`, preheader: `${pct}% de desconto no Brasileuros`, inner, foot: isComic ? "Quem usar o cupom ou o link ganha o desconto." : "Um uso por pessoa." });
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
