import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { LOOK_PRIMARY, LOOK_QUIET, LOOK_SECONDARY } from "@/components/states/actions"

// Local edit (vs shadcn base-nova): motion is opacity and transform only, 150 or 240 ms on the design curve (DESIGN.md, Motion): no transition-all, no colour transitions.

// Local edit (vs shadcn base-nova): the looks are the control tiers of DESIGN.md 5.1 (components/states/actions.ts): default is the primary (signal fill),
// outline and secondary are the secondary (tonal fill, 1.5 px edge ring), ghost is the quiet tier. Radius follows --radius-lg, which is --r-ctl (12 px).

// Local edit (vs shadcn base-nova): sizes use min-h-N, never a fixed height (Nastaliq at line height 2.1 clips in h-8).
// The default is 48 px (DESIGN.md: 44 px targets for gloved hands on worker routes) and icon sizes are 48/40/32/56 px squares.
// No text below 14 px: sm was text-[0.8rem]. The base carries no font size or weight: each size sets its own (a second text-* in the base would race it).

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding whitespace-nowrap transition-[opacity,transform] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: LOOK_PRIMARY,
        outline: LOOK_SECONDARY,
        secondary: LOOK_SECONDARY,
        ghost: `${LOOK_QUIET} aria-expanded:text-foreground`,
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "min-h-(--target-field) gap-2 px-5 text-base font-semibold has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3",
        xs: "min-h-8 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs font-medium in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "min-h-(--target) gap-1.5 px-4 text-base font-semibold in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "min-h-14 gap-2 px-6 text-lg font-semibold has-data-[icon=inline-end]:pe-4 has-data-[icon=inline-start]:ps-4",
        icon: "size-12",
        "icon-xs":
          "size-8 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-10 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-14",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
