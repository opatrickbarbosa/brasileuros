// invite-user: lets an active admin invite a new person to the Brasileuros hub.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return json({ error: "Not signed in" }, 401);
  const { data: me } = await admin.from("profiles").select("role, active").eq("id", user.id).single();
  if (!me || !me.active || me.role !== "admin") return json({ error: "Only admins can invite" }, 403);

  const { email, name, role } = await req.json().catch(() => ({}));
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Invalid e-mail" }, 400);
  const safeRole = ["admin", "producao", "social"].includes(role) ? role : "producao";

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { name: name || email.split("@")[0], role: safeRole },
    redirectTo: "https://www.brasileuros.com/admin",
  });
  if (error) return json({ error: error.message }, 400);
  await admin.from("activity_log").insert({ user_id: user.id, action: "user_invited", detail: { email, role: safeRole } });
  return json({ ok: true, id: data.user?.id });
});
