import { describe, expect, it } from "vitest";
import { toConversationView, toMessageView, type ConversationRow, type MessageRow } from "../my-messages";

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

const message = (overrides: Partial<MessageRow> = {}): MessageRow => ({
  id: "m-1",
  conversation_id: "c-1",
  sender_id: OTHER,
  content: "Bonjour, l'outil est dispo samedi ?",
  read: false,
  is_visible: true,
  created_at: "2026-11-18T09:00:00Z",
  ...overrides,
});

describe("toMessageView", () => {
  it("nomme l'expéditeur par son prénom", () => {
    expect(toMessageView(message(), ME, new Map([[OTHER, "Olivier"]]))).toEqual({
      from: "Olivier",
      from_me: false,
      text: "Bonjour, l'outil est dispo samedi ?",
      sent_at: "2026-11-18T09:00:00Z",
      read: false,
    });
  });

  it("signale mes messages encore masqués par la modération sans en montrer le texte brut", () => {
    const view = toMessageView(message({ sender_id: ME, is_visible: false, content: "texte" }), ME, new Map());

    expect(view.from).toBe("moi");
    expect(view.from_me).toBe(true);
    expect(view.text).toBe("texte");
    expect(view.hidden_by_moderation).toBe(true);
  });

  it("reste lisible si l'expéditeur a supprimé son compte", () => {
    expect(toMessageView(message({ sender_id: null }), ME, new Map()).from).toBe("compte supprimé");
  });
});

describe("toConversationView", () => {
  const conversation: ConversationRow = {
    id: "c-1",
    participants: [ME, OTHER],
    last_message_at: "2026-11-18T09:00:00Z",
    tools: { name: "Perceuse", slug: "perceuse-bosch" },
  };

  it("résume une conversation avec son dernier message et ses non-lus", () => {
    const view = toConversationView(conversation, ME, new Map([[OTHER, "Olivier"]]), message(), 2);

    expect(view).toEqual({
      conversation_id: "c-1",
      with: "Olivier",
      tool: "Perceuse",
      last_message_at: "2026-11-18T09:00:00Z",
      unread_count: 2,
      last_message: { from: "Olivier", from_me: false, text: "Bonjour, l'outil est dispo samedi ?", sent_at: "2026-11-18T09:00:00Z", read: false },
    });
  });

  it("tolère une conversation sans message ni annonce", () => {
    const view = toConversationView({ ...conversation, tools: null }, ME, new Map(), undefined, 0);

    expect(view.with).toBe("un utilisateur Toolzy");
    expect(view.tool).toBeNull();
    expect(view.last_message).toBeNull();
  });
});
