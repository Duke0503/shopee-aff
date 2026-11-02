/** Icons of the pages other than Home (lucide shapes, ISC licence), drawn like site-icons.tsx. */
import { icon } from "./site-icons";

const SHIELD = "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";

export const ScaleIcon = icon(
  <>
    <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
    <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
    <path d="M7 21h10" />
    <path d="M12 3v18" />
    <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
  </>,
);
export const ShieldCheckIcon = icon(
  <>
    <path d={SHIELD} />
    <path d="m9 12 2 2 4-4" />
  </>,
);
export const ShieldAlertIcon = icon(
  <>
    <path d={SHIELD} />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </>,
);
export const LockIcon = icon(
  <>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </>,
);
export const HashIcon = icon(
  <>
    <path d="M4 9h16" />
    <path d="M4 15h16" />
    <path d="M10 3 8 21" />
    <path d="M16 3l-2 18" />
  </>,
);
export const LoaderIcon = icon(<path d="M21 12a9 9 0 1 1-6.219-8.56" />);
export const ChevronsUpDownIcon = icon(
  <>
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </>,
);
export const MinusIcon = icon(<path d="M5 12h14" />);
export const ArrowLeftIcon = icon(
  <>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </>,
);
