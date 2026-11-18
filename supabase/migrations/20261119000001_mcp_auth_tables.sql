-- Tables du serveur d'autorisation du MCP Toolzy (Better Auth 1.7.25) et rôle
-- de connexion dédié. Idempotente : peut être rejouée sans effet de bord.
--
-- Source : pg_dump --schema-only du schéma mcp_auth local, identique à ce que
-- génère Better Auth 1.7.25 (plugins jwt, genericOAuth, mcp, cimd) ; vérifié le
-- 19/11/2026 par getMigrations : aucune table ni colonne manquante.
-- Une montée de version de better-auth ou un nouveau plugin peut exiger de
-- nouvelles colonnes : refaire la comparaison avant de déployer.
--
-- Ordre d'application en prod : 20261119000000_mcp_guard.sql (limite de débit,
-- audit) puis ce fichier. L'ordre inverse marche aussi : les droits sont
-- donnés sur tout le schéma ET par défaut sur les objets créés ensuite.
--
-- Accès : uniquement le rôle toolzy_mcp_auth (connexion serveur du MCP,
-- MCP_AUTH_DATABASE_URL). Aucun droit pour anon, authenticated ni public.
-- Le schéma n'est pas exposé par l'API (seuls public et graphql_public le sont).
-- Le rôle est créé sans connexion : son mot de passe est posé à la main, hors
-- dépôt (voir le runbook de mise en production).

create schema if not exists mcp_auth;

-- ---------------------------------------------------------------------------
-- Rôle dédié
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'toolzy_mcp_auth') then
    create role toolzy_mcp_auth nologin noinherit;
  end if;
end;
$$;

