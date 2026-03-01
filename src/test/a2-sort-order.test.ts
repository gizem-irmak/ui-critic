import { describe, it, expect } from "vitest";
import type { A2ElementSubItem } from "@/types/project";

function sortA2Elements(elements: A2ElementSubItem[]): A2ElementSubItem[] {
  return [...elements].sort((a, b) => {
    const fpA = (a.filePath || a.location || '').toLowerCase();
    const fpB = (b.filePath || b.location || '').toLowerCase();
    if (fpA !== fpB) return fpA.localeCompare(fpB);
    const lnA = a.startLine ?? Infinity;
    const lnB = b.startLine ?? Infinity;
    if (lnA !== lnB) return lnA - lnB;
    return (a.deduplicationKey || '').localeCompare(b.deduplicationKey || '');
  });
}

const makeEl = (fp: string, line: number | undefined, key: string): A2ElementSubItem => ({
  elementLabel: key,
  location: '',
  filePath: fp,
  startLine: line ?? undefined,
  focusable: 'yes',
  classification: 'confirmed',
  explanation: '',
  confidence: 0.92,
  deduplicationKey: key,
});

describe("A2 sort order", () => {
  it("sorts by file then startLine ascending, undefined last", () => {
    const items = [
      makeEl("command.tsx", 80, "c"),
      makeEl("command.tsx", 45, "a"),
      makeEl("command.tsx", undefined, "d"),
      makeEl("command.tsx", 62, "b"),
    ];
    const sorted = sortA2Elements(items);
    expect(sorted.map(e => e.startLine)).toEqual([45, 62, 80, undefined]);
  });

  it("sorts across files alphabetically then by line", () => {
    const items = [
      makeEl("sidebar.tsx", 10, "s1"),
      makeEl("command.tsx", 20, "c2"),
      makeEl("command.tsx", 5, "c1"),
    ];
    const sorted = sortA2Elements(items);
    expect(sorted.map(e => `${e.filePath}:${e.startLine}`)).toEqual([
      "command.tsx:5", "command.tsx:20", "sidebar.tsx:10",
    ]);
  });

  it("renders two distinct Source lines for two occurrences", () => {
    const items = [
      makeEl("command.tsx", 45, "a"),
      makeEl("command.tsx", 80, "b"),
    ];
    const sorted = sortA2Elements(items);
    expect(sorted).toHaveLength(2);
    expect(sorted[0].startLine).toBe(45);
    expect(sorted[1].startLine).toBe(80);
  });
});
