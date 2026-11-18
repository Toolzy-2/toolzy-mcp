import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapSupabaseProfile, technicalEmailFor } from "../upstreamProfile";

const SUB_X = "11111111-1111-1111-1111-111111111111";
const SUB_Y = "22222222-2222-2222-2222-222222222222";

describe("identité de l'utilisateur côté serveur d'autorisation", () => {
  it("dérive l'e-mail technique du sub Supabase, pas de l'e-mail réel", () => {
    const profile = mapSupabaseProfile({ sub: SUB_X, email: "e@x.fr", email_verified: true });

    expect(profile).toEqual({
      id: SUB_X,
      email: technicalEmailFor(SUB_X),
      emailVerified: true,
      name: "e@x.fr",
    });
  });

  // Scénario de la revue : X change d'e-mail, Y reprend l'ancien. Avec l'e-mail
  // réel comme identité, Better Auth rattacherait Y au compte AS de X.
  it("deux comptes Toolzy partageant (successivement) un e-mail restent deux identités", () => {
    const x = mapSupabaseProfile({ sub: SUB_X, email: "e@x.fr", email_verified: true });
    const y = mapSupabaseProfile({ sub: SUB_Y, email: "e@x.fr", email_verified: true });

    expect(x?.email).not.toBe(y?.email);
  });

  it("produit une adresse acceptée par un validateur d'e-mail", () => {
    expect(() => z.email().parse(technicalEmailFor(SUB_X))).not.toThrow();
  });

  it("refuse un profil sans sub UUID", () => {
    expect(mapSupabaseProfile({ email: "e@x.fr" })).toBeNull();
    expect(mapSupabaseProfile({ sub: "pas-un-uuid", email: "e@x.fr" })).toBeNull();
    expect(mapSupabaseProfile(null)).toBeNull();
  });

  it("garde un nom lisible même sans e-mail réel", () => {
    expect(mapSupabaseProfile({ sub: SUB_X })?.name).toBe("Compte Toolzy");
  });
});
