import { describe, it, expect } from "vitest";
import { isAllowedClientMetadataUrl, parseAllowedHosts } from "../clientAllowlist";

const HOSTS = parseAllowedHosts("claude.ai, chatgpt.com");

describe("liste blanche des clients CIMD", () => {
  it("lit une liste séparée par des virgules, sans espaces ni doublons de casse", () => {
    expect(parseAllowedHosts(" Claude.ai ,chatgpt.com,, ")).toEqual(["claude.ai", "chatgpt.com"]);
    expect(parseAllowedHosts(undefined)).toEqual([]);
  });

  it("accepte le document de métadonnées d'un hôte autorisé", () => {
    expect(isAllowedClientMetadataUrl("https://claude.ai/oauth/claude-code-client-metadata", HOSTS)).toBe(true);
    expect(isAllowedClientMetadataUrl("https://chatgpt.com/oauth/client.json", HOSTS)).toBe(true);
  });

  it("refuse un hôte inconnu", () => {
    expect(isAllowedClientMetadataUrl("https://evil.example/client.json", HOSTS)).toBe(false);
  });

  it("refuse un sous-domaine ou un suffixe trompeur", () => {
    expect(isAllowedClientMetadataUrl("https://claude.ai.evil.example/c.json", HOSTS)).toBe(false);
    expect(isAllowedClientMetadataUrl("https://notclaude.ai/c.json", HOSTS)).toBe(false);
    expect(isAllowedClientMetadataUrl("https://x.claude.ai/c.json", HOSTS)).toBe(false);
  });

  it("refuse tout ce qui n'est pas du HTTPS sur le port par défaut", () => {
    expect(isAllowedClientMetadataUrl("http://claude.ai/c.json", HOSTS)).toBe(false);
    expect(isAllowedClientMetadataUrl("https://claude.ai:8443/c.json", HOSTS)).toBe(false);
    expect(isAllowedClientMetadataUrl("https://user@claude.ai/c.json", HOSTS)).toBe(false);
  });

  it("refuse une URL illisible et refuse tout quand la liste est vide", () => {
    expect(isAllowedClientMetadataUrl("pas une url", HOSTS)).toBe(false);
    expect(isAllowedClientMetadataUrl("https://claude.ai/c.json", [])).toBe(false);
  });
});
