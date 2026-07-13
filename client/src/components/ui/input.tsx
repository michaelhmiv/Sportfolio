import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const inputVariants = cva(
  "flex h-11 w-full border px-3 py-2 ring-offset-canvas file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-content placeholder:text-content-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-disabled-border disabled:bg-disabled disabled:text-disabled-foreground sm:h-9 md:text-sm",
  {
    variants: {
      variant: {
        default: "rounded-md border-border-subtle bg-surface text-base",
        terminal:
          "rounded-sm border-border bg-[hsl(var(--card)/0.85)] font-mono text-sm placeholder:font-mono placeholder:text-[11px] placeholder:uppercase placeholder:tracking-[0.08em]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface InputProps
  extends React.ComponentProps<"input">, VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, ...props }, ref) => {
    // h-9 to match icon buttons and default buttons.
    return (
      <input
        type={type}
        className={cn(inputVariants({ variant }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
