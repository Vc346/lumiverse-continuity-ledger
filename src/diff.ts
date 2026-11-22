export type DiffOp = { type: "equal" | "del" | "add"; value: string };

export type InlineSegment = { type: "equal" | "del" | "add"; text: string };

export type DiffRow =
  | { type: "equal"; text: string }
  | { type: "del"; text: string; parts?: InlineSegment[] }
  | { type: "add"; text: string; parts?: InlineSegment[] }
  | { type: "skip"; count: number };

export type LineDiff = {
  rows: DiffRow[];
  added: number;
  removed: number;
};

const MAX_LCS_CELLS = 400_000;

export function diffSequence(before: string[], after: string[]): DiffOp[] {
  let start = 0;
  let endBefore = before.length;
  let endAfter = after.length;

  while (start < endBefore && start < endAfter && before[start] === after[start]) start++;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }

  const prefix: DiffOp[] = before.slice(0, start).map((value) => ({ type: "equal", value }));
  const suffix: DiffOp[] = before.slice(endBefore).map((value) => ({ type: "equal", value }));

  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);
  if (!a.length && !b.length) return [...prefix, ...suffix];
  if (!a.length) return [...prefix, ...b.map((value): DiffOp => ({ type: "add", value })), ...suffix];
  if (!b.length) return [...prefix, ...a.map((value): DiffOp => ({ type: "del", value })), ...suffix];

  const m = a.length;
  const n = b.length;
  if (m * n > MAX_LCS_CELLS) {
    return [
      ...prefix,
      ...a.map((value): DiffOp => ({ type: "del", value })),
      ...b.map((value): DiffOp => ({ type: "add", value })),
      ...suffix,
    ];
  }

  const stride = n + 1;
  const dp = new Uint32Array((m + 1) * stride);
  for (let i = m - 1; i >= 0; i--) {
    const row = i * stride;
    const nextRow = (i + 1) * stride;
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[row + j] = dp[nextRow + j + 1] + 1;
      else dp[row + j] = Math.max(dp[nextRow + j], dp[row + j + 1]);
    }
  }

  const middle: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      middle.push({ type: "equal", value: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * stride + j] >= dp[i * stride + j + 1]) {
      middle.push({ type: "del", value: a[i] });
      i++;
    } else {
      middle.push({ type: "add", value: b[j] });
      j++;
    }
  }
  while (i < m) middle.push({ type: "del", value: a[i++] });
  while (j < n) middle.push({ type: "add", value: b[j++] });

  return [...prefix, ...middle, ...suffix];
}

function mergeSegments(ops: DiffOp[], side: "del" | "add"): InlineSegment[] {
  const result: InlineSegment[] = [];
  for (const op of ops) {
    if (op.type !== "equal" && op.type !== side) continue;
    const prev = result.at(-1);
    if (prev && prev.type === op.type) prev.text += op.value;
    else result.push({ type: op.type, text: op.value });
  }
  return result;
}

function inlineDiff(before: string, after: string): { del: InlineSegment[]; add: InlineSegment[] } | null {
  const a = before.match(/\S+|\s+/g) ?? [];
  const b = after.match(/\S+|\s+/g) ?? [];
  if (!a.length || !b.length) return null;
  const ops = diffSequence(a, b);
  let shared = 0;
  let total = 0;
  for (const op of ops) {
    const weight = op.value.trim().length;
    if (!weight) continue;
    if (op.type === "equal") {
      shared += weight * 2;
      total += weight * 2;
    } else {
      total += weight;
    }
  }
  if (!shared || total === 0 || shared / total < 0.25) return null;
  return { del: mergeSegments(ops, "del"), add: mergeSegments(ops, "add") };
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

export function diffLines(before: string, after: string, context = 2): LineDiff {
  const ops = diffSequence(splitLines(before), splitLines(after));
  const raw: Exclude<DiffRow, { type: "skip" }>[] = [];
  let added = 0;
  let removed = 0;

  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "equal") {
      raw.push({ type: "equal", text: ops[i].value });
      i++;
      continue;
    }
    const dels: string[] = [];
    const adds: string[] = [];
    while (i < ops.length && ops[i].type !== "equal") {
      if (ops[i].type === "del") dels.push(ops[i].value);
      else adds.push(ops[i].value);
      i++;
    }
    removed += dels.length;
    added += adds.length;
    const pairs = Math.min(dels.length, adds.length);
    const highlights = Array.from({ length: pairs }, (_, index) => inlineDiff(dels[index], adds[index]));
    dels.forEach((text, index) => {
      const parts = highlights[index]?.del;
      raw.push(parts ? { type: "del", text, parts } : { type: "del", text });
    });
    adds.forEach((text, index) => {
      const parts = highlights[index]?.add;
      raw.push(parts ? { type: "add", text, parts } : { type: "add", text });
    });
  }

  if (added === 0 && removed === 0) return { rows: raw, added: 0, removed: 0 };

  const visible = new Array<boolean>(raw.length).fill(false);
  for (let index = 0; index < raw.length; index++) {
    if (raw[index].type === "equal") continue;
    const from = Math.max(0, index - context);
    const to = Math.min(raw.length - 1, index + context);
    for (let k = from; k <= to; k++) visible[k] = true;
  }

  const rows: DiffRow[] = [];
  let index = 0;
  while (index < raw.length) {
    if (visible[index]) {
      rows.push(raw[index]);
      index++;
      continue;
    }
    let end = index;
    while (end < raw.length && !visible[end]) end++;
    const skipped = end - index;
    if (skipped <= 2) {
      for (let k = index; k < end; k++) rows.push(raw[k]);
    } else {
      rows.push({ type: "skip", count: skipped });
    }
    index = end;
  }

  return { rows, added, removed };
}
