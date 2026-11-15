import type { AbstractIntlMessages } from "next-intl";

type Branch = { [key: string]: Branch | string };

function isBranch(value: unknown): value is Branch {
  return typeof value === "object" && value !== null;
}

/**
 * The subset of a locale's message catalogue named by `paths`: a top-level key ("worker") keeps that whole namespace, a
 * dotted path ("judge.proof") keeps only that branch. A path that does not exist is an error, never an empty hole: a client
 * namespace renamed in en.json must fail the build or the unit test, not render a raw key on a phone.
 */
export function pickMessages(messages: AbstractIntlMessages, paths: readonly string[]): AbstractIntlMessages {
  const picked: Branch = {};
  for (const path of paths) {
    const segments = path.split(".");
    let source: unknown = messages;
    let target: Branch = picked;
    for (const [index, segment] of segments.entries()) {
      const next: unknown = isBranch(source) ? source[segment] : undefined;
      if (next === undefined) throw new Error(`pickMessages: "${path}" is not in the catalogue`);
      if (index === segments.length - 1) {
        target[segment] = next as Branch | string;
        break;
      }
      const existing = target[segment];
      const branch: Branch = isBranch(existing) ? existing : {};
      target[segment] = branch;
      target = branch;
      source = next;
    }
  }
  return picked;
}
