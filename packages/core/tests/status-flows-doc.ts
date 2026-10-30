/// <reference types="node" />
/**
 * Reads the states and transitions out of `docs/operations/status-flows.md`, so the
 * registry test compares code against the operations standard itself. The order section
 * is read from its two tables; every other entity from its defining sentence, such as
 * "`QUEUED → ISSUED → DELIVERED → CONVERTED`, or `QUEUED → FAILED`". A clause "or X"
 * after a chain branches from the chain's first state.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const STATUS_FLOWS_PATH = fileURLToPath(new URL("../../../docs/operations/status-flows.md", import.meta.url));

export interface DocEntity {
  states: string[];
  initial: string[];
  transitions: [string, string][];
  /** State to the column it is derived from, read from "derived from `column`". */
  derived: Record<string, string>;
  /** Order only: the states whose "Counts as payable" cell starts with "Yes". */
  payable: string[];
}

const TOKEN = /\b[A-Z][A-Z_]{2,}\b/g;
const tokens = (text: string): string[] => text.match(TOKEN) ?? [];

export function readStatusFlows(path = STATUS_FLOWS_PATH): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

/** Section heading (without its number) to body. */
export function sections(doc: string): Map<string, string> {
  const result = new Map<string, string>();
  const parts = doc.split(/^## \d+\. (.+)$/m);
  for (let i = 1; i < parts.length; i += 2) result.set((parts[i] ?? "").trim(), parts[i + 1] ?? "");
  return result;
}

function tableRows(body: string, header: RegExp): string[][] {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => header.test(l));
  if (start < 0) throw new Error(`table not found: ${header}`);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(line.split("|").slice(1, -1).map((c) => c.trim()));
  }
  return rows;
}

function addEdge(edges: [string, string][], from: string, to: string): void {
  if (from !== to && !edges.some(([f, t]) => f === from && t === to)) edges.push([from, to]);
}

export function parseOrder(body: string): DocEntity {
  const stateRows = tableRows(body, /^\| State \|/);
  const states = stateRows.map((r) => tokens(r[0] ?? "")[0] ?? "");
  const payable = stateRows.filter((r) => (r[3] ?? "").startsWith("Yes")).map((r) => tokens(r[0] ?? "")[0] ?? "");
  const rows = tableRows(body, /^\| From \| To \|/).map((r) => ({ from: r[0] ?? "", to: r[1] ?? "" }));
  const initial: string[] = [];
  const edges: [string, string][] = [];
  for (const { from, to } of rows) {
    if (from === "none") initial.push(...tokens(to));
  }
  for (const { from, to } of rows) {
    for (const f of tokens(from)) {
      const previous = /previous state/.test(to) ? rows.filter((r) => tokens(r.to).includes(f)).flatMap((r) => tokens(r.from)) : [];
      for (const t of [...previous, ...tokens(to)]) addEdge(edges, f, t);
    }
  }
  return { states, initial, transitions: edges, derived: {}, payable };
}

/** The first sentence of a paragraph, after any "Label:" lead-in. */
function definingSentence(paragraph: string): string {
  const sentence = paragraph.replace(/\s+/g, " ").split(/\.(?:\s|$)/)[0] ?? "";
  const colon = sentence.indexOf(":");
  return colon >= 0 ? sentence.slice(colon + 1) : sentence;
}

function derivedStates(sentence: string): Record<string, string> {
  const derived: Record<string, string> = {};
  for (const m of sentence.matchAll(/`([A-Z_]+)` \(([^()]*)\)/g)) {
    const column = /derived from `([a-z_]+)`/.exec(m[2] ?? "");
    if (column?.[1] && m[1]) derived[m[1]] = column[1];
  }
  return derived;
}

export function parseChain(paragraph: string): DocEntity {
  const sentence = definingSentence(paragraph);
  const plain = sentence.replace(/\([^()]*\)/g, "").replaceAll("`", "");
  const pieces = plain.split(/(,\s*or\s+|\s+or\s+|,\s*)/);
  const states: string[] = [];
  const edges: [string, string][] = [];
  let head: string | undefined;
  let branch = false;
  for (const piece of pieces) {
    if (/^(,\s*or\s+|\s+or\s+|,\s*)$/.test(piece)) {
      branch = /or/.test(piece);
      continue;
    }
    const chain = piece.split("→").map((segment) => tokens(segment)[0]).filter((t): t is string => t !== undefined);
    for (const s of chain) if (!states.includes(s)) states.push(s);
    for (let i = 1; i < chain.length; i++) addEdge(edges, chain[i - 1] ?? "", chain[i] ?? "");
    if (chain.length > 1) head ??= chain[0];
    else if (chain.length === 1 && branch && head) addEdge(edges, head, chain[0] ?? "");
  }
  return { states, initial: states.slice(0, 1), transitions: edges, derived: derivedStates(sentence), payable: [] };
}

/** The paragraph of a section that starts with the given text, or its first paragraph. */
export function paragraph(body: string, startsWith?: string): string {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const found = startsWith === undefined ? paragraphs[0] : paragraphs.find((p) => p.startsWith(startsWith));
  if (found === undefined) throw new Error(`paragraph not found: ${startsWith ?? "(first)"}`);
  return found;
}

/** The document with whitespace collapsed, for finding a quoted rule. */
export function flatText(doc: string): string {
  return doc.replace(/\s+/g, " ");
}
