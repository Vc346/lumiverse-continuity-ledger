import { test, expect } from "bun:test";
import { DEFAULT_LEDGER_PROMPT, ledgerService, registerLedgerMacro } from "../src/ledger";

function fixture() {
  const storage = new Map();
  const chats = new Map();
  const characters = new Map();
  const presets = new Map();
  const messages = new Map();
  const calls = [];
  let activeChatId = null;
  let answer = "";

  const host = {
    chats: {
      get: async (id) => structuredClone(chats.get(id) ?? null),
      getActive: async () => (activeChatId ? structuredClone(chats.get(activeChatId) ?? null) : null),
    },
    chat: {
      getMessages: async (chatId) => structuredClone(messages.get(chatId) ?? []),
    },
    characters: {
      get: async (id) => structuredClone(characters.get(id) ?? null),
    },
    presets: {
      list: async () => {
        const data = [...presets.values()];
        return { data: structuredClone(data), total: data.length };
      },
      get: async (id) => structuredClone(presets.get(id) ?? null),
    },
    connections: {
      list: async () => [{ id: "conn-1", name: "Fast Model" }],
    },
    generate: {
      quiet: async (request) => {
        calls.push(request);
        return { content: answer };
      },
    },
    userStorage: {
      exists: async (path, user) => storage.has(user + ":" + path),
      getJson: async (path, { userId }) => structuredClone(storage.get(userId + ":" + path)),
      setJson: async (path, value, { userId }) => storage.set(userId + ":" + path, structuredClone(value)),
      move: async (from, to, user) => {
        storage.set(user + ":" + to, storage.get(user + ":" + from));
        storage.delete(user + ":" + from);
      },
    },
    registerMacro: (def) => {
      host._macro = def;
    },
    _macro: null,
  };

  return {
    host,
    chats,
    characters,
    presets,
    messages,
    calls,
    setActive: (id) => (activeChatId = id),
    respond: (text) => (answer = text),
  };
}

test("uses card Forge ledger_prompt, updates incrementally, supports undo, manual edit, and macro expansion", async () => {
  const f = fixture();
  registerLedgerMacro(f.host);
  const run = ledgerService(f.host);

  f.characters.set("card-1", {
    id: "card-1",
    name: "Asuka Saito",
    extensions: {
      voidverse_author: {
        ledger_prompt: "Track Asuka's NYC shoot schedule, promises, and secrets.",
      },
    },
  });
  f.chats.set("chat-1", { id: "chat-1", name: "NYC Shoot", character_id: "card-1" });
  f.setActive("chat-1");
  f.messages.set("chat-1", [
    { id: "m1", role: "user", name: "Alex", content: "Meet me after the shoot on Thursday." },
    { id: "m2", role: "assistant", name: "Asuka", content: "Fine. 7 PM in SoHo, don't be late." },
  ]);

  // Default skipRecent is 2, so the first exchange is held back for swiping/editing
  const held = await run("alice", { action: "load" });
  expect(held.promptSource).toBe("card");
  expect(held.pendingTurns).toBe(0);
  expect(held.heldBackTurns).toBe(2);
  await expect(run("alice", { action: "update", chatId: "chat-1" })).rejects.toThrow("Not enough settled messages");

  // Once a second exchange arrives, m1-m2 are settled and m3-m4 are held back
  f.messages.get("chat-1").push(
    { id: "m3", role: "user", name: "Alex", content: "I brought the spare key." },
    { id: "m4", role: "assistant", name: "Asuka", content: "She pockets the key without saying a word." },
  );
  const initial = await run("alice", { action: "load" });
  expect(initial.pendingTurns).toBe(2);
  expect(initial.heldBackTurns).toBe(2);
  expect(await f.host._macro.handler({ env: { extra: { chatId: "chat-1", userId: "alice" } } })).toBe("");

  f.respond("- Thursday 7 PM: Dinner with Alex in SoHo.");
  const first = await run("alice", { action: "update", chatId: "chat-1" });
  expect(first.ledger.content).toBe("- Thursday 7 PM: Dinner with Alex in SoHo.");
  expect(first.ledger.previousContent).toBeNull();
  expect(first.pendingTurns).toBe(0);
  expect(first.heldBackTurns).toBe(2);
  expect(f.calls[0].messages[0].content).toContain("Track Asuka's NYC shoot schedule");
  expect(f.calls[0].messages[1].content).toContain("Meet me after the shoot on Thursday.");
  expect(f.calls[0].messages[1].content).not.toContain("I brought the spare key.");
  expect(await f.host._macro.handler({ env: { extra: { chatId: "chat-1", userId: "alice" } } })).toBe(
    "- Thursday 7 PM: Dinner with Alex in SoHo.",
  );

  // Add a third exchange -> m3-m4 become settled and are processed incrementally
  f.messages.get("chat-1").push(
    { id: "m5", role: "user", name: "Alex", content: "See you tomorrow." },
    { id: "m6", role: "assistant", name: "Asuka", content: "Don't forget your coat." },
  );
  f.respond("- Thursday 7 PM: Dinner with Alex in SoHo.\n- Asuka holds the spare key.");
  const second = await run("alice", { action: "update", chatId: "chat-1" });
  expect(second.ledger.previousContent).toBe("- Thursday 7 PM: Dinner with Alex in SoHo.");
  expect(f.calls[1].messages[1].content).toContain("I brought the spare key.");
  expect(f.calls[1].messages[1].content).not.toContain("Meet me after the shoot on Thursday.");
  expect(f.calls[1].messages[1].content).not.toContain("See you tomorrow.");

  // Undo restores previousContent and makes undo reversible
  const undone = await run("alice", { action: "undo", chatId: "chat-1" });
  expect(undone.ledger.content).toBe("- Thursday 7 PM: Dinner with Alex in SoHo.");
  expect(undone.ledger.previousContent).toBe("- Thursday 7 PM: Dinner with Alex in SoHo.\n- Asuka holds the spare key.");

  // Manual edit saves and updates previousContent
  const edited = await run("alice", {
    action: "save_edit",
    chatId: "chat-1",
    content: "- Pinned manually: Asuka has the key.",
  });
  expect(edited.ledger.content).toBe("- Pinned manually: Asuka has the key.");
  expect(edited.ledger.source).toBe("edit");
});

