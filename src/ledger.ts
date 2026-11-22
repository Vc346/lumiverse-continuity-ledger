const NS = "voidverse_ledger";
const FORGE_NS = "voidverse_author";
const FILE = "ledgers.json";
const MAX_TRANSCRIPT_CHARS = 120_000;
const MAX_REBUILD_MESSAGES = 80;
const FALLBACK_WINDOW_MESSAGES = 24;

export const DEFAULT_LEDGER_PROMPT = `Maintain a compact, factual continuity ledger for this roleplay.
Record only lasting state that matters in future scenes:
- Current timeline / day and upcoming commitments or schedules
- Relationships, trust shifts, and unresolved tensions
- Secrets and knowledge boundaries (who knows what, and who does NOT know)
- Promises, deals, injuries, and notable items or holdings
- Key established facts that could be contradicted later

Update the existing ledger in place: keep still-true facts, update changed facts, and remove or mark resolved items. Do not write prose recaps or repeat scene-by-scene narration. Output only the updated Markdown ledger.`;

const DEFAULT_SETTINGS = {
  autoUpdate: false,
  interval: 6,
  skipRecent: 2,
  connectionId: "",
  presetId: "",
  presetBlockIds: [],
  fallbackPrompt: "",
};

function check(ok, message) {
  if (!ok) throw new Error(message);
}

function string(value, label, max = 100_000) {
  check(typeof value === "string" && value.length <= max, "Invalid " + label + ".");
  return value;
}

function presetBlocksOf(record) {
  if (!Array.isArray(record?.prompt_order)) return [];
  const blocks = [];
  record.prompt_order.forEach((b, index) => {
    if (!b || b.marker || typeof b.content !== "string" || !b.content.trim()) return;
    const id = String(b.identifier ?? b.id ?? ((b.name || "block") + "#" + index));
    blocks.push({
      id,
      name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : "Block " + (index + 1),
      role: b.role === "user" || b.role === "assistant" ? b.role : "system",
      enabled: b.enabled !== false,
      content: b.content.trim(),
    });
  });
  return blocks;
}

async function pages(fetchPage) {
  const result = [];
  while (true) {
    const { data, total } = await fetchPage(result.length);
    result.push(...data);
    if (!data.length || result.length >= total) return result;
  }
}

function normalizeSettings(raw) {
  const interval = Number(raw?.interval);
  const skipRecent = raw?.skipRecent === undefined || raw?.skipRecent === "" ? DEFAULT_SETTINGS.skipRecent : Number(raw.skipRecent);
  const presetId = typeof raw?.presetId === "string" ? raw.presetId : "";
  const presetBlockIds = presetId && Array.isArray(raw?.presetBlockIds)
    ? raw.presetBlockIds.filter((id) => typeof id === "string" && id)
    : [];
  return {
    autoUpdate: Boolean(raw?.autoUpdate),
    interval: Number.isFinite(interval) ? Math.max(1, Math.min(50, Math.round(interval))) : DEFAULT_SETTINGS.interval,
    skipRecent: Number.isFinite(skipRecent) ? Math.max(0, Math.min(20, Math.round(skipRecent))) : DEFAULT_SETTINGS.skipRecent,
    connectionId: typeof raw?.connectionId === "string" ? raw.connectionId : "",
    presetId,
    presetBlockIds,
    fallbackPrompt: typeof raw?.fallbackPrompt === "string" ? raw.fallbackPrompt : "",
  };
}

