import { test, expect } from "bun:test";
import { diffLines } from "../src/diff";

test("diffLines tracks added, removed, and inline word changes", () => {
  const result = diffLines("- Holds spare key\n- Dinner Thursday", "- Holds spare key\n- Dinner Friday at 8");
  expect(result.removed).toBe(1);
  expect(result.added).toBe(1);
  expect(result.rows[0]).toEqual({ type: "equal", text: "- Holds spare key" });
  expect(result.rows[1].type).toBe("del");
  expect(result.rows[2].type).toBe("add");
});