test("auto-update triggers only when enabled and interval of assistant replies is reached", async () => {
  const f = fixture();
  const run = ledgerService(f.host);

  f.chats.set("chat-2", { id: "chat-2", name: "Harbor", character_id: "card-none" });
  f.messages.set("chat-2", [
    { id: "m1", role: "user", content: "Turn 1" },
    { id: "m2", role: "assistant", content: "Reply 1" },
  ]);

  // Disabled by default
  expect((await run("alice", { action: "maybe_auto_update", chatId: "chat-2" })).updated).toBe(false);

  // Enable auto-update every 2 assistant replies with skipRecent = 0
  await run("alice", {
    action: "save_settings",
    chatId: "chat-2",
    autoUpdate: true,
    interval: 2,
    skipRecent: 0,
    connectionId: "conn-1",
    fallbackPrompt: "",
  });

  // Only 1 assistant reply so far -> does not run
  const notYet = await run("alice", { action: "maybe_auto_update", chatId: "chat-2" });
  expect(notYet.updated).toBe(false);
  expect(notYet.pendingAssistantTurns).toBe(1);

  // Add second assistant reply -> triggers auto-update using default prompt and conn-1
  f.messages.get("chat-2").push(
    { id: "m3", role: "user", content: "Turn 2" },
    { id: "m4", role: "assistant", content: "Reply 2" },
  );
  f.respond("<think>Internal notes</think>\n- Tide is rising.");
  const triggered = await run("alice", { action: "maybe_auto_update", chatId: "chat-2" });
  expect(triggered.updated).toBe(true);
  expect(triggered.ledger.content).toBe("- Tide is rising.");
  expect(triggered.ledger.source).toBe("auto");
  expect(f.calls[0].connection_id).toBe("conn-1");
  expect(f.calls[0].messages[0].content).toContain(DEFAULT_LEDGER_PROMPT);
});

test("lists preset blocks and injects selected blocks when updating the ledger", async () => {
  const f = fixture();
  const run = ledgerService(f.host);

  f.presets.set("preset-1", {
    id: "preset-1",
    name: "Creative Preset",
    prompt_order: [
      { identifier: "framing", name: "Fiction Framing", role: "system", enabled: true, content: "Keep notes strictly factual." },
      { identifier: "hist", name: "Chat History", marker: true, enabled: true, content: "" },
      { identifier: "extra", name: "Format Hint", role: "user", enabled: false, content: "Use concise bullet points." },
    ],
  });
  f.chats.set("chat-3", { id: "chat-3", name: "Scene" });
  f.messages.set("chat-3", [
    { id: "m1", role: "user", content: "We agreed to meet at dawn." },
    { id: "m2", role: "assistant", content: "She nods and pockets the letter." },
  ]);

  const blocks = await run("alice", { action: "preset_blocks", presetId: "preset-1" });
  expect(blocks.blocks).toEqual([
    { id: "framing", name: "Fiction Framing", role: "system", enabled: true },
    { id: "extra", name: "Format Hint", role: "user", enabled: false },
  ]);

  await run("alice", {
    action: "save_settings",
    chatId: "chat-3",
    autoUpdate: false,
    interval: 6,
    skipRecent: 0,
    presetId: "preset-1",
    presetBlockIds: ["framing", "extra"],
    fallbackPrompt: "",
  });

  f.respond("- Meeting planned at dawn.\n- She holds the letter.");
  await run("alice", { action: "update", chatId: "chat-3" });
  const sent = f.calls.at(-1).messages;
  expect(sent[0].role).toBe("system");
  expect(sent[0].content).toContain("Keep notes strictly factual.");
  expect(sent[0].content).toContain(DEFAULT_LEDGER_PROMPT);
  expect(sent[1]).toEqual({ role: "user", content: "Use concise bullet points." });
  expect(sent[2].role).toBe("user");
});

test("forgeLedger resolves when env.extra omits chatId by falling back to active chat or characterId", async () => {
  const f = fixture();
  registerLedgerMacro(f.host);
  const run = ledgerService(f.host);

  f.chats.set("chat-a", { id: "chat-a", name: "Chat A", character_id: "char-a" });
  f.setActive("chat-a");
  await run("alice", { action: "save_edit", chatId: "chat-a", content: "- Active chat fact." });

  // Case 1: env.extra has only characterId + userId, chats.getActive returns active chat
  expect(
    await f.host._macro.handler({ env: { extra: { characterId: "char-a", userId: "alice" } } }),
  ).toBe("- Active chat fact.");

  // Case 2: chats.getActive is unavailable, falls back to lastActiveChatId / characterId match
  f.setActive(null);
  expect(
    await f.host._macro.handler({ env: { extra: { characterId: "char-a", userId: "alice" } } }),
  ).toBe("- Active chat fact.");

  // Case 3: env.chat.id is provided directly
  expect(
    await f.host._macro.handler({ env: { chat: { id: "chat-a" }, extra: { userId: "alice" } } }),
  ).toBe("- Active chat fact.");
});
