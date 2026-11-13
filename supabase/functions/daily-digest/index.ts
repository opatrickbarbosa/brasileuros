// daily-digest: every morning, e-mail each active user the tasks due today plus anything overdue.
// Tasks with no owner go to every admin. Nobody gets an e-mail on a day with nothing to do.
// Body: {} for everyone, or { only: "email@x" } to send just one (used for testing).
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.14";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SMTP_USER = "contato@patrickbarbosa.com.br";
const FROM = '"Brasileuros" <contato@patrickbarbosa.com.br>';
const HUB = "https://www.brasileuros.com/admin";

const T = {
  pt: { subj: (n: number) => `Hoje: ${n} tarefa${n > 1 ? "s" : ""} no Brasileuros`, hi: "Bom dia", today: "Para hoje", late: "Atrasadas", show: "Show hoje", open: "Abrir o painel", none: "Sem show", foot: "Você recebe este resumo porque tem tarefas no painel do Brasileuros." },
  en: { subj: (n: number) => `Today: ${n} task${n > 1 ? "s" : ""} at Brasileuros`, hi: "Good morning", today: "Due today", late: "Overdue", show: "Show tonight", open: "Open the hub", none: "No show", foot: "You get this summary because you have tasks in the Brasileuros hub." },
};
const SECTOR: Record<string, string> = { Anuncios: "An\u00fancios", Patrocinio: "Patroc\u00ednio" };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const madridToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
const fdate = (d: string, lang: string) => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pt-BR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z")).replace(/\./g, "");

function html(lang: "pt" | "en", name: string, groups: { title: string; items: string[] }[], todayShow: string | null) {
  const t = T[lang];
  const section = (g: { title: string; items: string[] }) => g.items.length ? `
    <tr><td style="padding:18px 28px 6px;font:600 13px/1.4 Arial,Helvetica,sans-serif;color:#8a6a00;text-transform:uppercase;letter-spacing:.06em">${esc(g.title)}</td></tr>
    ${g.items.map((i) => `<tr><td style="padding:6px 28px;font:15px/1.5 Arial,Helvetica,sans-serif;color:#151515">${i}</td></tr>`).join("")}` : "";
  return `<!doctype html><html><head><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;background:#f5f5f2;padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e3de;border-radius:12px;overflow:hidden">
  <tr><td style="background:#3772B4;padding:18px 28px"><img src="https://www.brasileuros.com/assets/email-logo.png" alt="Brasileuros" height="44" style="display:block;height:44px"></td></tr>
  <tr><td style="padding:24px 28px 4px;font:600 20px/1.3 Arial,Helvetica,sans-serif;color:#151515">${esc(t.hi)}, ${esc(name)}</td></tr>
  ${todayShow ? `<tr><td style="padding:10px 28px 0"><span style="display:inline-block;background:#FDD929;color:#151515;font:600 13px Arial,Helvetica,sans-serif;padding:6px 12px;border-radius:999px">${esc(t.show)}: ${esc(todayShow)}</span></td></tr>` : ""}
  ${groups.map(section).join("")}
  <tr><td style="padding:22px 28px 26px"><a href="${HUB}" style="display:inline-block;background:#FDD929;color:#151515;text-decoration:none;font:600 14px Arial,Helvetica,sans-serif;padding:11px 18px;border-radius:8px">${esc(t.open)}</a></td></tr>
  <tr><td style="padding:14px 28px;border-top:1px solid #e3e3de;font:12px/1.5 Arial,Helvetica,sans-serif;color:#6a6a64">${esc(t.foot)}</td></tr>
</table></body></html>`;
}

Deno.serve(async (req) => {
  const token = req.headers.get("x-cron-secret");
  const { data: ok } = token ? await db.rpc("check_cron_token", { t: token }) : { data: false };
  if (ok !== true) return new Response(JSON.stringify({ error: "Not allowed" }), { status: 401 });
  const body = await req.json().catch(() => ({}));

  const today = madridToday();
  const [{ data: people }, { data: tasks }, { data: shows }] = await Promise.all([
    db.from("profiles").select("*").eq("active", true),
    db.from("tasks").select("*").eq("done", false).lte("due", today),
    db.from("shows").select("id, date, title, status"),
  ]);
  const showOf = (id: string | null) => (shows || []).find((s) => s.id === id);
  const tonight = (shows || []).find((s) => s.date === today && s.status !== "cancelled");

  const mailer = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: SMTP_USER, pass: Deno.env.get("SMTP_PASSWORD") } });
  const sent: unknown[] = [];

  for (const p of people || []) {
    if (body.only && p.email !== body.only) continue;
    const lang: "pt" | "en" = p.lang === "en" ? "en" : "pt";
    const me = String(p.name || "").toLowerCase();
    const owns = (o: string | null) => !!o && !!me && (me === o.toLowerCase() || me.startsWith(o.toLowerCase()) || o.toLowerCase().startsWith(me));
    const mine = (tasks || []).filter((t) => owns(t.owner) || (!t.owner && p.role === "admin"));
    if (!mine.length && !body.test) continue;
    const line = (t: any) => {
      const s = showOf(t.show_id);
      const where = s ? `${fdate(s.date, lang)} · ${esc(s.title)}` : T[lang].none;
      const late = t.due < today ? ` <span style="color:#c8240d">(${fdate(t.due, lang)})</span>` : "";
      return `<b>${esc(t.title)}</b>${late}<br><span style="font-size:13px;color:#6a6a64">${where}${t.sector ? " · " + esc(SECTOR[t.sector] || t.sector) : ""}</span>`;
    };
    const due = mine.filter((t) => t.due === today).map(line);
    const late = mine.filter((t) => t.due < today).sort((a, b) => a.due.localeCompare(b.due)).map(line);
    const total = due.length + late.length;
    if (body.test && !total) due.push(lang === "en" ? "<b>Test e-mail</b><br><span style=\"font-size:13px;color:#6a6a64\">Nothing due today. This is how the daily summary will look.</span>" : "<b>E-mail de teste</b><br><span style=\"font-size:13px;color:#6a6a64\">Nada vence hoje. \u00c9 assim que o resumo di\u00e1rio vai chegar.</span>");
    try {
      await mailer.sendMail({
        from: FROM, to: p.email, subject: T[lang].subj(Math.max(total, due.length)),
        html: html(lang, p.name, [{ title: T[lang].today, items: due }, { title: T[lang].late, items: late }], tonight ? `${tonight.title}` : null),
      });
      await db.from("email_log").insert({ recipient: p.email, template: "daily-digest", status: "sent", detail: { total } });
      sent.push({ to: p.email, total });
    } catch (e) {
      await db.from("email_log").insert({ recipient: p.email, template: "daily-digest", status: "error", detail: { error: String(e) } });
      sent.push({ to: p.email, error: String(e) });
    }
  }
  return new Response(JSON.stringify({ ok: true, today, sent }), { headers: { "Content-Type": "application/json" } });
});
