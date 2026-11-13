// unsubscribe: link "Descadastrar" dos e-mails. GET ?id=<id do cadastro> (e POST de um clique, padrão List-Unsubscribe).
import { createClient } from "npm:@supabase/supabase-js@2";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const page = (title: string, text: string) => new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#1f74b9;color:#fff;min-height:100vh;display:grid;place-items:center;text-align:center;padding:24px">
<div style="max-width:420px"><img src="https://www.brasileuros.com/assets/email-logo.png" alt="Brasileuros" style="width:240px;height:auto"><h1 style="font-size:24px;margin:24px 0 8px">${title}</h1><p style="line-height:1.5;color:#d8e6f6">${text}</p>
<p><a href="https://www.brasileuros.com" style="display:inline-block;margin-top:12px;background:#FDD929;color:#0f1e3b;text-decoration:none;font-weight:800;padding:12px 24px;border-radius:999px">brasileuros.com</a></p></div></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
Deno.serve(async (req) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return page("Link inválido", "Esse link de descadastro não é válido.");
  await db.from("signups").update({ unsubscribed: true }).eq("id", id);
  return page("Pronto, você saiu da lista", "Você não vai mais receber e-mails do Brasileuros. Se mudar de ideia, é só se cadastrar de novo no site.");
});
