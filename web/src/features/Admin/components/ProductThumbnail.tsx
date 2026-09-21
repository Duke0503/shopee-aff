import * as React from "react"
import { Package } from "lucide-react"

interface ProductThumbnailProps {
  src?: string | null
  alt?: string
  imageUrl?: string | null
  productName?: string
  className?: string
  size?: "sm" | "md" | "lg"
}

export function ProductThumbnail({
  src,
  alt,
  imageUrl,
  productName,
  className = "",
  size = "md",
}: ProductThumbnailProps) {
  const [error, setError] = React.useState(false)
  const finalSrc = imageUrl || src
  const finalAlt = productName || alt || "Sản phẩm"

  const sizeClass =
    size === "sm"
      ? "h-9 w-9"
      : size === "lg"
      ? "h-14 w-14"
      : "h-11 w-11"

  if (!finalSrc || error) {
    return (
      <div
        className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground border border-border/50 ${className}`}
      >
        <Package className="h-5 w-5 opacity-60" />
      </div>
    )
  }

  return (
    <img
      src={finalSrc}
      alt={finalAlt}
      className={`${sizeClass} shrink-0 rounded-lg object-cover border border-border/60 shadow-xs ${className}`}
      loading="lazy"
      onError={() => setError(true)}
    />
  )
}
