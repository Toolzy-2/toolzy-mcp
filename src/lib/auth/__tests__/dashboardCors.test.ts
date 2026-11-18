import { describe, expect, it } from "vitest";
import { corsHeadersFor, parseDashboardOrigins } from "../dashboardCors";

const ALLOWED = ["https://www.toolzy.io", "https://toolzy.io"];

describe("parseDashboardOrigins", () => {
  it("prend les origines toolzy.io par défaut", () => {
    expect(parseDashboardOrigins(undefined)).toEqual(ALLOWED);
    expect(parseDashboardOrigins("  ")).toEqual(ALLOWED);
  });

  it("lit une liste séparée par des virgules et normalise les origines", () => {
    expect(parseDashboardOrigins(" https://preprod.toolzy.io/ ,http://localhost:3000")).toEqual([
      "https://preprod.toolzy.io",
      "http://localhost:3000",
    ]);
  });

  it("ignore les entrées qui ne sont pas des origines", () => {
    expect(parseDashboardOrigins("pas une url,https://toolzy.io,*,https://x.io/chemin")).toEqual([
      "https://toolzy.io",
    ]);
  });
});

describe("corsHeadersFor", () => {
  it("autorise une origine connue, sans credentials", () => {
    const headers = corsHeadersFor("https://www.toolzy.io", ALLOWED);
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://www.toolzy.io");
    expect(headers["Access-Control-Allow-Methods"]).toBe("GET, DELETE, OPTIONS");
    expect(headers["Access-Control-Allow-Headers"]).toBe("Authorization");
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
    expect(headers.Vary).toBe("Origin");
  });

  it("n'envoie aucun en-tête d'autorisation CORS pour une origine inconnue ou absente", () => {
    expect(corsHeadersFor("https://evil.example", ALLOWED)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeadersFor("https://toolzy.io.evil.example", ALLOWED)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeadersFor(null, ALLOWED)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeadersFor("null", ALLOWED)["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
