/**
 * The product breakdown a link request stores as JSON. Only the name is read
 * back out here (the pages that show a price keep their own copy), and a
 * payload that cannot be parsed is simply unnamed rather than an error.
 */
export function estimateProductName(estimateDetail: string | null): string {
  if (!estimateDetail) return "";
  try {
    const parsed = JSON.parse(estimateDetail) as { name?: unknown; title?: unknown };
    if (typeof parsed.name === "string" && parsed.name !== "") return parsed.name;
    return typeof parsed.title === "string" ? parsed.title : "";
  } catch {
    return "";
  }
}