-- Better Auth écrit des noms de tables sans schéma : le search_path du rôle
-- s'applique à chaque connexion, y compris derrière le pooler en mode
-- transaction (qui ne relaie pas toujours le paramètre `options` de l'URL).
alter role toolzy_mcp_auth set search_path = mcp_auth;

-- ---------------------------------------------------------------------------
-- Tables Better Auth (noms camelCase, entre guillemets)
-- ---------------------------------------------------------------------------

create table if not exists mcp_auth."user" (
  id text not null,
  name text not null,
  email text not null,
  "emailVerified" boolean not null,
  image text,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null default current_timestamp,
  constraint user_pkey primary key (id),
  constraint user_email_key unique (email)
);

create table if not exists mcp_auth.session (
  id text not null,
  "expiresAt" timestamptz not null,
  token text not null,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null,
  constraint session_pkey primary key (id),
  constraint session_token_key unique (token),
  constraint "session_userId_fkey" foreign key ("userId")
    references mcp_auth."user" (id) on delete cascade
);

-- Jetons Supabase de l'utilisateur (providerId 'supabase'), chiffrés par
-- Better Auth (account.encryptOAuthTokens) avec BETTER_AUTH_SECRET.
create table if not exists mcp_auth.account (
  id text not null,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null,
  constraint account_pkey primary key (id),
  constraint "account_userId_fkey" foreign key ("userId")
    references mcp_auth."user" (id) on delete cascade
);

create table if not exists mcp_auth.verification (
  id text not null,
  identifier text not null,
  value text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null default current_timestamp,
  constraint verification_pkey primary key (id)
);

-- Clés de signature des jetons MCP (clé privée chiffrée avec BETTER_AUTH_SECRET).
create table if not exists mcp_auth.jwks (
  id text not null,
  "publicKey" text not null,
  "privateKey" text not null,
  "createdAt" timestamptz not null,
  "expiresAt" timestamptz,
  alg text,
  crv text,
  constraint jwks_pkey primary key (id)
);

create table if not exists mcp_auth."oauthClient" (
  id text not null,
  "clientId" text not null,
  "clientSecret" text,
  "clientDiscoveryId" text,
  disabled boolean,
  "skipConsent" boolean,
  "enableEndSession" boolean,
  "subjectType" text,
  scopes jsonb,
  "clientCredentialsScopes" jsonb,
  "userId" text,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  name text,
  uri text,
  icon text,
  contacts jsonb,
  tos text,
  policy text,
  "softwareId" text,
  "softwareVersion" text,
  "softwareStatement" text,
  "redirectUris" jsonb not null,
  "postLogoutRedirectUris" jsonb,
  "backchannelLogoutUri" text,
  "backchannelLogoutSessionRequired" boolean,
  "tokenEndpointAuthMethod" text,
  "applicationType" text,
  jwks text,
  "jwksUri" text,
  "grantTypes" jsonb,
  "responseTypes" jsonb,
  "requirePKCE" boolean,
  "dpopBoundAccessTokens" boolean,
  "referenceId" text,
  metadata jsonb,
  constraint "oauthClient_pkey" primary key (id),
  constraint "oauthClient_clientId_key" unique ("clientId"),
  constraint "oauthClient_userId_fkey" foreign key ("userId")
    references mcp_auth."user" (id) on delete cascade
);

create table if not exists mcp_auth."oauthResource" (
  id text not null,
  identifier text not null,
  name text not null,
  "accessTokenTtl" integer,
  "refreshTokenTtl" integer,
  "signingAlgorithm" text,
  "signingKeyId" text,
  "allowedScopes" jsonb,
  "customClaims" jsonb,
  "dpopBoundAccessTokensRequired" boolean,
  disabled boolean,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "policyVersion" integer,
  metadata jsonb,
  constraint "oauthResource_pkey" primary key (id),
  constraint "oauthResource_identifier_key" unique (identifier)
);

create table if not exists mcp_auth."oauthClientResource" (
  id text not null,
  "clientId" text not null,
  "resourceId" text not null,
  metadata jsonb,
  "createdAt" timestamptz,
  constraint "oauthClientResource_pkey" primary key (id),
  constraint "oauthClientResource_clientId_fkey" foreign key ("clientId")
    references mcp_auth."oauthClient" ("clientId") on delete cascade,
  constraint "oauthClientResource_resourceId_fkey" foreign key ("resourceId")
    references mcp_auth."oauthResource" (identifier) on delete cascade
);

create table if not exists mcp_auth."oauthRefreshToken" (
  id text not null,
  token text not null,
  "clientId" text not null,
  "sessionId" text,
  "userId" text not null,
  "referenceId" text,
  "authorizationCodeId" text,
  resources jsonb,
  "requestedUserInfoClaims" jsonb,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null,
  revoked timestamptz,
  "rotatedAt" timestamptz,
  "rotationReplayResponse" text,
  "rotationReplayExpiresAt" timestamptz,
  "authTime" timestamptz,
  confirmation jsonb,
  scopes jsonb not null,
  constraint "oauthRefreshToken_pkey" primary key (id),
  constraint "oauthRefreshToken_token_key" unique (token),
  constraint "oauthRefreshToken_clientId_fkey" foreign key ("clientId")
    references mcp_auth."oauthClient" ("clientId") on delete cascade,
  constraint "oauthRefreshToken_sessionId_fkey" foreign key ("sessionId")
    references mcp_auth.session (id) on delete set null,
  constraint "oauthRefreshToken_userId_fkey" foreign key ("userId")
    references mcp_auth."user" (id) on delete cascade
);

create table if not exists mcp_auth."oauthAccessToken" (
  id text not null,
  token text not null,
  "clientId" text not null,
  "sessionId" text,
  "userId" text,
  "referenceId" text,
  "authorizationCodeId" text,
  resources jsonb,
  "requestedUserInfoClaims" jsonb,
  "refreshId" text,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null,
  revoked timestamptz,
  confirmation jsonb,
  scopes jsonb not null,
  constraint "oauthAccessToken_pkey" primary key (id),
  constraint "oauthAccessToken_token_key" unique (token),
  constraint "oauthAccessToken_clientId_fkey" foreign key ("clientId")
    references mcp_auth."oauthClient" ("clientId") on delete cascade,
  constraint "oauthAccessToken_sessionId_fkey" foreign key ("sessionId")
    references mcp_auth.session (id) on delete set null,
  constraint "oauthAccessToken_userId_fkey" foreign key ("userId")
    references mcp_auth."user" (id) on delete cascade,
  constraint "oauthAccessToken_refreshId_fkey" foreign key ("refreshId")
    references mcp_auth."oauthRefreshToken" (id) on delete cascade
);

create table if not exists mcp_auth."oauthConsent" (
  id text not null,
  "clientId" text not null,
  "userId" text,
  "referenceId" text,
  resources jsonb,
  "requestedUserInfoClaims" jsonb,
  scopes jsonb not null,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null,
  constraint "oauthConsent_pkey" primary key (id),
  constraint "oauthConsent_clientId_fkey" foreign key ("clientId")
    references mcp_auth."oauthClient" ("clientId") on delete cascade,
  constraint "oauthConsent_userId_fkey" foreign key ("userId")
    references mcp_auth."user" (id) on delete cascade
);

create table if not exists mcp_auth."oauthClientAssertion" (
  id text not null,
  "expiresAt" timestamptz not null,
  constraint "oauthClientAssertion_pkey" primary key (id)
);

-- ---------------------------------------------------------------------------
-- Index (mêmes noms que ceux générés par Better Auth)
-- ---------------------------------------------------------------------------

create index if not exists "session_userId_idx" on mcp_auth.session ("userId");
create index if not exists "account_userId_idx" on mcp_auth.account ("userId");
-- Un compte amont (sub Supabase) n'est lié qu'à un seul utilisateur AS : interdit
-- tout rattachement d'un même compte Toolzy à deux utilisateurs (ajout Toolzy,
-- absent du schéma généré par Better Auth).
create unique index if not exists "account_provider_account_uidx"
  on mcp_auth.account ("providerId", "accountId");
