-- Limite de débit et journal d'audit des outils connectés du MCP Toolzy.
-- Idempotente : peut être rejouée sans effet de bord.
-- Accès réservé à la connexion serveur du MCP (MCP_AUTH_DATABASE_URL) :
-- aucun droit pour anon, authenticated ni public.

create schema if not exists mcp_auth;

-- Compteurs en fenêtres fixes (minute, heure, jour UTC), un par
-- utilisateur, compteur et fenêtre. Incrément atomique par
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING côté serveur.
create table if not exists mcp_auth.mcp_rate_counters (
  user_id text not null,
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  primary key (user_id, bucket, window_start)
);

create index if not exists mcp_rate_counters_window_start_idx
  on mcp_auth.mcp_rate_counters (window_start);

-- Journal des appels d'outils connectés : qui, quel client, quel outil,
-- quand, résultat. AUCUN contenu de message, AUCUN argument, AUCUN jeton.
create table if not exists mcp_auth.mcp_audit_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id text not null,
  client_id text,
  tool text not null,
  status text not null check (status in ('ok', 'error', 'rate_limited', 'denied')),
  duration_ms integer check (duration_ms >= 0),
  error_kind text check (error_kind ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$')
);

create index if not exists mcp_audit_log_user_created_idx
  on mcp_auth.mcp_audit_log (user_id, created_at);

-- Purge des fenêtres terminées depuis plus de 2 jours (la plus longue fenêtre
-- fait 1 jour). Renvoie le nombre de lignes supprimées.
create or replace function mcp_auth.mcp_purge_rate_counters()
returns integer
language sql
security invoker
set search_path = ''
as $$
  with deleted as (
    delete from mcp_auth.mcp_rate_counters
    where window_start < now() - interval '2 days'
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on schema mcp_auth from anon, authenticated, public;
revoke all on table mcp_auth.mcp_rate_counters from anon, authenticated, public;
revoke all on table mcp_auth.mcp_audit_log from anon, authenticated, public;
revoke all on sequence mcp_auth.mcp_audit_log_id_seq from anon, authenticated, public;
revoke all on function mcp_auth.mcp_purge_rate_counters() from anon, authenticated, public;

-- Purge quotidienne si pg_cron est disponible (prod). En local sans pg_cron,
-- la table reste petite et la fonction peut être appelée à la main.
-- cron.schedule avec un nom existant remplace la tâche : pas de doublon.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'mcp-purge-rate-counters',
      '17 3 * * *',
      'select mcp_auth.mcp_purge_rate_counters()'
    );
  end if;
end;
$$;
