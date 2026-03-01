import { describe, it, expect } from "vitest";
import type { A5ElementSubItem } from "@/types/project";

function sortA5Elements(elements: A5ElementSubItem[]): A5ElementSubItem[] {
  return [...elements].sort((a, b) => {
    const fpA = (a.filePath || a.location || '').toLowerCase();
    const fpB = (b.filePath || b.location || '').toLowerCase();
    if (fpA !== fpB) return fpA.localeCompare(fpB);
    const lnA = a.startLine ?? Infinity;
    const lnB = b.startLine ?? Infinity;
    if (lnA !== lnB) return lnA - lnB;
    return (a.deduplicationKey || a.elementKey || '').localeCompare(b.deduplicationKey || b.elementKey || '');
  });
}

const makeEl = (fp: string, line: number | undefined, key: string): A5ElementSubItem => ({
  elementKey: key,
  elementLabel: key,
  location: '',
  filePath: fp,
  startLine: line ?? undefined,
  subCheck: 'A5.1',
  subCheckLabel: '',
  classification: 'confirmed',
  explanation: '',
  wcagCriteria: ['1.3.1'],
  deduplicationKey: key,
});

describe("A5 sort order", () => {
  it("sorts by file then startLine ascending, undefined last", () => {
    const items = [
      makeEl("appointments.tsx", 105, "c"),
      makeEl("appointments.tsx", 54, "a"),
      makeEl("appointments.tsx", undefined, "d"),
      makeEl("appointments.tsx", 76, "b"),
    ];
    const sorted = sortA5Elements(items);
    expect(sorted.map(e => e.startLine)).toEqual([54, 76, 105, undefined]);
  });

  it("sorts across files alphabetically then by line", () => {
    const items = [
      makeEl("z.tsx", 10, "z1"),
      makeEl("a.tsx", 20, "a2"),
      makeEl("a.tsx", 5, "a1"),
    ];
    const sorted = sortA5Elements(items);
    expect(sorted.map(e => `${e.filePath}:${e.startLine}`)).toEqual([
      "a.tsx:5", "a.tsx:20", "z.tsx:10",
    ]);
  });
});
