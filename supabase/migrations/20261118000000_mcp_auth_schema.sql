-- Pile locale uniquement : schéma où le serveur d'autorisation (Better Auth)
-- range ses tables (clients, consentements, jetons). Ses tables sont créées par
-- `npx @better-auth/cli migrate`, pas par cette migration.
create schema if not exists mcp_auth;
