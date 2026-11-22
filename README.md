# Continuity Ledger for Lumiverse

A Spindle extension that maintains a living, per-chat continuity ledger of lasting facts — who knows what secret, promises made, schedules, holdings, and relationship shifts — separate from narrative summaries.

## Install

1. Open the Spindle panel in Lumiverse and paste `https://github.com/Vc346/lumiverse-continuity-ledger` into the repository installer. Both compiled bundles are included.
2. Install **Continuity Ledger**, grant its requested permissions, and enable it.
3. Add `{{forgeLedger}}` to a system prompt block in your Lumiverse preset (for example, right after your summary block or before Chat History). It expands to the active chat's ledger, or empty text when none has been recorded yet.

## How it works

- **Per-card instructions:** If a card has a `ledger_prompt` saved by **Card Forge** (`character.extensions.voidverse_author.ledger_prompt`), Continuity Ledger uses it automatically. Otherwise, it falls back to your generic prompt in **Ledger settings**, or the built-in default.
- **Manual or automatic updates:** Tap **Update ledger** at any time to incorporate new turns since the last update, or enable **Auto-update** in settings to refresh automatically every *N* assistant replies.
- **Diff, Undo, and manual editing:** Updates apply directly with a one-click **Undo**, a git-style **Diff** view comparing the previous and current ledger, and an inline **Edit** mode so you can fix or pin facts by hand.
- **Rebuild:** Re-reads the conversation from scratch to generate a fresh ledger if you want a clean slate.

## Rebuild

Run these commands from the extension directory after editing the sources. Commit the rebuilt bundles alongside the source to distribute an update.

```sh
bun install --frozen-lockfile
bun build src/backend.ts --target bun --outfile dist/backend.js
bun build src/frontend.ts --target browser --outfile dist/frontend.js
```

Run `bun test` for the regression tests.
