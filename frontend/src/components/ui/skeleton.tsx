import { cn } from "cn"

// Local edit (vs shadcn base-nova): bg-muted -> bg-border: a loading block must be visible on the page surface.

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-border", className)}
      {...props}
    />
  )
}

export { Skeleton }
