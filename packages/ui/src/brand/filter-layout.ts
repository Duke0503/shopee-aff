/**
 * Where a list's filters are drawn (wireframe phone filter sheet): in line on the toolbar, or
 * as full-width rows inside the phone filter sheet. The filters read it, so a list passes the same
 * filter elements to both places.
 */
import { createContext, useContext } from "react";

export type FilterLayout = "inline" | "sheet";

export const FilterLayoutContext = createContext<FilterLayout>("inline");

export const useFilterLayout = (): FilterLayout => useContext(FilterLayoutContext);
