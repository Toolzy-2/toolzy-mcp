import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT, generateKeyPair, type JWTPayload } from "jose";
import { createTokenVerifier, InvalidTokenError } from "../verifyToken";

const ISSUER = "https://mcp.example.test/api/auth";
const AUDIENCE = "https://mcp.example.test/api/mcp";

type Keys = Awaited<ReturnType<typeof generateKeyPair>>;
let keys: Keys;
let autresCles: Keys;

beforeAll(async () => {
  keys = await generateKeyPair("EdDSA");
  autresCles = await generateKeyPair("EdDSA");
});

const signer = (payload: JWTPayload, options: { key?: Keys; exp?: string | null } = {}) => {
  const jwt = new SignJWT(payload).setProtectedHeader({ alg: "EdDSA", typ: "at+jwt" });
  if (options.exp !== null) jwt.setExpirationTime(options.exp ?? "5m");
  return jwt.sign((options.key ?? keys).privateKey);
};

const valide = (surcharge: JWTPayload = {}) => ({
  iss: ISSUER,
  aud: AUDIENCE,
  sub: "user-1",
  azp: "https://client.example/metadata.json",
  scope: "profile:read messages:read",
  ...surcharge,
});

const verifier = () =>
  createTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, getKey: async () => keys.publicKey });

describe("vérification du jeton MCP", () => {
  it("sans jeton : pas d'identité, pas d'erreur (outils anonymes)", async () => {
    expect(await verifier()(undefined)).toBeUndefined();
  });

  it("jeton valide : renvoie l'identité, le client et les scopes", async () => {
    const jeton = await signer(valide());
    const info = await verifier()(jeton);
    expect(info).toMatchObject({
      token: jeton,
      clientId: "https://client.example/metadata.json",
      scopes: ["profile:read", "messages:read"],
      extra: { userId: "user-1" },
    });
    expect(info?.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it("refuse un jeton émis pour une autre ressource (audience)", async () => {
    const jeton = await signer(valide({ aud: "authenticated" }));
    await expect(verifier()(jeton)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("refuse un jeton d'un autre émetteur", async () => {
    const jeton = await signer(valide({ iss: "https://autre.example/auth/v1" }));
    await expect(verifier()(jeton)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("refuse une signature d'une autre clé", async () => {
    const jeton = await signer(valide(), { key: autresCles });
    await expect(verifier()(jeton)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("refuse un jeton expiré", async () => {
    const jeton = await signer(valide(), { exp: "-1m" });
    await expect(verifier()(jeton)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("refuse un jeton sans expiration", async () => {
    const jeton = await signer(valide(), { exp: null });
    await expect(verifier()(jeton)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("refuse un jeton sans sujet", async () => {
    const jeton = await signer(valide({ sub: undefined }));
    await expect(verifier()(jeton)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("refuse une chaîne qui n'est pas un JWT, sans retomber en anonyme", async () => {
    await expect(verifier()("pas-un-jwt")).rejects.toBeInstanceOf(InvalidTokenError);
  });
});
