# Painel de gestão do Brasileuros: como ligar

O painel fica em `brasileuros.com/admin`. Sem banco conectado, ele abre em modo demonstração, com números de exemplo.

## 1. Banco (Supabase)
1. Crie um projeto novo no Supabase chamado **brasileuros**, na região Europa.
2. Em **SQL Editor**, rode o arquivo `schema.sql`.
3. Abra `cron.sql`, troque `SEU-PROJETO` pelo id do projeto e rode também.
4. Em **Authentication → URL Configuration**, use `https://www.brasileuros.com/admin` como Site URL e como Redirect URL.

## 2. Funções
Instale a Supabase CLI e, nesta pasta, rode:
```
supabase link --project-ref SEU-PROJETO
supabase functions deploy eventbrite --no-verify-jwt
supabase functions deploy instagram --no-verify-jwt
supabase functions deploy daily-digest --no-verify-jwt
supabase functions deploy invite-user
supabase secrets set EVENTBRITE_TOKEN=... META_TOKEN=... IG_USER_ID=17841476704355857 SMTP_PASSWORD=...
```
- **EVENTBRITE_TOKEN:** é o *private token* da conta que vende os ingressos do Brasileuros (eventbrite.com/platform/api-keys).
- **META_TOKEN:** é um token de longa duração com `instagram_basic` e `instagram_manage_insights`, da página do Facebook ligada ao @osbrasileuros.
- **SMTP_PASSWORD:** é a senha de app do Gmail que manda o resumo diário.

## 3. Primeiro acesso
1. Em **Authentication → Users**, convide o seu e-mail. Toda conta nova entra como admin.
2. Copie o **Project URL** e a **publishable key** (Project Settings → API) para as duas primeiras constantes de `admin.html`.
3. Publique.
4. Depois disso, convide o Pipo e o resto da equipe pela aba **Equipe** do painel.

## O que roda sozinho
- **Eventbrite:** sincroniza vendas e pedidos a cada 30 minutos e faz uma conferência completa às 03:15 UTC. Shows novos no Eventbrite com "Brasileuros" no nome aparecem sozinhos no painel, já com o checklist.
- **Instagram:** salva seguidores, alcance e visitas ao perfil todo dia às 06:00 UTC.
- **Cruzamento (a cada 3 h):** a função `metrics` junta GA4 (sem robôs), Search Console, Instagram e anúncios da Meta e monta o funil da primeira tela. Segredos: `GOOGLE_SERVICE_ACCOUNT` (JSON da conta de serviço com leitura no GA4 e no Search Console), `GA4_PROPERTY_ID`, `GSC_SITE` e, se houver anúncios, `META_AD_ACCOUNT_ID`.
- **E-mail marketing:** a aba E-mail monta a campanha no visual do Brasileuros e envia pela função `send-email`, usando o Gmail de contato@patrickbarbosa.com.br (precisa do segredo `SMTP_PASSWORD`). O link de descadastro é atendido pela função `unsubscribe`. Só recebe quem aceitou ser contatado.
- **Resumo diário:** um e-mail às 07:30 UTC para cada pessoa com tarefas para o dia.
