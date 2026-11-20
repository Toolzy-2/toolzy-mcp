import { describe, expect, it, vi } from "vitest";
import { createFakePool } from "../../guard/__tests__/fakePool";
import { MCP_ENDPOINT, resultCountOf, withPublicCallLog } from "../publicCallLog";
import { requestMetaOf, runWithRequestMeta } from "../requestMeta";

const text = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const logRows = (queries: ReadonlyArray<{ text: string; values: readonly unknown[] }>) =>
  queries.filter((q) => q.text.includes("public.mcp_logs"));

describe("resultCountOf", () => {
  it("compte les annonces trouvées, comme l'ancien serveur", () => {
    expect(resultCountOf("search_tools", text({ results: [{}, {}, {}] }))).toBe(3);
    expect(resultCountOf("search_tools", { content: [{ type: "text", text: "Aucun outil trouvé." }] })).toBe(0);
    expect(resultCountOf("get_tool_details", text({ id: "x" }))).toBe(1);
    expect(resultCountOf("check_availability", text({ available: true }))).toBe(1);
    expect(resultCountOf("check_availability", text({ available: false }))).toBe(0);
  });

  it("vaut 0 pour une erreur", () => {
    expect(resultCountOf("search_tools", { content: [{ type: "text", text: "boom" }], isError: true })).toBe(0);
  });
});

describe("withPublicCallLog", () => {
  it("écrit l'appel dans mcp_logs avec l'endpoint, l'IP et le client de la requête", async () => {
    const { pool, queries } = createFakePool();
    const handler = withPublicCallLog("search_tools", pool, async () => text({ results: [{}] }));
    const meta = requestMetaOf(
      new Headers({ "x-real-ip": "203.0.113.7", "user-agent": "openai-mcp/1.0.0", origin: "https://chatgpt.com" }),
    );

    await runWithRequestMeta(meta, () => handler({ query: "perceuse", city: "Bordeaux" }));
    await flush();

    const [row] = logRows(queries);
    expect(row.values).toEqual([
      "search_tools",
      JSON.stringify({ query: "perceuse", city: "Bordeaux" }),
      1,
      expect.any(Number),
      "203.0.113.7",
      "openai-mcp/1.0.0",
      "https://chatgpt.com",
      null,
      MCP_ENDPOINT,
    ]);
  });

  it("note le message d'erreur renvoyé par l'outil", async () => {
    const { pool, queries } = createFakePool();
    const handler = withPublicCallLog("get_tool_details", pool, async () => ({
      content: [{ type: "text", text: "Outil non trouvé." }],
      isError: true,
    }));
    await handler({ tool_url: "x" });
    await flush();
    expect(logRows(queries)[0].values[7]).toBe("Outil non trouvé.");
  });

  it("ne change jamais la réponse si l'écriture échoue", async () => {
    const { pool } = createFakePool({ failOn: "mcp_logs" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withPublicCallLog("search_tools", pool, async () => text({ results: [] }));
    await expect(handler({})).resolves.toEqual(text({ results: [] }));
    await flush();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("journalise puis relance une exception de l'outil", async () => {
    const { pool, queries } = createFakePool();
    const handler = withPublicCallLog("check_availability", pool, async () => {
      throw new Error("panne");
    });
    await expect(handler({})).rejects.toThrow("panne");
    await flush();
    expect(logRows(queries)[0].values[7]).toBe("Error: panne");
  });
});
