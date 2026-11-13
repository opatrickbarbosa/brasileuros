// daily-digest: resumo da manhã para a equipe — vendas de ontem, o próximo show e as tarefas do dia de cada pessoa.
// Configurado em Configurações (settings.digest = { on, hour, to: [emails] }).
// O cron chama de hora em hora; a função só manda na hora escolhida (horário de Barcelona) e uma vez por dia.
// Corpo: {} (cron) | { test: true } com login da equipe (manda só para quem pediu) | { force: true, only?: email } via cron.
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.14";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SMTP_USER = "contato@patrickbarbosa.com.br";
const FROM = '"Brasileuros" <contato@patrickbarbosa.com.br>';
const HUB = "https://www.brasileuros.com/admin";
const TZ = "Europe/Madrid";
const SECTOR_COLOR: Record<string, string> = { Show: "#ECC122", Instagram: "#d4569b", Anuncios: "#4c7bd9", Cupons: "#2f9e8f", Ingressos: "#8a63d2", Financeiro: "#5f8f3a" };

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const ymdIn = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const hourIn = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(d)) % 24;
const addDays = (s: string, n: number) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fdate = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { ...o, timeZone: "UTC" }).format(new Date(d + "T12:00:00Z")).replace(/\./g, "");
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const eur = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "EUR" }).format(v || 0);
const n = (v: unknown) => Number(v) || 0;
const firstName = (s: string | null) => String(s || "").trim().split(/\s+/)[0];
const owns = (owner: string | null, name: string) => {
  const me = firstName(name).toLowerCase();
  return !!me && String(owner || "").split("+").some((o) => { o = o.trim().toLowerCase(); return !!o && (o === me || o.startsWith(me) || me.startsWith(o)); });
};

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

export function digestHTML(p: {
  name: string; dateLabel: string; sold: number; net: number; nextLabel: string | null; nextSold: number; nextCap: number; daysTo: number | null;
  tonight: boolean; tasks: { title: string; sub: string; color: string }[]; late: { title: string; sub: string; color: string }[];
}) {
  const pct = p.nextCap ? Math.min(100, Math.round(p.nextSold / p.nextCap * 100)) : 0;
  const row = (t: { title: string; sub: string }, late = false) => `<tr><td width="34" valign="top" style="padding:14px 0 14px 0"><div style="width:18px;height:18px;border:2px solid ${late ? "#ff8f80" : "#ffd400"};border-radius:5px"></div></td>
    <td style="padding:12px 0;border-bottom:1px solid #24427f">${bxT(`<div style="font-size:16px;font-weight:bold;line-height:1.35;color:#ffffff">${esc(t.title)}</div><div style="font-size:13px;line-height:1.4;color:${late ? "#ffb4aa" : "#b9cbec"};margin-top:2px">${esc(t.sub)}</div>`)}</td></tr>`;
  const tile = (bgc: string, label: string, big: string, sub: string, ink: string) => `<td width="50%" valign="top" style="padding:0 5px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${bgc}" style="background:${bgc};background-image:linear-gradient(${bgc},${bgc});border-radius:14px"><tr><td style="padding:16px 16px 14px">
    <div style="font:bold 11px Arial,Helvetica,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:${ink}">${label}</div>
    <div style="font:900 38px/1.1 'Arial Black',Arial,Helvetica,sans-serif;color:${ink};margin-top:4px">${big}</div>
    <div style="font:13px/1.4 Arial,Helvetica,sans-serif;color:${ink};margin-top:4px">${sub}</div></td></tr></table></td>`;
  const inner = bxT(`<p style="margin:0 0 4px;font-size:24px;font-weight:bold;color:#ffffff">Bom dia, ${esc(p.name)}!</p><p style="margin:0 0 20px;font-size:14px;color:#b9cbec">${esc(p.dateLabel)}</p>`) + `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${tile("#1e74b8", "Ontem", String(p.sold), `ingresso${p.sold === 1 ? "" : "s"} vendido${p.sold === 1 ? "" : "s"} · ${esc(eur(p.net))}`, "#ffffff")}
      ${tile("#ffd400", p.tonight ? "Show hoje" : "Próximo show", p.nextLabel ? `${p.nextSold}<span style="font-size:18px">/${p.nextCap}</span>` : "—", p.nextLabel ? `${esc(p.nextLabel)}${p.daysTo != null && p.daysTo > 0 ? ` · em ${p.daysTo} dia${p.daysTo === 1 ? "" : "s"}` : ""}` : "Nenhum show marcado", "#0b1f4d")}
    </tr></table>
    ${bxT(`<p style="margin:26px 0 4px;font-size:18px;font-weight:bold;color:#ffffff">Para hoje${p.tasks.length ? ` (${p.tasks.length})` : ""}</p>`)}
    ${p.tasks.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${p.tasks.map((t) => row(t)).join("")}</table>` : bxT(`<p style="margin:8px 0 0;font-size:15px;color:#b9cbec">Nada para hoje.</p>`)}
    ${p.late.length ? bxT(`<p style="margin:22px 0 4px;font-size:15px;font-weight:bold;color:#ff8f80">Atrasadas (${p.late.length})</p>`) + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${p.late.map((t) => row(t, true)).join("")}</table>` : ""}
    ${bxBtn("Abrir o painel", HUB)}`;
  void pct;
  return bxShell({ title: "Resumo do dia", preheader: `${p.sold} venda${p.sold === 1 ? "" : "s"} ontem · ${p.tasks.length} tarefa${p.tasks.length === 1 ? "" : "s"} hoje`, inner, foot: "Resumo diário do painel. Horário e quem recebe: Configurações." });
}

