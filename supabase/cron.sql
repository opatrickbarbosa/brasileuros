-- Troque SEU-PROJETO pelo id do projeto Supabase do Brasileuros antes de rodar.
-- Scheduler: pg_cron + pg_net call the edge functions with a token that only the database knows.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.cron_token (id int primary key default 1 check (id = 1), token text not null default encode(extensions.gen_random_bytes(32), 'hex'));
insert into private.cron_token default values on conflict do nothing;

create or replace function public.check_cron_token(t text) returns boolean
language sql security definer set search_path = '' as $$
  select exists (select 1 from private.cron_token where token = t);
$$;
revoke all on function public.check_cron_token(text) from public, anon, authenticated;
grant execute on function public.check_cron_token(text) to service_role;

create or replace function private.call_fn(fn text, body jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare rid bigint;
begin
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select token from private.cron_token)),
    body := body,
    timeout_milliseconds := 60000) into rid;
  return rid;
end $$;
revoke all on function private.call_fn(text, jsonb) from public, anon, authenticated;

-- times are UTC: 07:30 UTC = 08:30 in Barcelona (winter), 09:30 in summer
select cron.unschedule(jobname) from cron.job where jobname in ('eb-sync','eb-sync-full','daily-digest','ig-stats');
select cron.schedule('eb-sync', '*/30 * * * *', $$select private.call_fn('eventbrite', '{"action":"sync"}')$$);
select cron.schedule('eb-sync-full', '15 3 * * *', $$select private.call_fn('eventbrite', '{"action":"sync","full":true}')$$);
select cron.schedule('daily-digest', '30 7 * * *', $$select private.call_fn('daily-digest', '{}')$$);
-- seguidores e alcance do Instagram: todo dia às 06:00 UTC
select cron.schedule('ig-stats', '0 6 * * *', $$select private.call_fn('instagram', '{}')$$);
select jobname, schedule from cron.job order by jobname;
