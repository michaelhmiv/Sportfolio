import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-foreground disabled:opacity-100 aria-[busy=true]:cursor-wait [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 transition-colors duration-fast ease-standard",
  {
    variants: {
      variant: {
        default:
          "bg-action-primary text-action-primary-foreground hover:brightness-110 active:brightness-95",
        destructive:
          "bg-destructive text-destructive-foreground hover:brightness-110 active:brightness-95",
        outline:
          "border border-border-strong bg-surface text-content hover:bg-hover active:bg-pressed",
        secondary:
          "bg-action-secondary text-action-secondary-foreground hover:bg-hover active:bg-pressed",
        ghost: "text-content hover:bg-hover active:bg-pressed",
        link: "text-brand underline-offset-4 hover:underline",
        marketBuy:
          "bg-market-positive text-canvas hover:brightness-110 active:brightness-95 [&_svg]:stroke-[2.25]",
        marketSell:
          "bg-market-negative text-canvas hover:brightness-110 active:brightness-95 [&_svg]:stroke-[2.25]",
        premium:
          "border border-premium/35 bg-premium text-premium-foreground hover:brightness-110 active:brightness-95",
        terminal:
          "rounded-sm border border-brand/30 bg-brand-subtle font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand hover:bg-brand/15 active:bg-brand/20",
        terminalOutline:
          "rounded-sm border border-border-strong bg-surface font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-content hover:bg-hover active:bg-pressed",
      },
      size: {
        default: "h-11 px-4 py-2 sm:h-9",
        sm: "h-11 px-3 text-xs sm:h-8",
        lg: "h-11 px-8",
        icon: "h-11 w-11 p-0 sm:h-9 sm:w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        data-variant={variant || "default"}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
