/**
 * shadcn's class merge helper: later Tailwind classes win over earlier ones. The theme's own
 * text sizes are registered so `text-caption` is never mistaken for a colour and dropped.
 */
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["caption", "meta"] }] } },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