create index if not exists verification_identifier_idx on mcp_auth.verification (identifier);
create index if not exists "oauthClient_userId_idx" on mcp_auth."oauthClient" ("userId");
create index if not exists "oauthClientResource_clientId_idx"
  on mcp_auth."oauthClientResource" ("clientId");
create index if not exists "oauthClientResource_resourceId_idx"
  on mcp_auth."oauthClientResource" ("resourceId");
create unique index if not exists "oauthClientResource_clientId_resourceId_uidx"
  on mcp_auth."oauthClientResource" ("clientId", "resourceId");
create index if not exists "oauthRefreshToken_clientId_idx" on mcp_auth."oauthRefreshToken" ("clientId");
create index if not exists "oauthRefreshToken_sessionId_idx" on mcp_auth."oauthRefreshToken" ("sessionId");
create index if not exists "oauthRefreshToken_userId_idx" on mcp_auth."oauthRefreshToken" ("userId");
create index if not exists "oauthRefreshToken_authorizationCodeId_idx"
  on mcp_auth."oauthRefreshToken" ("authorizationCodeId");
create index if not exists "oauthAccessToken_clientId_idx" on mcp_auth."oauthAccessToken" ("clientId");
create index if not exists "oauthAccessToken_sessionId_idx" on mcp_auth."oauthAccessToken" ("sessionId");
create index if not exists "oauthAccessToken_userId_idx" on mcp_auth."oauthAccessToken" ("userId");
create index if not exists "oauthAccessToken_authorizationCodeId_idx"
  on mcp_auth."oauthAccessToken" ("authorizationCodeId");
create index if not exists "oauthAccessToken_refreshId_idx" on mcp_auth."oauthAccessToken" ("refreshId");
create index if not exists "oauthConsent_clientId_idx" on mcp_auth."oauthConsent" ("clientId");
create index if not exists "oauthConsent_userId_idx" on mcp_auth."oauthConsent" ("userId");

-- ---------------------------------------------------------------------------
-- Droits : rien pour l'API, le strict nécessaire pour le rôle du MCP
-- ---------------------------------------------------------------------------

revoke all on schema mcp_auth from public, anon, authenticated;
revoke all on all tables in schema mcp_auth from public, anon, authenticated;
revoke all on all sequences in schema mcp_auth from public, anon, authenticated;
revoke all on all functions in schema mcp_auth from public, anon, authenticated;

-- Pas de CREATE : le serveur ne fait jamais de DDL (les migrations passent ici).
grant usage on schema mcp_auth to toolzy_mcp_auth;
grant select, insert, update, delete on all tables in schema mcp_auth to toolzy_mcp_auth;
grant usage, select on all sequences in schema mcp_auth to toolzy_mcp_auth;
grant execute on all functions in schema mcp_auth to toolzy_mcp_auth;

-- Objets créés plus tard par postgres dans ce schéma (migrations suivantes).
alter default privileges for role postgres in schema mcp_auth
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema mcp_auth
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema mcp_auth
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema mcp_auth
  grant select, insert, update, delete on tables to toolzy_mcp_auth;
alter default privileges for role postgres in schema mcp_auth
  grant usage, select on sequences to toolzy_mcp_auth;
alter default privileges for role postgres in schema mcp_auth
  grant execute on functions to toolzy_mcp_auth;
