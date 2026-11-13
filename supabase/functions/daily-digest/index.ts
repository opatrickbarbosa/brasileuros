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

export function digestHTML(p: {
  name: string; dateLabel: string; sold: number; net: number; nextLabel: string | null; nextSold: number; nextCap: number; daysTo: number | null;
  tonight: boolean; tasks: { title: string; sub: string; color: string }[]; late: { title: string; sub: string; color: string }[];
}) {
  const pct = p.nextCap ? Math.min(100, Math.round(p.nextSold / p.nextCap * 100)) : 0;
  const box = (t: { title: string; sub: string; color: string }, late = false) => `
    <tr><td style="padding:0 0 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${late ? "#fdecea" : "#f4f7fb"};border-radius:12px"><tr>
        <td width="44" valign="top" style="padding:14px 0 14px 14px"><div style="width:20px;height:20px;border:2px solid ${late ? "#c8240d" : "#3772B4"};border-radius:6px;background:#ffffff"></div></td>
        <td style="padding:12px 14px 12px 0;font-family:Arial,Helvetica,sans-serif">
          <div style="font-size:15px;line-height:1.35;font-weight:700;color:#0f1e3b">${esc(t.title)}</div>
          <div style="font-size:12.5px;line-height:1.4;color:#5b6b84;margin-top:3px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${t.color};margin-right:6px;vertical-align:middle"></span>${esc(t.sub)}</div>
        </td></tr></table>
    </td></tr>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;background:#3772B4;padding:0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#3772B4"><tr><td align="center" style="padding:26px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px">
  <tr><td style="padding:0 6px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td><img src="https://www.brasileuros.com/assets/email-logo.png" alt="Brasileuros" height="38" style="display:block;height:38px"></td>
    <td align="right" style="font:600 13px Arial,Helvetica,sans-serif;color:#cfe0f5">${esc(p.dateLabel)}</td></tr></table></td></tr>
  <tr><td style="background:#ffffff;border-radius:20px;padding:24px 22px 8px">
    <div style="font:800 22px/1.25 Arial,Helvetica,sans-serif;color:#0f1e3b;margin:0 0 16px">Bom dia, ${esc(p.name)}!</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%" valign="top" style="padding-right:6px"><div style="background:#0f1e3b;border-radius:16px;padding:16px">
        <div style="font:600 11px Arial,Helvetica,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#cfdcf0">Vendas de ontem</div>
        <div style="font:800 40px/1.05 Arial,Helvetica,sans-serif;color:#FDD929;margin-top:6px">${p.sold}</div>
        <div style="font:13px Arial,Helvetica,sans-serif;color:#cfdcf0;margin-top:2px">ingresso${p.sold === 1 ? "" : "s"} · ${esc(eur(p.net))}</div>
      </div></td>
      <td width="50%" valign="top" style="padding-left:6px"><div style="background:#FDD929;border-radius:16px;padding:16px">
        <div style="font:600 11px Arial,Helvetica,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#5c4a00">${p.tonight ? "Show hoje" : "Próximo show"}</div>
        ${p.nextLabel ? `<div style="font:800 40px/1.05 Arial,Helvetica,sans-serif;color:#0f1e3b;margin-top:6px">${p.nextSold}<span style="font-size:18px;color:#5c4a00">/${p.nextCap}</span></div>
        <div style="height:6px;border-radius:6px;background:rgba(15,30,59,.15);margin:8px 0 6px"><div style="height:6px;border-radius:6px;background:#0f1e3b;width:${pct}%"></div></div>
        <div style="font:13px Arial,Helvetica,sans-serif;color:#3d3200">${esc(p.nextLabel)}${p.daysTo != null && p.daysTo > 0 ? ` · faltam ${p.daysTo} dia${p.daysTo === 1 ? "" : "s"}` : ""}</div>`
        : `<div style="font:700 16px Arial,Helvetica,sans-serif;color:#0f1e3b;margin-top:10px">Nenhum show marcado</div>`}
      </div></td></tr></table>
    <div style="font:800 16px Arial,Helvetica,sans-serif;color:#0f1e3b;margin:24px 0 10px">Para fazer hoje <span style="display:inline-block;background:#3772B4;color:#fff;border-radius:999px;font-size:12px;padding:2px 9px;vertical-align:2px">${p.tasks.length}</span></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${p.tasks.length ? p.tasks.map((t) => box(t)).join("") : `<tr><td style="padding:14px;border-radius:12px;background:#eef8f0;font:14px Arial,Helvetica,sans-serif;color:#2c6b3a">Nada para hoje. Aproveite!</td></tr>`}
    </table>
    ${p.late.length ? `<div style="font:800 14px Arial,Helvetica,sans-serif;color:#c8240d;margin:16px 0 10px">Ficaram para trás (${p.late.length})</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${p.late.map((t) => box(t, true)).join("")}</table>` : ""}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 18px"><tr><td style="background:#3772B4;border-radius:999px"><a href="${HUB}" style="display:inline-block;padding:13px 22px;font:700 14px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none">Abrir o painel</a></td></tr></table>
  </td></tr>
  <tr><td style="padding:14px 8px;font:12px/1.5 Arial,Helvetica,sans-serif;color:#cfe0f5">Resumo diário do painel do Brasileuros. Para mudar horário ou quem recebe: Configurações no painel.</td></tr>
</table></td></tr></table></body></html>`;
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
