import { type ContentHash, hashCanonicalJson } from "../codecs/canonical.ts";

export type TypescriptRefactorTask = Readonly<{
  ref: string;
  split: "development" | "held-out";
  sourcePath: string;
  editablePaths: readonly string[];
  evaluatorRef: string;
  profileRef: string;
  prompt: string;
  files: Readonly<Record<string, string>>;
}>;

export const typescriptRefactorTask: TypescriptRefactorTask = Object.freeze({
  ref: "m3/typescript-refactor/trim-prefix@1",
  split: "development",
  sourcePath: "src/trim-prefix.ts",
  editablePaths: Object.freeze(["src/trim-prefix.ts"]),
  evaluatorRef: "m3/typescript-refactor-evaluator@1",
  profileRef: "m3/linux-bwrap-bun@1",
  prompt:
    "Fix trimPrefix so it removes prefix only when prefix occurs at the start of input. Preserve its exported name and return type. Return a restricted JSON patch artifact; edit only src/trim-prefix.ts.",
  files: Object.freeze({
    "package.json": JSON.stringify(
      {
        name: "m3-trim-prefix-task",
        private: true,
        type: "module",
        scripts: { test: "bun test test/trim-prefix.test.ts" },
      },
      null,
      2,
    ),
    "src/trim-prefix.ts": `export function trimPrefix(input: string, prefix: string): string {
  return input.replace(prefix, "");
}
`,
    "test/trim-prefix.test.ts": `import { expect, test } from "bun:test";
import { trimPrefix } from "../src/trim-prefix.ts";

test("removes a leading prefix", () => {
  expect(trimPrefix("prefix-value", "prefix-")).toBe("value");
});

test("preserves a non-leading match", () => {
  expect(trimPrefix("value-prefix", "prefix")).toBe("value-prefix");
});

test("preserves the input when prefix is absent", () => {
  expect(trimPrefix("value", "prefix")).toBe("value");
});
`,
  }),
});

/** Kept untouched until the fixed development comparison has selected a variant. */
export const heldOutTypescriptRefactorTask: TypescriptRefactorTask =
  Object.freeze({
    ref: "m3/typescript-refactor/strip-suffix@1",
    split: "held-out",
    sourcePath: "src/strip-suffix.ts",
    editablePaths: Object.freeze(["src/strip-suffix.ts"]),
    evaluatorRef: "m3/typescript-refactor-evaluator@1",
    profileRef: "m3/linux-bwrap-bun@1",
    prompt:
      "Fix stripSuffix so it removes suffix only when suffix occurs at the end of input. Preserve its exported name and return type. Return a restricted JSON patch artifact; edit only src/strip-suffix.ts.",
    files: Object.freeze({
      "package.json": JSON.stringify(
        {
          name: "m3-strip-suffix-task",
          private: true,
          type: "module",
          scripts: { test: "bun test test/strip-suffix.test.ts" },
        },
        null,
        2,
      ),
      "src/strip-suffix.ts": `export function stripSuffix(input: string, suffix: string): string {
  return input.replace(suffix, "");
}
`,
      "test/strip-suffix.test.ts": `import { expect, test } from "bun:test";
import { stripSuffix } from "../src/strip-suffix.ts";

test("removes a trailing suffix", () => {
  expect(stripSuffix("value-suffix", "-suffix")).toBe("value");
});

test("preserves a non-trailing match", () => {
  expect(stripSuffix("suffix-value", "suffix")).toBe("suffix-value");
});

test("preserves the input when suffix is absent", () => {
  expect(stripSuffix("value", "suffix")).toBe("value");
});
`,
    }),
  });

const typescriptRefactorTasks = Object.freeze([
  typescriptRefactorTask,
  heldOutTypescriptRefactorTask,
]);

export function getTypescriptRefactorTask(
  ref: string,
): TypescriptRefactorTask | undefined {
  return typescriptRefactorTasks.find((task) => task.ref === ref);
}

export function taskSourceFingerprint(
  task: TypescriptRefactorTask,
): ContentHash {
  return hashCanonicalJson({ ref: task.ref, files: task.files });
}
