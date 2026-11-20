-- Rendre le serveur mcp.toolzy.io visible dans la page « MCP logs » de l'admin.
--
-- 1. public.mcp_logs (lue par l'admin) gagne une colonne `endpoint`. Les lignes
--    existantes et celles de l'ancien serveur (toolzy-v2, www.toolzy.io/api/mcp),
--    qui ne la renseigne pas, prennent la valeur par défaut 'www.toolzy.io'.
-- 2. Le rôle du serveur MCP peut y INSÉRER ses appels publics, et seulement
--    avec endpoint = 'mcp.toolzy.io'. Il ne peut ni lire ni modifier la table.
-- 3. Vue public.mcp_connected_calls : appels des outils du compte, lus depuis
--    le journal d'audit, SANS l'identité de l'utilisateur. Réservée au
--    service_role (l'admin), fermée à anon et authenticated.

alter table public.mcp_logs
  add column if not exists endpoint text not null default 'www.toolzy.io';

grant usage on schema public to toolzy_mcp_auth;
grant insert on public.mcp_logs to toolzy_mcp_auth;

drop policy if exists "MCP server inserts its public calls" on public.mcp_logs;
create policy "MCP server inserts its public calls"
  on public.mcp_logs
  for insert
  to toolzy_mcp_auth
  with check (endpoint = 'mcp.toolzy.io');

create or replace view public.mcp_connected_calls
  with (security_invoker = true)
as
  select id, created_at, client_id, tool, status, duration_ms, error_kind
  from mcp_auth.mcp_audit_log;

comment on view public.mcp_connected_calls is
  'Appels des outils du compte du serveur MCP (mcp.toolzy.io), sans identité utilisateur. Lecture admin (service_role) uniquement.';

revoke all on public.mcp_connected_calls from public, anon, authenticated;
grant select on public.mcp_connected_calls to service_role;

-- security_invoker : le service_role lit la table sous-jacente avec ses propres droits.
grant usage on schema mcp_auth to service_role;
grant select on mcp_auth.mcp_audit_log to service_role;
