const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Text that came from anywhere but here, made safe to drop into a page. Every
 * value interpolated into an HTML template goes through this.
 */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
