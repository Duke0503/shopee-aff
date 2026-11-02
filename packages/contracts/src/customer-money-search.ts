/**
 * The URL state of My money's two lists (Stories 7.3 and 7.4, LC-4): what the website's router
 * may carry and the server's list specs offer (a server test checks they agree). Kept apart from
 * the response schemas so the website's first script reads them without zod.
 */
import { storedValues } from "@cashback/core";

import type { ListSearchSpec } from "./list-search.schema";

/** The URL state of the order lines; the server's list spec must offer exactly this. */
export const MY_ORDERS_SEARCH_SPEC: ListSearchSpec = {
  sortable: ["recordedAt"],
  filters: [{ field: "status", values: storedValues("order") }],
  defaultSort: { field: "recordedAt", direction: "desc" },
  // The "show more" link grows the page by 20 lines at a time (pen.dev ktmGZ footer).
  pageSizes: [20, 40, 60, 80, 100],
};

export const MY_PAYOUTS_SEARCH_SPEC: ListSearchSpec = {
  sortable: ["recordedAt"],
  filters: [],
  defaultSort: { field: "recordedAt", direction: "desc" },
  pageSizes: [20],
};
