/**
 * Design tokens. Components never hard-code a colour; they read from here, so
 * there is one place to change the look.
 */
export const colors = {
  brand: "#ee4d2d",
  brandSoft: "#fff1ec",
  text: "#1f2937",
  muted: "#6b7280",
  surface: "#ffffff",
  border: "#e5e7eb",
} as const;

export type ColorToken = keyof typeof colors;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16 } as const;

export type SpacingToken = keyof typeof spacing;
