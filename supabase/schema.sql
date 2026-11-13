-- Brasileuros · sistema de gestão (Supabase / Postgres) — adaptado do painel da BCN Comedy
-- Run once in the SQL editor. Safe to re-run: uses IF NOT EXISTS where possible.

create extension if not exists pgcrypto;

-- ---------- people ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  role text not null default 'admin' check (role in ('admin','producao','social')),
  active boolean not null default true,
  lang text not null default 'pt',
  created_at timestamptz not null default now()
);

-- every new auth user gets a profile (name/role come from the invite metadata)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          coalesce(new.raw_user_meta_data->>'role', 'admin'))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin');
$$;

-- ---------- shows ----------
create table if not exists public.shows (
  id text primary key default gen_random_uuid()::text,
  date date not null,
  time text not null default '19:30',
  title text not null default 'Brasileuros – Comédia do Nosso Jeitinho',
  status text not null default 'planned',
  venue text not null default 'Bar La Chirigota',
  capacity int default 50,
  eb_event_id text,
  eb_url text,
  free_tickets int default 0,
  cash_tickets int default 0,
  cash_price numeric default 7,
  bizum_tickets int default 0,
  bizum_price numeric default 7,
  eb_tickets int default 0,
  eb_net numeric default 0,
  sponsor numeric default 0,
  sponsor_paid boolean default false,
  headliners int default 0,
  headliner_fee numeric default 0,
  guests int default 0,
  guest_fee numeric default 0,
  held_by text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists shows_date_idx on public.shows(date);

create table if not exists public.comedians (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  instagram text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.lineup (
  id text primary key default gen_random_uuid()::text,
  show_id text references public.shows(id) on delete cascade,
  comedian_id uuid references public.comedians(id) on delete set null,
  artist text not null default '',
  spot text default 'guest',
  fee numeric default 0,
  payment text default 'Invited',
  contact text,
  coupon_code text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id text primary key default gen_random_uuid()::text,
  show_id text references public.shows(id) on delete cascade,
  template_key text,
  title text not null,
  due date,
  sector text,
  owner text,
  done boolean not null default false,
  done_at timestamptz,
  custom boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists tasks_due_idx on public.tasks(due);

create table if not exists public.coupons (
  id text primary key default gen_random_uuid()::text,
  code text not null unique,
  percent numeric default 0,
  scope text,
  usage_limit int,
  uses int default 0,
  status text default 'Active',
  show_id text references public.shows(id) on delete set null,
  comedian_id uuid references public.comedians(id) on delete set null,
  eb_discount_id text,
  notes text,
  owner_name text,
  owner_email text,
  created_at timestamptz not null default now()
);
alter table public.coupons add column if not exists owner_name text;
alter table public.coupons add column if not exists owner_email text;

create table if not exists public.ads (
  id text primary key default gen_random_uuid()::text,
  show_id text references public.shows(id) on delete cascade,
  platform text default 'Meta',
  start_date date,
  end_date date,
  budget numeric default 0,
  spent numeric default 0,
  status text default 'Draft',
  results text,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- money ----------
create table if not exists public.expenses (
  id text primary key default gen_random_uuid()::text,
  show_id text references public.shows(id) on delete set null,
  date date,
  item text,
  amount numeric default 0,
  paid_by text,
  category text,
  keeper text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id text primary key default gen_random_uuid()::text,
  date date,
  from_person text,
  to_person text,
  amount numeric default 0,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- instagram ----------
create table if not exists public.instagram (
  id text primary key default gen_random_uuid()::text,
  show_id text references public.shows(id) on delete set null,
  date date,
  time text,
  format text,
  pillar text,
  title text,
  caption text,
  status text default 'Idea',
  owner text,
  link text,
  reach int,
  likes int,
  saves int,
  shares int,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.ig_stats (
  id text primary key default gen_random_uuid()::text,   -- a função instagram usa a data como id (1 linha por dia)
  date date unique,
  followers int,
  reach int,
  profile_visits int,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- audience & sales ----------
create table if not exists public.signups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  email text not null,
  lang text,
  source text default 'site',
  consent boolean not null default true,
  coupon text,
  unsubscribed boolean not null default false
);
create unique index if not exists signups_email_idx on public.signups(lower(email));

create table if not exists public.orders (
  id text primary key,                 -- Eventbrite order id
  show_id text references public.shows(id) on delete set null,
  eb_event_id text,
  created_at timestamptz,
  buyer_name text,
  email text,
  quantity int default 0,
  gross numeric default 0,
  net numeric default 0,
  discount_code text,
  status text
);

-- ---------- system ----------
create table if not exists public.activity_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  action text not null,
  detail jsonb
);

create table if not exists public.email_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  recipient text,
  template text,
  status text,
  detail jsonb
);

create table if not exists public.settings (
  key text primary key,
  value jsonb
);

-- ---------- row level security ----------
do $$
declare t text;
begin
  foreach t in array array['shows','comedians','lineup','tasks','coupons','ads','expenses','payments',
                           'instagram','ig_stats','orders','activity_log','email_log','settings','signups'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (public.is_staff() or id = auth.uid());
drop policy if exists profiles_self on public.profiles;
drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- public site: may only add a signup, never read
drop policy if exists signups_public_insert on public.signups;
create policy signups_public_insert on public.signups for insert to anon with check (consent = true and unsubscribed = false);

-- colunas que a sincronização do Eventbrite preenche
alter table public.shows add column if not exists eb_sync_tickets int;
alter table public.shows add column if not exists eb_sync_net numeric;
alter table public.shows add column if not exists eb_sync_at timestamptz;
alter table public.shows add column if not exists capacity int default 50;

-- checklist padrão criado a cada show novo (dias em relação à data do show)
insert into public.settings (key, value) values ('task_template', '[{"key": "eb", "title": "Evento aberto no Eventbrite", "sector": "Ingressos", "offset": -14}, {"key": "guest", "title": "Fechar convidado(a) do Barcelouca", "sector": "Show", "offset": -6}, {"key": "flyer", "title": "Arte do show pronta", "sector": "Instagram", "offset": -7}, {"key": "ad_live", "title": "Anúncio rodando", "sector": "Anuncios", "offset": -6}, {"key": "ig_post", "title": "Post de humor com data e preço", "sector": "Instagram", "offset": -5}, {"key": "wa", "title": "Aviso na lista de WhatsApp", "sector": "Ingressos", "offset": -3}, {"key": "st2", "title": "Stories D-2 com link", "sector": "Instagram", "offset": -2}, {"key": "st1", "title": "Stories D-1 com link", "sector": "Instagram", "offset": -1}, {"key": "st0", "title": "Stories no dia + contagem", "sector": "Instagram", "offset": 0}, {"key": "cash", "title": "Fechar o caixa da noite", "sector": "Financeiro", "offset": 0}, {"key": "clips", "title": "Postar cortes do show", "sector": "Instagram", "offset": 2}, {"key": "barcelouca", "title": "Editar e postar o Barcelouca", "sector": "Instagram", "offset": 4}]'::jsonb)
on conflict (key) do nothing;

-- resumo cruzado (GA4 + Search Console + Instagram + Meta), gravado pela função metrics
create table if not exists public.insights (
  id text primary key,
  at timestamptz not null default now(),
  data jsonb
);
alter table public.insights enable row level security;
drop policy if exists staff_all on public.insights;
create policy staff_all on public.insights for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- e-mail marketing
create table if not exists public.campaigns (
  id text primary key,
  created_at timestamptz not null default now(),
  subject text, preheader text, title text, body text, image text,
  cta_text text, cta_url text, show_id text references public.shows(id) on delete set null,
  audience text default 'all', html text,
  status text default 'draft', sent_count int default 0, sent_at timestamptz
);
alter table public.campaigns enable row level security;
drop policy if exists staff_all on public.campaigns;
create policy staff_all on public.campaigns for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- imagens enviadas pela aba de e-mail (públicas para aparecerem no e-mail)
insert into storage.buckets (id, name, public) values ('email', 'email', true) on conflict (id) do nothing;
drop policy if exists email_staff_upload on storage.objects;
create policy email_staff_upload on storage.objects for insert to authenticated with check (bucket_id = 'email' and public.is_staff());


-- Integrações: tokens guardados pelas funções (RLS ligado e sem políticas: só o service role lê/escreve)
create table if not exists public.integrations (
  key text primary key,
  value text not null,
  meta jsonb,
  at timestamptz not null default now()
);
alter table public.integrations enable row level security;


-- Posts agendados: mídia, sticker de link, collab, local
alter table public.instagram add column if not exists media jsonb not null default '[]'::jsonb;
alter table public.instagram add column if not exists sticker_url text;
alter table public.instagram add column if not exists sticker_text text;
alter table public.instagram add column if not exists collab text;
alter table public.instagram add column if not exists location text;
insert into storage.buckets (id, name, public, file_size_limit) values ('posts', 'posts', true, 52428800) on conflict (id) do nothing;
drop policy if exists posts_staff_upload on storage.objects;
create policy posts_staff_upload on storage.objects for insert to authenticated with check (bucket_id = 'posts' and public.is_staff());
drop policy if exists posts_staff_delete on storage.objects;
create policy posts_staff_delete on storage.objects for delete to authenticated using (bucket_id = 'posts' and public.is_staff());
