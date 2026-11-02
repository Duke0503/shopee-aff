/**
 * The few icons Home and the top bar need that packages/ui does not re-export (lucide shapes, ISC
 * licence, drawn inline at the same 2 px stroke), kept here so the shared icon set stays the
 * admin desk's and the website adds no dependency. The other pages' icons are in
 * page-icons.tsx, so Home's first load carries only these.
 */
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function icon(shapes: ReactNode) {
  return function Icon({ className, ...rest }: IconProps) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className ?? "size-4"} {...rest}>
        {shapes}
      </svg>
    );
  };
}

export const ArrowRightIcon = icon(
  <>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </>,
);
export const UserIcon = icon(
  <>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>,
);
export const CircleAlertIcon = icon(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </>,
);
