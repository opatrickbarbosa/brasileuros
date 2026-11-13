// eventbrite: sync ticket sales and coupon usage from Eventbrite, and push coupons created in the hub.
// Actions (POST JSON): { action: "sync", full?: boolean } | { action: "push_coupon", id } | { action: "probe" }
// Callers: an active staff user (Authorization: Bearer <user JWT>) or the scheduler (x-cron-secret header).
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://www.eventbriteapi.com/v3";
const AUTO_FROM = "2026-11-04";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function eb(path: string, init: RequestInit = {}) {
  const r = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${Deno.env.get("EVENTBRITE_TOKEN")}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Eventbrite ${r.status}: ${j.error_description || j.error || JSON.stringify(j).slice(0, 300)}`);
  return j;
}
async function paged(path: string, key: string) {
  let out: any[] = [], cont: string | null = null;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const j = await eb(path + (cont ? `${sep}continuation=${cont}` : ""));
    out = out.concat(j[key] || []);
    cont = j.pagination?.has_more_items ? j.pagination.continuation : null;
  } while (cont);
  return out;
}
async function getSetting(key: string) {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
const setSetting = (key: string, value: unknown) => db.from("settings").upsert({ key, value });

async function orgId(): Promise<string> {
  const cached = await getSetting("eb_org_id");
  if (cached) return String(cached);
  const j = await eb("/users/me/organizations/");
  const orgs = j.organizations || [];
  const org = orgs.find((o: any) => /brasil|zuca/i.test(o.name)) || orgs[0];
  if (!org) throw new Error("No Eventbrite organization found for this token");
  await setSetting("eb_org_id", org.id);
  await setSetting("eb_org_name", org.name);
  return String(org.id);
}
const money = (c: any) => (c ? Number(c.major_value ?? (c.value ?? 0) / 100) : 0);
const eventIdFromUrl = (u?: string | null) => (u ? (String(u).match(/(\d{9,})/) || [])[1] || null : null);

async function sync(full: boolean) {
  const org = await orgId();
  const events = await paged(`/organizations/${org}/events/?status=draft,live,started,ended,completed&page_size=100`, "events");
  // cria no painel os shows que já existem no Eventbrite e ainda não estão cadastrados
  {
    const { data: known } = await db.from("shows").select("date, eb_event_id");
    const fresh = events.filter((ev: any) => ev.status !== "canceled" && /brasil/i.test(ev.name?.text || "") &&
      !(known || []).some((k: any) => k.eb_event_id === ev.id || k.date === String(ev.start?.local || "").slice(0, 10)));
    if (fresh.length) {
      const { data: tpl } = await db.from("settings").select("value").eq("key", "task_template").maybeSingle();
      for (const ev of fresh) {
        const date = String(ev.start.local).slice(0, 10);
        const id = "s" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
        await db.from("shows").insert({ id, date, time: String(ev.start.local).slice(11, 16), eb_event_id: ev.id, eb_url: ev.url, capacity: ev.capacity || 50 });
        const add = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
        const tasks = ((tpl?.value as any[]) || []).map((t) => ({ id: id + ":" + t.key, show_id: id, template_key: t.key, title: t.title, sector: t.sector, due: add(date, t.offset), done: false }));
        if (tasks.length) await db.from("tasks").upsert(tasks);
      }
    }
  }
  const { data: shows } = await db.from("shows").select("*");
  const today = new Date().toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 4 * 864e5).toISOString().slice(0, 10);
  const report: any[] = [];
  const codeUses: Record<string, number> = {};

  for (const s of shows || []) {
    const rank = (e: any) => (["live", "started", "ended", "completed"].includes(e.status) ? 0 : 1);
    const ev = events.find((e: any) => e.id === s.eb_event_id || e.id === eventIdFromUrl(s.eb_url))
      || events.filter((e: any) => e.status !== "canceled" && String(e.start?.local || "").slice(0, 10) === s.date).sort((a: any, b: any) => rank(a) - rank(b))[0];
    if (!ev) continue;
    const patch: any = {};
    if (s.eb_event_id !== ev.id) patch.eb_event_id = ev.id;
    if (!s.eb_url) patch.eb_url = ev.url;
    const inWindow = full || s.date >= recent;
    if (ev.status !== "draft" && (inWindow || !s.eb_event_id)) {
      const attendees = await paged(`/events/${ev.id}/attendees/?status=attending&expand=promotional_code`, "attendees");
      const orders: Record<string, any> = {};
      let net = 0;
      for (const a of attendees) {
        if (a.cancelled || a.refunded) continue;
        const c = a.costs || {};
        const n = money(c.gross) - money(c.eventbrite_fee) - money(c.payment_fee) - money(c.tax);
        net += n;
        const code = a.promotional_code?.code ? String(a.promotional_code.code).toUpperCase() : null;
        if (code) codeUses[code] = (codeUses[code] || 0) + 1;
        const o = orders[a.order_id] ||= { id: a.order_id, show_id: s.id, eb_event_id: ev.id, created_at: a.created, buyer_name: a.profile?.name || null, email: a.profile?.email || null, quantity: 0, gross: 0, net: 0, discount_code: code, status: a.status || "Attending" };
        o.quantity += 1; o.gross += money(c.gross); o.net += n;
      }
      const rows = Object.values(orders);
      if (rows.length) await db.from("orders").upsert(rows);
      patch.eb_sync_tickets = attendees.filter((a: any) => !a.cancelled && !a.refunded).length;
      patch.eb_sync_net = Math.round(net * 100) / 100;
      patch.eb_sync_at = new Date().toISOString();
      // shows closed by hand before automatic tracking keep their own figures
      if (s.date >= AUTO_FROM) { patch.eb_tickets = patch.eb_sync_tickets; patch.eb_net = patch.eb_sync_net; }
      report.push({ date: s.date, event: ev.id, tickets: patch.eb_sync_tickets, net: patch.eb_sync_net });
    }
    if (Object.keys(patch).length) await db.from("shows").update(patch).eq("id", s.id);
  }

  // coupon usage across the synced events (full sync only, so partial windows never undercount)
  if (full) {
    const { data: coupons } = await db.from("coupons").select("id, code");
    for (const c of coupons || []) {
      await db.from("coupons").update({ uses: codeUses[String(c.code).toUpperCase()] || 0 }).eq("id", c.id);
    }
  }
  await setSetting("eb_last_sync", { at: new Date().toISOString(), full, today });
  return { ok: true, events: events.length, synced: report };
}

async function pushCoupon(id: string) {
  const org = await orgId();
  const { data: c } = await db.from("coupons").select("*").eq("id", id).single();
  if (!c) throw new Error("Coupon not found");
  const discount: any = { type: "coded", code: c.code, percent_off: String(Number(c.percent) || 0), quantity_available: c.usage_limit || 0 };
  let targets: string[] = [];
  if (c.show_id) {
    const { data: s } = await db.from("shows").select("eb_event_id, eb_url").eq("id", c.show_id).single();
    const ev = s?.eb_event_id || eventIdFromUrl(s?.eb_url);
    if (ev) targets = [ev];
  }
  if (!targets.length) {
    // every upcoming show that is linked to an Eventbrite event
    const today = new Date().toISOString().slice(0, 10);
    const { data: up } = await db.from("shows").select("eb_event_id, eb_url, status").gte("date", today);
    targets = [...new Set((up || []).filter((x) => x.status !== "cancelled").map((x) => x.eb_event_id || eventIdFromUrl(x.eb_url)).filter(Boolean))] as string[];
  }
  if (!targets.length) throw new Error("No Eventbrite event to attach this coupon to");
  const ids: string[] = c.eb_discount_id ? String(c.eb_discount_id).split(",") : [];
  const created: string[] = [];
  for (const ev of targets) {
    const body = { discount: { ...discount, event_id: ev } };
    const existing = ids.find((x) => x.startsWith(ev + ":"));
    if (existing) { await eb(`/discounts/${existing.split(":")[1]}/`, { method: "POST", body: JSON.stringify(body) }); created.push(existing); }
    else {
      try { const d = await eb(`/organizations/${org}/discounts/`, { method: "POST", body: JSON.stringify(body) }); created.push(`${ev}:${d.id}`); }
      catch (e) { if (!/already|exist|duplicate/i.test(String(e))) throw e; }
    }
  }
  await db.from("coupons").update({ eb_discount_id: created.join(","), status: "Active" }).eq("id", id);
  return { ok: true, events: targets.length };
}

async function deleteCoupon(ebIds: string) {
  const done: string[] = [];
  for (const pair of String(ebIds || "").split(",").filter((x) => x.includes(":"))) {
    const id = pair.split(":")[1];
    await eb(`/discounts/${id}/`, { method: "DELETE" }).catch((e) => { if (!/404|NOT_FOUND/i.test(String(e))) throw e; });
    done.push(id);
  }
  return { ok: true, deleted: done.length };
}

async function probe() {
  const org = await orgId();
  const events = await paged(`/organizations/${org}/events/?status=draft,live,started,ended,completed&page_size=100`, "events");
  const ev = events[0];
  const disc = ev ? await eb(`/organizations/${org}/discounts/?scope=event&event_id=${ev.id}`).catch((e) => ({ error: String(e) })) : null;
  return { org, events: events.map((e: any) => ({ id: e.id, start: e.start?.local, status: e.status, name: e.name?.text })), sampleDiscounts: disc };
}

async function authorized(req: Request) {
  const cronToken = req.headers.get("x-cron-secret");
  if (cronToken) { const { data } = await db.rpc("check_cron_token", { t: cronToken }); if (data === true) return true; }
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
    if (body.action === "push_coupon") return json(await pushCoupon(body.id));
    if (body.action === "delete_coupon") return json(await deleteCoupon(body.eb_discount_id));
    if (body.action === "probe") return json(await probe());
    return json(await sync(!!body.full));
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
