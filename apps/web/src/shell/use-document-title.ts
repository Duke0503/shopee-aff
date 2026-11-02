/** Each page names itself in the browser tab: "<page> - <brand name>", or the brand alone on Home. */
import { useEffect } from "react";

import { webText } from "../labels";

export function useDocumentTitle(page: string | null): void {
  useEffect(() => {
    document.title = page === null ? webText("brand_name") : `${page} · ${webText("brand_name")}`;
  }, [page]);
}