function normalizeMessage(raw) {
  if (!raw || raw.hidden || raw.is_hidden || raw.is_system) return null;
  let content = "";
  if (Array.isArray(raw.swipes) && typeof raw.swipe_id === "number" && typeof raw.swipes[raw.swipe_id] === "string") {
    content = raw.swipes[raw.swipe_id];
  } else if (typeof raw.content === "string") {
    content = raw.content;
  } else if (typeof raw.mes === "string") {
    content = raw.mes;
  }
  content = content.trim();
  if (!content) return null;
  const role =
    raw.role === "user" || raw.role === "assistant"
      ? raw.role
      : raw.is_user
        ? "user"
        : "assistant";
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : role === "user" ? "User" : "Character";
  return {
    id: raw.id != null ? String(raw.id) : null,
    role,
    name,
    content,
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function readState(storage, userId) {
  if (!(await storage.exists(FILE, userId))) {
    return { settings: { ...DEFAULT_SETTINGS }, ledgers: {}, lastActiveChatId: null };
  }
  const saved = await storage.getJson(FILE, { userId });
  return {
    settings: normalizeSettings(saved?.settings),
    ledgers: saved?.ledgers && typeof saved.ledgers === "object" ? saved.ledgers : {},
    lastActiveChatId: typeof saved?.lastActiveChatId === "string" ? saved.lastActiveChatId : null,
  };
}

async function writeState(storage, userId, state) {
  await storage.setJson(FILE + ".tmp", state, { userId });
  await storage.move(FILE + ".tmp", FILE, userId);
}

async function fetchMessages(host, chatId, userId) {
  check(host.chat?.getMessages, "Lumiverse's Chat Mutation API is unavailable. Grant chat_mutation permission.");
  let raw;
  try {
    raw = await host.chat.getMessages(chatId, { userId });
  } catch (error) {
    if (String(error?.message).includes("PERMISSION_DENIED")) throw error;
    raw = await host.chat.getMessages(chatId);
  }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.messages) ? raw.messages : [];
  return list.map(normalizeMessage).filter(Boolean);
}

function eligibleMessages(messages, skipRecent) {
  if (!skipRecent || skipRecent <= 0) return messages;
  return skipRecent >= messages.length ? [] : messages.slice(0, messages.length - skipRecent);
}

function selectNewMessages(messages, record, rebuild) {
  if (rebuild || !record?.content) {
    return messages.slice(-MAX_REBUILD_MESSAGES);
  }
  if (record.lastMessageId) {
    const index = messages.findIndex((msg) => msg.id === record.lastMessageId);
    if (index >= 0) return messages.slice(index + 1);
  }
  if (typeof record.lastMessageCount === "number" && record.lastMessageCount > 0 && record.lastMessageCount <= messages.length) {
    return messages.slice(record.lastMessageCount);
  }
  return messages.slice(-FALLBACK_WINDOW_MESSAGES);
}

function formatTranscript(messages) {
  const lines = messages.map((m) => `${m.name} (${m.role}):\n${m.content}`);
  let result = lines.join("\n\n---\n\n");
  if (result.length > MAX_TRANSCRIPT_CHARS) {
    result = result.slice(result.length - MAX_TRANSCRIPT_CHARS);
  }
  return result;
}

function stripReasoning(content) {
  return content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "").trim();
}

export function registerLedgerMacro(host) {
  host.registerMacro({
    name: "forgeLedger",
    category: "extension:" + NS,
    description: "Current continuity ledger for the active roleplay chat.",
    returnType: "string",
    volatile: true,
    async handler(ctx) {
      const env = ctx?.env ?? {};
      const extra = env.extra ?? {};
      const userId = firstString(extra.userId, extra.user_id, env.userId, env.user?.id, ctx?.userId);
      if (!userId) return "";

      const characterId = firstString(
        extra.characterId,
        extra.character_id,
        env.characterId,
        env.character?.id,
        ctx?.characterId,
      );
      let chatId = firstString(
        extra.chatId,
        extra.chat_id,
        env.chatId,
        env.chat_id,
        env.chat?.id,
        ctx?.chatId,
      );
      if (!chatId && host.chats?.getActive) {
        try {
          let active = null;
          try {
            active = await host.chats.getActive(userId);
          } catch {
            active = await host.chats.getActive();
          }
          chatId = firstString(active?.id);
        } catch {}
      }

      const state = await readState(host.userStorage, userId);
      if (!chatId) {
        const last = state.lastActiveChatId ? state.ledgers[state.lastActiveChatId] : null;
        if (last && (!characterId || !last.characterId || last.characterId === characterId)) {
          chatId = state.lastActiveChatId;
        } else if (characterId) {
          const matching = Object.values(state.ledgers)
            .filter((item) => item?.characterId === characterId && typeof item.content === "string" && item.content.trim())
            .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
          chatId = matching[0]?.chatId ?? null;
        }
      }
      if (!chatId) return "";
      const content = state.ledgers[chatId]?.content;
      return typeof content === "string" ? content.trim() : "";
    },
  });
}

