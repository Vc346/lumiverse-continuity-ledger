import MarkdownIt from "markdown-it";
import { diffLines } from "./diff";

const markdown = new MarkdownIt({ html: false, breaks: true });
markdown.validateLink = (url) => /^(https?:\/\/|mailto:)/i.test(url);
markdown.renderer.rules.image = (tokens, index) =>
  markdown.utils.escapeHtml(tokens[index].content);

const promptSourceLabels = {
  card: "Using card’s Forge ledger prompt",
  fallback: "Using generic fallback prompt",
  default: "Using built-in default prompt",
};

export function setup(ctx) {
  const tab = ctx.ui.registerDrawerTab({
    id: "continuity-ledger",
    title: "Ledger",
  });
  const root = document.createElement("section");
  root.className = "vv-ledger";
  tab.root.appendChild(root);

  const removeStyle = ctx.dom.addStyle(`
    .vv-ledger {
      box-sizing: border-box;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      width: 100%;
      min-width: 0;
      max-width: 100%;
      gap: 12px;
      padding: 12px;
      color: var(--lumiverse-text);
      font: inherit;
      overflow-wrap: anywhere;
    }
    .vv-ledger :where(.vv-field, .vv-picker, .vv-card) {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
    }
    .vv-ledger :where(.vv-button, .vv-input) {
      box-sizing: border-box;
      min-width: 0;
      max-width: 100%;
      min-height: 38px;
      padding: 7px 12px;
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius, 8px);
      background: var(--lumiverse-fill-subtle);
      color: inherit;
      font: inherit;
    }
    .vv-ledger .vv-button { cursor: pointer; font-weight: 600 }
    .vv-ledger .vv-button:disabled { opacity: .55; cursor: default }
    .vv-ledger .vv-primary {
      background: var(--lumiverse-accent, #8c70c7);
      color: var(--lumiverse-accent-fg, #fff);
      border-color: transparent;
    }
    .vv-ledger :where(.vv-button, .vv-input):focus-visible {
      outline: 2px solid var(--lumiverse-accent, #8c70c7);
      outline-offset: -2px;
    }
    .vv-ledger select option { color: CanvasText; background: Canvas }
    .vv-ledger h3, .vv-ledger p { margin: 0 }
    .vv-ledger .vv-heading {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--lumiverse-border);
    }
    .vv-ledger .vv-heading h3 {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .vv-ledger .vv-tabs { display: flex; gap: 4px }
    .vv-ledger .vv-tab {
      min-height: 34px;
      padding: 4px 10px;
      font-size: .88em;
      background: transparent;
      border-color: transparent;
      color: var(--lumiverse-text-muted);
    }
    .vv-ledger .vv-tab[aria-selected="true"] {
      background: var(--lumiverse-fill-subtle);
      border-bottom: 2px solid var(--lumiverse-accent, #8c70c7);
      color: var(--lumiverse-accent, #8c70c7);
    }
    .vv-ledger .vv-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 10px;
      color: var(--lumiverse-text-muted);
      font-size: .85em;
    }
    .vv-ledger .vv-actions { display: flex; flex-wrap: wrap; gap: 8px }
    .vv-ledger .vv-compact { min-height: 32px; padding: 4px 10px; font-size: .85em }
    .vv-ledger .vv-card {
      padding: 12px;
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius, 8px);
      background: var(--lumiverse-fill-subtle);
    }
    .vv-ledger .vv-markdown { min-width: 0; overflow-x: auto; line-height: 1.55 }
    .vv-ledger .vv-markdown > :first-child { margin-top: 0 }
    .vv-ledger .vv-markdown > :last-child { margin-bottom: 0 }
    .vv-ledger .vv-markdown > * + * { margin-top: .6em }
    .vv-ledger .vv-markdown :is(ul, ol) { padding-inline-start: 1.35em }
    .vv-ledger .vv-markdown :is(h1, h2, h3, h4) { margin-bottom: .25em; font-size: 1.05em }
    .vv-ledger .vv-markdown code { font-family: ui-monospace, monospace }
    .vv-ledger .vv-status { color: var(--lumiverse-text-muted); font-size: .9em }
    .vv-ledger .vv-waiting {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--lumiverse-text-muted);
    }
    .vv-ledger .vv-spinner {
      box-sizing: border-box;
      width: 15px;
      height: 15px;
      border: 2px solid color-mix(in srgb, var(--lumiverse-accent, #8c70c7) 30%, transparent);
      border-top-color: var(--lumiverse-accent, #8c70c7);
      border-radius: 50%;
      animation: vv-ledger-spin .8s linear infinite;
    }
    @keyframes vv-ledger-spin {
      to { transform: rotate(360deg) }
    }
    .vv-ledger .vv-diff-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .vv-ledger .vv-diff-stats {
      display: inline-flex;
      gap: 6px;
      font-size: .82em;
      font-weight: 600;
      font-family: ui-monospace, monospace;
    }
    .vv-ledger .vv-diff-added { color: #3fb950 }
    .vv-ledger .vv-diff-removed { color: #f85149 }
    .vv-ledger .vv-diff {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      border: 1px solid var(--lumiverse-border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--lumiverse-fill);
      font-size: .92em;
      line-height: 1.5;
    }
    .vv-ledger .vv-diff-line {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr);
      gap: 6px;
      padding: 2px 8px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .vv-ledger .vv-diff-gutter {
      user-select: none;
      text-align: center;
      font-family: ui-monospace, monospace;
      font-weight: 700;
      opacity: .85;
    }
    .vv-ledger .vv-diff-line[data-kind="del"] {
      background: color-mix(in srgb, #f85149 16%, transparent);
    }
    .vv-ledger .vv-diff-line[data-kind="del"] .vv-diff-gutter { color: #f85149 }
    .vv-ledger .vv-diff-line[data-kind="add"] {
      background: color-mix(in srgb, #3fb950 16%, transparent);
    }
    .vv-ledger .vv-diff-line[data-kind="add"] .vv-diff-gutter { color: #3fb950 }
    .vv-ledger .vv-diff-line del {
      text-decoration: none;
      border-radius: 3px;
      background: color-mix(in srgb, #f85149 32%, transparent);
    }
    .vv-ledger .vv-diff-line ins {
      text-decoration: none;
      border-radius: 3px;
      background: color-mix(in srgb, #3fb950 32%, transparent);
    }
    .vv-ledger .vv-diff-skip {
      padding: 4px 10px;
      border-block: 1px solid var(--lumiverse-border);
      background: var(--lumiverse-fill-subtle);
      color: var(--lumiverse-text-muted);
      font-size: .82em;
      text-align: center;
    }
    .vv-ledger textarea.vv-input {
      width: 100%;
      resize: vertical;
      font-size: max(16px, .95em);
      line-height: 1.5;
    }
    .vv-ledger .vv-checkbox {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }
  `);

  let alive = true;
  let busy = false;
  let busyLabel = "";
  let status = "";
  let activeChatId = undefined;
  let state = null;
  let activeView = "ledger"; // "ledger" | "settings"
  let mode = "view"; // "view" | "diff" | "edit"
  let editDraft = "";

  let settingsDraft = {
    autoUpdate: false,
    interval: 6,
    connectionId: "",
    fallbackPrompt: "",
  };

  const components = [];
  function destroyComponents() {
    for (const component of components.splice(0)) component.destroy();
  }

  let sequence = 0;
  const waiting = new Map();
  const unsubscribe = ctx.onBackendMessage((msg) => {
    if (msg?.type !== "ledger_result") return;
    const finish = waiting.get(msg.requestId);
    if (finish) finish(msg);
  });

  function rpc(payload) {
    const requestId = globalThis.crypto?.randomUUID?.() ?? Date.now() + "-" + ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => finish({ error: "Ledger request timed out." }),
        300_000,
      );
      function finish(msg) {
        clearTimeout(timeout);
        waiting.delete(requestId);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.data);
      }
      waiting.set(requestId, finish);
      try {
        ctx.sendToBackend({ type: "ledger", requestId, ...payload });
      } catch (error) {
        finish({ error: error.message });
      }
    });
  }

  function applyState(data, syncSettings = false) {
    state = data;
    if (data.chat?.id) activeChatId = data.chat.id;
    if (syncSettings && data.settings) {
      settingsDraft = { ...data.settings };
    }
    if (!data.ledger?.previousContent && mode === "diff") mode = "view";
  }

  async function run(action, args = {}, label = "Loading…") {
    if (busy) return;
    busy = true;
    busyLabel = label;
    status = "";
    render();
    try {
      const data = await rpc({ action, chatId: activeChatId, ...args });
      applyState(data, action === "load" || action === "save_settings");
      if (action === "save_edit" || action === "update" || action === "undo" || action === "clear") {
        mode = "view";
      }
      if (action === "save_settings") {
        status = "Settings saved.";
      }
    } catch (error) {
      status = error.message;
    } finally {
      busy = false;
      busyLabel = "";
      if (alive) render();
    }
  }

  async function handleGenerationEnded(chatId) {
    if (!alive || busy) return;
    const targetChatId = typeof chatId === "string" && chatId ? chatId : activeChatId;
    try {
      const result = await rpc({ action: "maybe_auto_update", chatId: targetChatId });
      if (!alive) return;
      if (result.updated) {
        applyState(result);
        render();
      } else if (state && (!targetChatId || targetChatId === state.chat?.id)) {
        if (typeof result.pendingTurns === "number") {
          state = {
            ...state,
            pendingTurns: result.pendingTurns,
            pendingAssistantTurns: result.pendingAssistantTurns ?? state.pendingAssistantTurns,
          };
          render();
        }
      }
    } catch (error) {
      console.warn("[Continuity Ledger] Auto-update failed:", error);
    }
  }

  const stopChatSwitch = ctx.events?.on?.("CHAT_SWITCHED", ({ chatId } = {}) => {
    if (typeof chatId === "string" || chatId === null) {
      activeChatId = chatId ?? undefined;
      mode = "view";
      run("load", { chatId: activeChatId });
    }
  });

  const stopGenEnded = ctx.events?.on?.("GENERATION_ENDED", ({ chatId } = {}) => {
    handleGenerationEnded(chatId);
  });

  function element(parent, tag, text = "") {
    const el = document.createElement(tag);
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function button(parent, label, onClick, primary = false) {
    const b = element(parent, "button", label);
    b.className = primary ? "vv-button vv-primary" : "vv-button";
    b.type = "button";
    b.disabled = busy;
    b.onclick = onClick;
    return b;
  }

  function select(parent, label, options, current, onChange) {
    if (ctx.components?.mountSelect) {
      const picker = element(parent, "div");
      picker.className = "vv-picker";
      element(picker, "span", label);
      const fallback = options.find(({ id }) => id === "");
      components.push(
        ctx.components.mountSelect(element(picker, "div"), {
          ariaLabel: label,
          portal: true,
          value: current,
          options: options
            .filter(({ id }) => id !== "")
            .map(({ id, name }) => ({ value: id, label: name })),
          placeholder: fallback?.name ?? label,
          clearable: Boolean(fallback),
          clearLabel: fallback?.name,
          disabled: busy,
          onChange,
        }),
      );
      return;
    }
    const field = element(parent, "label", label);
    field.className = "vv-field";
    const input = element(field, "select");
    input.className = "vv-input";
    for (const { id, name } of options) element(input, "option", name).value = id;
    input.value = current;
    input.disabled = busy;
    input.onchange = () => onChange(input.value);
  }

  function renderDiff(parent, before, after) {
    const diff = diffLines(before ?? "", after ?? "");
    const bar = element(parent, "div");
    bar.className = "vv-diff-bar";
    const stats = element(bar, "span");
    stats.className = "vv-diff-stats";
    if (!diff.added && !diff.removed) {
      element(stats, "span", "No changes from previous version");
    } else {
      if (diff.added) {
        const added = element(stats, "span", "+" + diff.added);
        added.className = "vv-diff-added";
      }
      if (diff.removed) {
        const removed = element(stats, "span", "-" + diff.removed);
        removed.className = "vv-diff-removed";
      }
    }
    const box = element(parent, "div");
    box.className = "vv-diff";
    for (const row of diff.rows) {
      if (row.type === "skip") {
        const skip = element(box, "div", "⋯ " + row.count + " unchanged lines");
        skip.className = "vv-diff-skip";
        continue;
      }
      const line = element(box, "div");
      line.className = "vv-diff-line";
      line.dataset.kind = row.type;
      const gutter = element(line, "span", row.type === "add" ? "+" : row.type === "del" ? "−" : " ");
      gutter.className = "vv-diff-gutter";
      gutter.setAttribute("aria-hidden", "true");
      const content = element(line, "span");
      if (row.parts?.length) {
        for (const part of row.parts) {
          if (part.type === "equal") content.append(document.createTextNode(part.text));
          else element(content, part.type === "del" ? "del" : "ins", part.text);
        }
      } else {
        content.textContent = row.text || "\u00a0";
      }
    }
  }

  function renderLedgerView() {
    if (!state?.chat) {
      const card = element(root, "div");
      card.className = "vv-card";
      element(card, "p", "Open a roleplay chat in Lumiverse to track its continuity ledger.");
      element(card, "p", "Add {{forgeLedger}} to a system prompt block in your preset so the roleplay model sees it.");
      button(card, "Refresh", () => run("load"));
      return;
    }

    const meta = element(root, "div");
    meta.className = "vv-meta";
    element(meta, "span", promptSourceLabels[state.promptSource] ?? promptSourceLabels.default);
    const pending = state.pendingTurns ?? 0;
    element(meta, "span", pending > 0 ? "· " + pending + (pending === 1 ? " new message" : " new messages") : "· Up to date");
    if (state.settings?.autoUpdate) {
      element(meta, "span", "· Auto every " + state.settings.interval + " replies");
    }

    const ledger = state.ledger;
    const hasContent = Boolean(ledger?.content?.trim());
    const hasPrevious = ledger?.previousContent !== null && ledger?.previousContent !== undefined;

    const actions = element(root, "div");
    actions.className = "vv-actions";
    button(actions, "Update ledger", () => run("update", { rebuild: false }, "Updating ledger…"), true);
    if (mode !== "edit") {
      const editBtn = button(actions, "Edit", () => {
        editDraft = ledger?.content ?? "";
        mode = "edit";
        render();
      });
      editBtn.classList.add("vv-compact");
    }
    if (hasPrevious && mode !== "edit") {
      const diffBtn = button(actions, mode === "diff" ? "View ledger" : "Diff", () => {
        mode = mode === "diff" ? "view" : "diff";
        render();
      });
      diffBtn.classList.add("vv-compact");
      diffBtn.disabled = false;
      const undoBtn = button(actions, "Undo", () => run("undo", {}, "Restoring previous ledger…"));
      undoBtn.classList.add("vv-compact");
    }
    if (hasContent && mode !== "edit") {
      const rebuildBtn = button(actions, "Rebuild", () => run("update", { rebuild: true }, "Rebuilding ledger…"));
      rebuildBtn.classList.add("vv-compact");
    }

    if (busy) {
      const wait = element(root, "div");
      wait.className = "vv-waiting";
      wait.setAttribute("role", "status");
      const spinner = element(wait, "span");
      spinner.className = "vv-spinner";
      spinner.setAttribute("aria-hidden", "true");
      element(wait, "span", busyLabel || "Working…");
    }

    if (mode === "edit") {
      const card = element(root, "div");
      card.className = "vv-card";
      const area = element(card, "textarea");
      area.className = "vv-input";
      area.rows = 12;
      area.value = editDraft;
      area.disabled = busy;
      area.placeholder = "Enter continuity ledger notes in Markdown…";
      area.oninput = () => (editDraft = area.value);
      const editActions = element(card, "div");
      editActions.className = "vv-actions";
      button(editActions, "Save", () => run("save_edit", { content: editDraft }, "Saving…"), true);
      button(editActions, "Cancel", () => {
        mode = "view";
        render();
      });
      if (hasContent) {
        button(editActions, "Clear ledger", () => run("clear", {}, "Clearing…"));
      }
      return;
    }

    if (mode === "diff" && hasPrevious) {
      renderDiff(root, ledger.previousContent, ledger.content);
      return;
    }

    const card = element(root, "div");
    card.className = "vv-card";
    if (hasContent) {
      const rendered = ctx.dom.inject(card, markdown.render(ledger.content));
      rendered.classList.add("vv-markdown");
    } else {
      element(card, "p", "No continuity ledger recorded for this chat yet.");
      element(
        card,
        "p",
        "Tap Update ledger to extract lasting facts, secrets, promises, and schedules from this chat. Add {{forgeLedger}} to a preset prompt block so the roleplay model sees it.",
      );
    }
  }

  function renderSettingsView() {
    const form = element(root, "form");
    form.className = "vv-field";

    const autoLabel = element(form, "label");
    autoLabel.className = "vv-checkbox";
    const autoBox = document.createElement("input");
    autoBox.type = "checkbox";
    autoBox.checked = settingsDraft.autoUpdate;
    autoBox.disabled = busy;
    autoBox.onchange = () => (settingsDraft.autoUpdate = autoBox.checked);
    autoLabel.append(autoBox, document.createTextNode("Auto-update ledger during roleplay"));

    const intervalLabel = element(form, "label", "Update every N assistant replies");
    intervalLabel.className = "vv-field";
    const intervalInput = element(intervalLabel, "input");
    intervalInput.className = "vv-input";
    intervalInput.type = "number";
    intervalInput.min = "1";
    intervalInput.max = "50";
    intervalInput.value = String(settingsDraft.interval);
    intervalInput.disabled = busy;
    intervalInput.oninput = () => (settingsDraft.interval = Number(intervalInput.value) || 6);

    select(
      form,
      "LLM connection",
      [{ id: "", name: "Active Lumiverse connection" }, ...(state?.connections ?? [])],
      settingsDraft.connectionId,
      (v) => (settingsDraft.connectionId = v),
    );

    const promptLabel = element(form, "label", "Generic fallback ledger prompt");
    promptLabel.className = "vv-field";
    const promptInput = element(promptLabel, "textarea");
    promptInput.className = "vv-input";
    promptInput.rows = 6;
    promptInput.placeholder = "Used when a card has no Card Forge ledger_prompt. Leave blank for the built-in default.";
    promptInput.value = settingsDraft.fallbackPrompt;
    promptInput.disabled = busy;
    promptInput.oninput = () => (settingsDraft.fallbackPrompt = promptInput.value);

    const submit = button(form, "Save settings", null, true);
    submit.type = "submit";
    form.onsubmit = (event) => {
      event.preventDefault();
      run("save_settings", { ...settingsDraft }, "Saving settings…");
    };
  }

  function clearRenderedContent() {
    for (const node of root.querySelectorAll(".vv-markdown")) ctx.dom.uninject(node);
  }

  function render() {
    destroyComponents();
    clearRenderedContent();
    root.replaceChildren();

    const heading = element(root, "div");
    heading.className = "vv-heading";
    const title = element(heading, "h3", state?.chat?.name || "Continuity Ledger");
    title.title = title.textContent;

    const tabsEl = element(heading, "div");
    tabsEl.className = "vv-tabs";
    tabsEl.setAttribute("role", "tablist");
    for (const [id, label] of [
      ["ledger", "Ledger"],
      ["settings", "Settings"],
    ]) {
      const t = button(tabsEl, label, () => {
        activeView = id;
        if (id === "settings" && state?.settings) settingsDraft = { ...state.settings };
        render();
      });
      t.className = "vv-button vv-tab";
      t.disabled = false;
      t.setAttribute("role", "tab");
      t.setAttribute("aria-selected", String(activeView === id));
    }

    if (activeView === "ledger") renderLedgerView();
    else renderSettingsView();

    if (status) {
      const line = element(root, "p", status);
      line.className = "vv-status";
      line.setAttribute("role", "status");
    }
  }

  run("load");

  return () => {
    alive = false;
    unsubscribe();
    stopChatSwitch?.();
    stopGenEnded?.();
    for (const finish of waiting.values()) finish({ error: "Ledger closed" });
    destroyComponents();
    clearRenderedContent();
    removeStyle();
    tab.destroy();
  };
}
