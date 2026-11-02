/**
 * The conversion report list put together per order (production 2026-11-03). The list does not
 * hold one entry per checkout: the same checkout id comes back in several entries with different
 * content (a checkout over several shops' orders, an order's items over several entries), so a
 * checkout id is no row key. The live reader (`report_reader.py` `_row_to_report_row`) keyed each
 * entry by its order number (`orders[0].order_sn`, the checkout id only without one) and applied
 * every entry in turn; this keys rows by order number too, every order of an entry kept (R3), and
 * puts an order's entries together into one conversion, so one read applies one row per order.
 *
 * - An item is known by its `item_id` and `model_id`; an item without an id by its whole content.
 *   The same item seen again in another entry with the same content is kept once; with other
 *   content it is a conflict. Items of one entry are never compared with each other.
 * - The order's own fields that decide money or attribution (`order_status`, the sub_ids in
 *   `utm_content`) must agree across its entries, or it is a conflict.
 * - An entry with no order number is kept as it is, and freezes downstream (shopee-report.ts).
 *
 * A conflict names the order number only, never content.
 */
import { asArray, asId, asObject } from "./report-row";

type Json = Record<string, unknown>;

export interface ShopeeReadCounts {
  /** Entries in the list as read. */
  readonly entries: number;
  /** Distinct checkout ids among them. */
  readonly checkouts: number;
  /** Conversions after putting entries together: one per order number, plus entries without one. */
  readonly orders: number;
  /** Items dropped because another entry already held the same item with the same content. */
  readonly repeatedItems: number;
}

export interface ShopeeOrderMerge {
  readonly conversions: Json[];
  /** The first order number whose entries disagree; null when none do. */
  readonly conflict: string | null;
  readonly counts: ShopeeReadCounts;
}

interface Group {
  readonly conversion: Json;
  readonly order: Json;
  readonly agreed: string;
  readonly items: unknown[];
  readonly seen: Map<string, string>;
}

const itemKey = (item: unknown, content: string): string => {
  const o = asObject(item);
  const id = asId(o["item_id"]);
  return id === "" ? `content:${content}` : `item:${id}/${asId(o["model_id"])}`;
};

/** Adds one entry's items to its order; returns whether one of them conflicts with an earlier entry. */
function addItems(group: Group, items: readonly unknown[], counts: { repeatedItems: number }): boolean {
  let conflict = false;
  const added: [string, string][] = [];
  for (const item of items) {
    const content = JSON.stringify(item);
    const key = itemKey(item, content);
    const before = group.seen.get(key);
    if (before === undefined) {
      group.items.push(item);
      added.push([key, content]);
    } else if (before === content) counts.repeatedItems++;
    else conflict = true;
  }
  for (const [key, content] of added) if (!group.seen.has(key)) group.seen.set(key, content);
  return conflict;
}

export function mergeShopeeOrders(entries: readonly unknown[]): ShopeeOrderMerge {
  const slots: ({ readonly loose: Json } | { readonly group: Group })[] = [];
  const groups = new Map<string, Group>();
  const checkouts = new Set<string>();
  const counts = { repeatedItems: 0 };
  let conflict: string | null = null;
  for (const entry of entries) {
    const conversion = asObject(entry);
    const checkout = asId(conversion["checkout_id"]);
    if (checkout !== "") checkouts.add(checkout);
    const orders = asArray(conversion["orders"]);
    if (orders.length === 0) slots.push({ loose: conversion });
    for (const raw of orders) {
      const order = asObject(raw);
      const orderSn = asId(order["order_sn"]);
      if (orderSn === "") {
        slots.push({ loose: { ...conversion, orders: [raw] } });
        continue;
      }
      const agreed = JSON.stringify([order["order_status"] ?? null, conversion["utm_content"] ?? null]);
      let group = groups.get(orderSn);
      if (group === undefined) {
        group = { conversion, order, agreed, items: [], seen: new Map() };
        groups.set(orderSn, group);
        slots.push({ group });
      } else if (group.agreed !== agreed) conflict ??= orderSn;
      if (addItems(group, asArray(order["items"]), counts)) conflict ??= orderSn;
    }
  }
  const conversions = slots.map((slot) => ("loose" in slot ? slot.loose : { ...slot.group.conversion, orders: [{ ...slot.group.order, items: slot.group.items }] }));
  return { conversions, conflict, counts: { entries: entries.length, checkouts: checkouts.size, orders: conversions.length, repeatedItems: counts.repeatedItems } };
}
