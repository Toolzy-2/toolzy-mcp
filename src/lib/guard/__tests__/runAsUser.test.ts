import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createFakePool } from "./fakePool";

const SECRET_TEXT = "Rendez-vous chez moi au 12 rue Secrète, code 4321";

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./fakePool").createFakePool> }));

vi.mock("../../db/pool", () => ({
  getPool: () => {
    if (!state.fake) throw new Error("pool non initialisé");
    return state.fake.pool;
  },
}));

vi.mock("../../auth/userSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../auth/userSession")>()),
  openUserSession: vi.fn(async () => ({ userId: "toolzy-u1", email: null, profile: {}, db: {} })),
}));

vi.mock("../../../tools/send-message", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../tools/send-message")>()),
  sendMessage: vi.fn(async () => ({ sent: true })),
}));

const { openUserSession, AccountNotAllowedError } = await import("../../auth/userSession");
const { sendMessage, InvalidMessageError } = await import("../../../tools/send-message");
const { registerAuthenticatedTools } = await import("../../registerAuthenticated");

type Result = { isError?: boolean; content: Array<{ text: string }> };
type Handler = (args: unknown, extra: { authInfo?: unknown }) => Promise<Result>;

const handlers = new Map<string, Handler>();
registerAuthenticatedTools({
  registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler),
} as unknown as McpServer);

const AUTH = { token: "jeton-ne-doit-pas-fuiter", clientId: "https://claude.ai/oauth/client", scopes: [], extra: { userId: "as-u1" } };
const CONVERSATION = "8b0d0a1e-7d3c-4c0e-9a51-0b6f7a2c1d11";
const send = () =>
  handlers.get("send_message")!({ conversation_id: CONVERSATION, text: SECRET_TEXT }, { authInfo: AUTH });

beforeEach(() => {
  state.fake = createFakePool();
  vi.mocked(openUserSession).mockClear();
  vi.mocked(sendMessage).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const lastAudit = () => state.fake!.auditRows().at(-1)!.values;

describe("runAsUser : limite et audit", () => {
  it("appel réussi : session ouverte, audit 'ok' avec utilisateur, client et outil", async () => {
    const result = await send();
    expect(result.isError).toBeUndefined();
    expect(openUserSession).toHaveBeenCalledTimes(1);
    expect(lastAudit().slice(0, 4)).toEqual(["as-u1", AUTH.clientId, "send_message", "ok"]);
  });

  it("vérifie la limite AVANT d'ouvrir la session", async () => {
    await send();
    const texts = state.fake!.queries.map((q) => q.text);
    expect(texts.findIndex((t) => t.includes("mcp_rate_counters"))).toBe(0);
  });

  it("outil refusé par la limite : la session n'est jamais ouverte, audit 'rate_limited'", async () => {
    for (let i = 0; i < 20; i += 1) await send();
    vi.mocked(openUserSession).mockClear();
    const result = await send();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Réessayez dans/);
    expect(openUserSession).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(20);
    expect(lastAudit()[3]).toBe("rate_limited");
  });

  it("base de limite indisponible : écriture refusée sans ouvrir la session", async () => {
    state.fake = createFakePool({ failOn: "mcp_rate_counters" });
    const result = await send();
    expect(result.isError).toBe(true);
    expect(openUserSession).not.toHaveBeenCalled();
  });

  it("base de limite indisponible : la lecture passe quand même", async () => {
    state.fake = createFakePool({ failOn: "mcp_rate_counters" });
    await handlers.get("list_my_listings")!({}, { authInfo: AUTH });
    expect(openUserSession).toHaveBeenCalledTimes(1);
  });

  it("erreur d'outil : audit 'error' avec le nom de la classe", async () => {
    vi.mocked(sendMessage).mockRejectedValueOnce(new InvalidMessageError(SECRET_TEXT));
    const result = await send();
    expect(result.isError).toBe(true);
    expect(lastAudit()[3]).toBe("error");
    expect(lastAudit()[5]).toBe("InvalidMessageError");
  });

  it("compte exclu : audit 'denied'", async () => {
    vi.mocked(openUserSession).mockRejectedValueOnce(new AccountNotAllowedError("mairie"));
    await send();
    expect(lastAudit()[3]).toBe("denied");
  });

  it("le journal n'échoue pas la réponse s'il ne peut pas être écrit", async () => {
    state.fake = createFakePool({ failOn: "mcp_audit_log" });
    const result = await send();
    expect(result.isError).toBeUndefined();
  });

  it("aucun champ du journal ne contient le texte du message, ses arguments ni le jeton", async () => {
    await send();
    vi.mocked(sendMessage).mockRejectedValueOnce(new InvalidMessageError(SECRET_TEXT));
    await send();
    for (const row of state.fake!.auditRows()) {
      expect(row.values).toHaveLength(6);
      for (const value of row.values) {
        const text = String(value);
        expect(text).not.toContain("Secrète");
        expect(text).not.toContain(CONVERSATION);
        expect(text).not.toContain(AUTH.token);
      }
    }
  });
});
