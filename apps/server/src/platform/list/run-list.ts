/**
 * Runs a checked list query (AD-12, LC-1, LC-6, LC-7). One WHERE clause, built once from the
 * filters and the search, feeds the count, the rows, the facets and the summary, so every figure
 * next to a list describes exactly the rows' set and no count is capped (root cause 6). The page
 * is clamped to the last page of that set before the rows are read, so "41 - 40 of 40" cannot
 * happen (root cause 8). Search is `search_text LIKE ? ESCAPE` over the stored columns with the
 * query folded and its wildcards escaped by packages/core/text (root cause 7). Statuses sort in
 * registry lifecycle order, names by their stored sort key, everything else by the stored column;
 * missing values sort last either way and the spec's key breaks ties, so pages never overlap.
 *
 * The four statements run back to back on the one synchronous connection of the one writer
 * process (AD-2), so no write can land between them.
 */
import type { ListResponse } from "@cashback/contracts";
import { LIKE_ESCAPE, searchPattern, statusesOf, type Clock } from "@cashback/core";
import { sql, type SQL } from "drizzle-orm";

import type { LedgerDb } from "../db/ledger";
import type { ListDefinition } from "./define-list";
import type { ListFilter, ListQuery } from "./list-query.schema";
import type { FieldSpec, FieldSpecs } from "./list.types";

const raw = (text: string): SQL => sql.raw(text);
const alias = (key: string): SQL => sql.raw(`"${key}"`);

function filterSql(field: FieldSpec, filter: ListFilter): SQL {
  const column = raw(field.column);
  if (filter.kind === "range") return sql`(${column} >= ${filter.range.from} AND ${column} < ${filter.range.to})`;
  return sql`${column} IN (${sql.join(
    filter.values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}

function searchSql(columns: readonly string[], q: string | null): SQL | null {
  const pattern = q === null ? null : searchPattern(q);
  if (pattern === null || columns.length === 0) return null;
  const escape = raw(`'${LIKE_ESCAPE}'`);
  return sql`(${sql.join(
    columns.map((c) => sql`${raw(c)} LIKE ${pattern} ESCAPE ${escape}`),
    sql` OR `,
  )})`;
}

function whereSql<F extends FieldSpecs>(list: ListDefinition<F>, query: ListQuery<F>): SQL {
  const parts = query.filters.map((f) => filterSql(list.fields[f.field] as FieldSpec, f));
  const search = searchSql(list.search, query.q);
  if (search !== null) parts.push(search);
  return parts.length === 0 ? sql`1 = 1` : sql.join(parts, sql` AND `);
}

/** The ORDER BY expression of a field: the stored column itself, its lifecycle rank or its sort key. */
function sortExpression(field: FieldSpec): SQL {
  if (field.kind === "status") {
    const ranks = statusesOf(field.entity).map((s) => sql`WHEN ${s.value} THEN ${s.order}`);
    return sql`CASE ${raw(field.column)} ${sql.join(ranks, sql` `)} END`;
  }
  if (field.kind === "name") return raw(field.sortKeyColumn);
  return raw(field.column);
}

function orderSql<F extends FieldSpecs>(list: ListDefinition<F>, query: ListQuery<F>): SQL {
  const field = list.fields[query.sort.field] as FieldSpec;
  const direction = raw(query.sort.direction === "asc" ? "ASC" : "DESC");
  return sql`${sortExpression(field)} ${direction} NULLS LAST, ${raw(list.key)} ASC`;
}

const selectList = (fields: FieldSpecs): SQL =>
  sql.join(
    Object.entries(fields).map(([key, f]) => sql`${raw(f.column)} AS ${alias(key)}`),
    sql`, `,
  );

/** The last page that holds a row of `total` (page 1 when there are none). */
export function clampPage(page: number, pageSize: number, total: number): number {
  return Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
}

function facetsOf<F extends FieldSpecs>(db: LedgerDb, list: ListDefinition<F>, from: SQL, where: SQL): ListResponse<unknown>["facets"] {
  const facets: ListResponse<unknown>["facets"] = {};
  for (const [key, field] of Object.entries(list.fields)) {
    if (!("facet" in field) || field.facet !== true) continue;
    const counted = db.all<{ value: string | null; count: number }>(sql`SELECT ${raw(field.column)} AS value, COUNT(*) AS count FROM ${from} WHERE ${where} GROUP BY 1 ORDER BY 1`);
    if (field.kind !== "status") {
      facets[key] = counted;
      continue;
    }
    // Every registry status gets a chip, in lifecycle order, with 0 when none is in the set.
    const byValue = new Map(counted.map((c) => [c.value, c.count]));
    facets[key] = statusesOf(field.entity).map((s) => ({ value: s.value, count: byValue.get(s.value) ?? 0 }));
  }
  return facets;
}

function summaryOf<F extends FieldSpecs>(db: LedgerDb, list: ListDefinition<F>, from: SQL, where: SQL): Record<string, number> {
  const summed = Object.entries(list.fields).filter(([, f]) => f.kind === "money" && f.summary === true);
  if (summed.length === 0) return {};
  // code.md §4: SQL may SUM() stored whole-dong columns for a list summary; nothing else.
  const columns = sql.join(
    summed.map(([key, f]) => sql`COALESCE(SUM(${raw(f.column)}), 0) AS ${alias(key)}`),
    sql`, `,
  );
  return db.get<Record<string, number>>(sql`SELECT ${columns} FROM ${from} WHERE ${where}`) ?? {};
}

/** One page of the list, with its total, facets and summary over the same filtered set. */
export function runList<F extends FieldSpecs, R = Record<keyof F, unknown>>(db: LedgerDb, list: ListDefinition<F>, query: ListQuery<F>, clock: Clock): ListResponse<R> {
  const from = raw(list.from);
  const where = whereSql(list, query);
  const total = db.get<{ total: number }>(sql`SELECT COUNT(*) AS total FROM ${from} WHERE ${where}`)?.total ?? 0;
  const page = clampPage(query.page, query.pageSize, total);
  const rows = db.all<R>(sql`SELECT ${selectList(list.fields)} FROM ${from} WHERE ${where} ORDER BY ${orderSql(list, query)} LIMIT ${query.pageSize} OFFSET ${(page - 1) * query.pageSize}`);
  return { rows, total, page, pageSize: query.pageSize, facets: facetsOf(db, list, from, where), summary: summaryOf(db, list, from, where), asOf: clock.now() };
}
