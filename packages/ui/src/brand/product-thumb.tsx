/**
 * Product thumbnail (LC-17, D56): the image of the product snapshot taken when the link was made,
 * in a fixed square with rounded corners, loaded lazily and without a referrer. A missing or
 * broken image is a neutral grey placeholder of the same size, so rows never jump. The image is
 * decorative: the product name always stands next to it.
 */
import { useState } from "react";

import { PackageIcon } from "../icons";
import { cn } from "../lib/utils";

export interface ProductThumbProps {
  readonly src: string | null | undefined;
  /** Side in px: 32 in tables (LC-17), 40 on phone cards. */
  readonly size?: 32 | 40;
  readonly className?: string;
}

const isImageUrl = (src: string | null | undefined): src is string => typeof src === "string" && /^https:\/\//.test(src);

export function ProductThumb({ src, size = 32, className }: ProductThumbProps) {
  const [broken, setBroken] = useState(false);
  const box = cn("shrink-0 overflow-hidden rounded-md bg-muted", size === 32 ? "size-8" : "size-10", className);
  if (!isImageUrl(src) || broken) {
    return (
      <span data-thumb="placeholder" aria-hidden className={cn(box, "inline-flex items-center justify-center text-muted-foreground")}>
        <PackageIcon className={size === 32 ? "size-4" : "size-5"} />
      </span>
    );
  }
  return <img data-thumb="image" src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={cn(box, "object-cover")} />;
}
