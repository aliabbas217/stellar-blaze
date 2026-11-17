"use client"

import * as React from "react"
import { cn } from "cn"

// Local edit (vs shadcn base-nova): leading-none removed: line height 1 clips Arabic-script and Indic text (inherits the locale line height).

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
