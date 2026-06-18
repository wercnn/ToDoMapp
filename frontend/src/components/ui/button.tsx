/**
 * Button — shadcn-style API (cva variants) carrying the "Earned Momentum" chunky
 * treatment: primary/system variants have a 3D bottom edge that presses on click
 * (design language §6 / Earned Momentum "3D bottom edge"). Tokens only, no hex.
 */
import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-extrabold text-sm transition-[transform,background-color] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] cursor-pointer",
  {
    variants: {
      variant: {
        primary:
          "bg-progress text-on-accent shadow-[0_4px_0_var(--accent-progress-press)] hover:brightness-110 active:translate-y-[3px] active:shadow-[0_1px_0_var(--accent-progress-press)]",
        system:
          "bg-system text-on-accent shadow-[0_4px_0_var(--accent-system-press)] hover:brightness-110 active:translate-y-[3px] active:shadow-[0_1px_0_var(--accent-system-press)]",
        secondary:
          "bg-surface-2 text-text-primary border border-border-strong hover:bg-surface-3",
        ghost: "bg-transparent text-text-secondary hover:bg-surface-2 hover:text-text-primary",
        outline:
          "bg-transparent text-text-secondary border border-border hover:bg-surface-2 hover:text-text-primary",
      },
      size: {
        sm: "px-3 py-2 text-xs",
        md: "px-5 py-3",
        lg: "px-6 py-3.5 text-base",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";