async function staffFrom(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return null;
  const { data: p } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return p?.active ? p : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  const cronTok = req.headers.get("x-cron-secret");
  const { data: isCron } = cronTok ? await db.rpc("check_cron_token", { t: cronTok }) : { data: false };
  const staff = isCron === true ? null : await staffFrom(req);
  if (isCron !== true && !(staff && body.test)) return json({ error: "Not allowed" }, 401);

  const now = new Date(), today = ymdIn(now), yday = addDays(today, -1);
  const { data: cfgRow } = await db.from("settings").select("value").eq("key", "digest").maybeSingle();
  const cfg = { on: true, hour: 8, to: null as string[] | null, ...(cfgRow?.value || {}) };
  if (!staff && !body.force) {
    if (!cfg.on) return json({ ok: true, skipped: "off" });
    if (hourIn(now) !== Number(cfg.hour)) return json({ ok: true, skipped: "not the hour", hour: hourIn(now) });
  }

  const since = new Date(now.getTime() - 3 * 864e5).toISOString();
  const [{ data: people }, { data: tasks }, { data: shows }, { data: orders }] = await Promise.all([
    db.from("profiles").select("*").eq("active", true),
    db.from("tasks").select("*").eq("done", false).lte("due", today),
    db.from("shows").select("*").gte("date", addDays(today, -60)).order("date"),
    db.from("orders").select("created_at, quantity, net, status").gte("created_at", since),
  ]);
  const ok = (o: any) => !/refund|cancel/i.test(String(o.status || ""));
  const yOrders = (orders || []).filter((o) => o.created_at && ymdIn(new Date(o.created_at)) === yday && ok(o));
  const sold = yOrders.reduce((a, o) => a + n(o.quantity), 0), net = yOrders.reduce((a, o) => a + n(o.net), 0);
  const next = (shows || []).find((s) => s.date >= today && s.status !== "cancelled");
  const nextSold = next ? n(next.eb_tickets) + n(next.cash_tickets) + n(next.bizum_tickets) + n(next.free_tickets) : 0;
  const showOf = (id: string | null) => (shows || []).find((s) => s.id === id);

  let list = (people || []).filter((p) => p.email);
  if (staff) list = list.filter((p) => p.id === staff.id);
  else if (body.only) list = list.filter((p) => p.email === body.only);
  else if (Array.isArray(cfg.to)) list = list.filter((p) => cfg.to!.map((e: string) => e.toLowerCase()).includes(String(p.email).toLowerCase()));

  const tpl = "daily-digest:" + today;
  const { data: already } = await db.from("email_log").select("recipient").eq("template", tpl).eq("status", "sent");
  const done = new Set((already || []).map((x: any) => String(x.recipient).toLowerCase()));
  const mailer = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: SMTP_USER, pass: Deno.env.get("SMTP_PASSWORD") } });
  const sent: unknown[] = [];

  for (const p of list) {
    if (!staff && !body.force && done.has(String(p.email).toLowerCase())) continue;
    const mine = (tasks || []).filter((t) => owns(t.owner, p.name) || (!t.owner && p.role === "admin"));
    const line = (t: any) => {
      const s = showOf(t.show_id);
      const bits = [s ? "Show " + fdate(s.date, { day: "numeric", month: "short" }) : "", t.owner && String(t.owner).includes("+") ? "com " + String(t.owner).split("+").map((x: string) => x.trim()).filter((x: string) => !owns(x, p.name)).join(", ") : "", t.due < today ? "desde " + fdate(t.due, { weekday: "short", day: "numeric" }) : ""].filter(Boolean);
      return { title: t.title, sub: bits.join(" · ") || "Geral", color: SECTOR_COLOR[t.sector] || "#9a9a93" };
    };
    const todayT = mine.filter((t) => t.due === today).map(line);
    const lateT = mine.filter((t) => t.due < today).sort((a, b) => b.due.localeCompare(a.due)).slice(0, 8).map(line);
    const html = digestHTML({
      name: firstName(p.name) || "time", dateLabel: cap1(fdate(today, { weekday: "long", day: "numeric", month: "long" })), sold, net,
      nextLabel: next ? cap1(fdate(next.date, { weekday: "long", day: "numeric", month: "short" })) : null, nextSold, nextCap: n(next?.capacity) || 50,
      daysTo: next ? Math.round((Date.parse(next.date) - Date.parse(today)) / 864e5) : null, tonight: next?.date === today, tasks: todayT, late: lateT,
    });
    const subject = `${staff ? "[TESTE] " : ""}Bom dia! ${sold} venda${sold === 1 ? "" : "s"} ontem · ${todayT.length} tarefa${todayT.length === 1 ? "" : "s"} hoje`;
    try {
      await mailer.sendMail({ from: FROM, to: p.email, subject, html });
      await db.from("email_log").insert({ recipient: p.email, template: staff ? "daily-digest-test" : tpl, status: "sent", detail: { tasks: todayT.length, late: lateT.length, sold } });
      sent.push({ to: p.email, tasks: todayT.length });
    } catch (e) {
      await db.from("email_log").insert({ recipient: p.email, template: tpl, status: "error", detail: { error: String(e) } });
      sent.push({ to: p.email, error: String(e) });
    }
  }
  return json({ ok: true, today, sent });
});