export function ledgerService(host) {
  const locks = new Map();

  async function resolvePrompt(chat, settings, userId) {
    if (chat?.character_id && host.characters?.get) {
      try {
        const card = await host.characters.get(chat.character_id, userId);
        const cardPrompt = card?.extensions?.[FORGE_NS]?.ledger_prompt;
        if (typeof cardPrompt === "string" && cardPrompt.trim()) {
          return { prompt: cardPrompt.trim(), source: "card", cardName: card.name ?? "" };
        }
        if (card?.name) {
          if (settings.fallbackPrompt.trim()) {
            return { prompt: settings.fallbackPrompt.trim(), source: "fallback", cardName: card.name };
          }
          return { prompt: DEFAULT_LEDGER_PROMPT, source: "default", cardName: card.name };
        }
      } catch {}
    }
    if (settings.fallbackPrompt.trim()) {
      return { prompt: settings.fallbackPrompt.trim(), source: "fallback", cardName: "" };
    }
    return { prompt: DEFAULT_LEDGER_PROMPT, source: "default", cardName: "" };
  }

  async function resolveChat(chatId, userId) {
    if (typeof chatId === "string" && chatId) {
      return (await host.chats?.get?.(chatId, userId)) ?? { id: chatId };
    }
    if (host.chats?.getActive) {
      try {
        return (await host.chats.getActive(userId)) ?? null;
      } catch {
        return (await host.chats.getActive()) ?? null;
      }
    }
    return null;
  }

  async function listConnections(userId) {
    if (!host.connections?.list) return [];
    const rows = await host.connections.list(userId);
    return (rows ?? []).map(({ id, name }) => ({ id, name }));
  }

  async function listPresets(userId) {
    if (!host.presets?.list) return [];
    try {
      const rows = await pages((offset) => host.presets.list({ offset, limit: 100, userId }));
      return rows.map(({ id, name }) => ({ id, name }));
    } catch (error) {
      if (String(error?.message).includes("PERMISSION_DENIED")) return [];
      throw error;
    }
  }

  async function resolvePresetExtras(settings, userId) {
    if (!settings.presetId || !settings.presetBlockIds.length || !host.presets?.get) {
      return { systemExtras: [], extraMessages: [] };
    }
    try {
      const record = await host.presets.get(settings.presetId, userId);
      const wanted = new Set(settings.presetBlockIds);
      const chosen = presetBlocksOf(record).filter((b) => wanted.has(b.id));
      return {
        systemExtras: chosen.filter((b) => b.role === "system").map((b) => b.content),
        extraMessages: chosen
          .filter((b) => b.role !== "system")
          .map(({ role, content }) => ({ role, content })),
      };
    } catch (error) {
      if (String(error?.message).includes("PERMISSION_DENIED")) return { systemExtras: [], extraMessages: [] };
      throw error;
    }
  }

  async function buildStatus(state, chatId, userId) {
    const [chat, connections, presets] = await Promise.all([
      resolveChat(chatId, userId),
      listConnections(userId),
      listPresets(userId),
    ]);
    if (!chat?.id) {
      return {
        chat: null,
        ledger: null,
        promptSource: state.settings.fallbackPrompt.trim() ? "fallback" : "default",
        pendingTurns: 0,
        pendingAssistantTurns: 0,
        heldBackTurns: 0,
        settings: state.settings,
        connections,
        presets,
      };
    }
    const record = state.ledgers[chat.id] ?? null;
    const { source, cardName } = await resolvePrompt(chat, state.settings, userId);
    let pendingTurns = 0;
    let pendingAssistantTurns = 0;
    let heldBackTurns = 0;
    try {
      const messages = await fetchMessages(host, chat.id, userId);
      const eligible = eligibleMessages(messages, state.settings.skipRecent);
      heldBackTurns = messages.length - eligible.length;
      const fresh = selectNewMessages(eligible, record, false);
      pendingTurns = fresh.length;
      pendingAssistantTurns = fresh.filter((m) => m.role === "assistant").length;
    } catch {}
    return {
      chat: {
        id: chat.id,
        name: chat.name || cardName || "Active chat",
        cardName,
      },
      ledger: record,
      promptSource: source,
      pendingTurns,
      pendingAssistantTurns,
      heldBackTurns,
      settings: state.settings,
      connections,
      presets,
    };
  }

  async function runUpdate(state, chatId, userId, { rebuild = false, source = "manual" } = {}) {
    const chat = await resolveChat(chatId, userId);
    check(chat?.id, "Open a roleplay chat to update its ledger.");
    const messages = await fetchMessages(host, chat.id, userId);
    check(messages.length > 0, "This chat has no messages yet.");

    const eligible = eligibleMessages(messages, state.settings.skipRecent);
    check(
      eligible.length > 0,
      "Not enough settled messages yet (skipping the latest " + state.settings.skipRecent + ").",
    );

    const existing = state.ledgers[chat.id] ?? null;
    const fresh = selectNewMessages(eligible, existing, rebuild);
    check(fresh.length > 0, "The ledger is already up to date with settled messages.");

    const { prompt } = await resolvePrompt(chat, state.settings, userId);
    const { systemExtras, extraMessages } = await resolvePresetExtras(state.settings, userId);
    const existingText = !rebuild && existing?.content?.trim() ? existing.content.trim() : "(empty — initial pass)";
    const transcript = formatTranscript(fresh);

    const baseSystemMessage = [
      prompt,
      "",
      "Rules:",
      "- Return ONLY the updated continuity ledger in clean Markdown (no preamble or conversational filler).",
      "- Preserve still-valid facts from the existing ledger, update facts that changed, and remove or mark resolved items.",
      "- Keep entries concise and scannable.",
    ].join("\n");
    const systemMessage = systemExtras.length
      ? systemExtras.join("\n\n") + "\n\n" + baseSystemMessage
      : baseSystemMessage;

    const userMessage = [
      "Existing continuity ledger:",
      existingText,
      "",
      rebuild ? "Roleplay transcript:" : "New turns since the last ledger update:",
      transcript,
    ].join("\n");

    const result = await host.generate.quiet({
      userId,
      connection_id: state.settings.connectionId || undefined,
      messages: [
        { role: "system", content: systemMessage },
        ...extraMessages,
        { role: "user", content: userMessage },
      ],
    });
    const content = stripReasoning(string(result?.content ?? "", "model response", 200_000));
    check(content, "The model returned an empty ledger.");

    const last = eligible.at(-1);
    state.lastActiveChatId = chat.id;
    state.ledgers[chat.id] = {
      chatId: chat.id,
      characterId: chat.character_id ?? existing?.characterId ?? null,
      content,
      previousContent: existing ? existing.content : null,
      lastMessageId: last?.id ?? null,
      lastMessageCount: eligible.length,
      updatedAt: new Date().toISOString(),
      source,
    };
    await writeState(host.userStorage, userId, state);
    return buildStatus(state, chat.id, userId);
  }

  async function execute(userId, req) {
    const state = await readState(host.userStorage, userId);

    if (req.action === "load") {
      const status = await buildStatus(state, req.chatId, userId);
      if (status.chat?.id && state.lastActiveChatId !== status.chat.id) {
        state.lastActiveChatId = status.chat.id;
        await writeState(host.userStorage, userId, state);
      }
      return status;
    }

    if (req.action === "preset_blocks") {
      if (!req.presetId || typeof req.presetId !== "string" || !host.presets?.get) return { blocks: [] };
      try {
        const record = await host.presets.get(req.presetId, userId);
        return {
          blocks: presetBlocksOf(record).map(({ id, name, role, enabled }) => ({
            id,
            name,
            role,
            enabled,
          })),
        };
      } catch (error) {
        if (String(error?.message).includes("PERMISSION_DENIED")) return { blocks: [] };
        throw error;
      }
    }

    if (req.action === "save_settings") {
      state.settings = normalizeSettings({
        autoUpdate: req.autoUpdate,
        interval: req.interval,
        skipRecent: req.skipRecent,
        connectionId: req.connectionId ?? "",
        presetId: req.presetId ?? "",
        presetBlockIds: req.presetBlockIds ?? [],
        fallbackPrompt: string(req.fallbackPrompt ?? "", "fallback ledger prompt"),
      });
      await writeState(host.userStorage, userId, state);
      return buildStatus(state, req.chatId, userId);
    }

    if (req.action === "update") {
      return runUpdate(state, req.chatId, userId, { rebuild: Boolean(req.rebuild), source: "manual" });
    }

    if (req.action === "maybe_auto_update") {
      if (!state.settings.autoUpdate) return { updated: false };
      const chat = await resolveChat(req.chatId, userId);
      if (!chat?.id) return { updated: false };
      const messages = await fetchMessages(host, chat.id, userId);
      const eligible = eligibleMessages(messages, state.settings.skipRecent);
      const heldBackTurns = messages.length - eligible.length;
      const existing = state.ledgers[chat.id] ?? null;
      const fresh = selectNewMessages(eligible, existing, false);
      const newAssistantTurns = fresh.filter((m) => m.role === "assistant").length;
      if (newAssistantTurns < state.settings.interval) {
        return {
          updated: false,
          pendingTurns: fresh.length,
          pendingAssistantTurns: newAssistantTurns,
          heldBackTurns,
        };
      }
      const status = await runUpdate(state, chat.id, userId, { rebuild: false, source: "auto" });
      return { updated: true, ...status };
    }

    if (req.action === "save_edit") {
      const chat = await resolveChat(req.chatId, userId);
      check(chat?.id, "Open a roleplay chat to edit its ledger.");
      const content = string(req.content, "ledger content").trim();
      const existing = state.ledgers[chat.id] ?? null;
      state.lastActiveChatId = chat.id;
      state.ledgers[chat.id] = {
        chatId: chat.id,
        characterId: chat.character_id ?? existing?.characterId ?? null,
        content,
        previousContent: existing ? existing.content : null,
        lastMessageId: existing?.lastMessageId ?? null,
        lastMessageCount: existing?.lastMessageCount ?? 0,
        updatedAt: new Date().toISOString(),
        source: "edit",
      };
      await writeState(host.userStorage, userId, state);
      return buildStatus(state, chat.id, userId);
    }

    if (req.action === "undo") {
      const chat = await resolveChat(req.chatId, userId);
      check(chat?.id, "Open a roleplay chat first.");
      const existing = state.ledgers[chat.id];
      check(existing && existing.previousContent !== null && existing.previousContent !== undefined, "Nothing to undo.");
      const previous = existing.previousContent;
      existing.previousContent = existing.content;
      existing.content = previous;
      existing.updatedAt = new Date().toISOString();
      await writeState(host.userStorage, userId, state);
      return buildStatus(state, chat.id, userId);
    }

    if (req.action === "clear") {
      const chat = await resolveChat(req.chatId, userId);
      check(chat?.id, "Open a roleplay chat first.");
      const existing = state.ledgers[chat.id];
      if (existing) {
        state.ledgers[chat.id] = {
          chatId: chat.id,
          content: "",
          previousContent: existing.content,
          lastMessageId: null,
          lastMessageCount: 0,
          updatedAt: new Date().toISOString(),
          source: "edit",
        };
        await writeState(host.userStorage, userId, state);
      }
      return buildStatus(state, chat.id, userId);
    }

    throw new Error("Unknown ledger action.");
  }

  return function dispatch(userId, request) {
    check(typeof userId === "string" && userId, "Sign in to use Continuity Ledger.");
    const task = (locks.get(userId) ?? Promise.resolve())
      .catch(() => {})
      .then(() => execute(userId, request));
    locks.set(userId, task);
    return task.finally(() => {
      if (locks.get(userId) === task) locks.delete(userId);
    });
  };
}
