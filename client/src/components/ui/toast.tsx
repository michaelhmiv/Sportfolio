import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed bottom-[4.5rem] sm:bottom-0 right-0 left-0 sm:left-auto z-[100] flex max-h-screen w-full sm:w-auto flex-col-reverse gap-2 p-3 sm:p-4 sm:max-w-[420px]",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full touch-pan-y select-none items-center justify-between space-x-4 overflow-hidden rounded-md border p-4 pr-10 shadow-overlay transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-toast-slide-in data-[state=closed]:animate-toast-slide-out",
  {
    variants: {
      variant: {
        default: "border-border-strong bg-overlay text-content",
        destructive:
          "destructive group border-market-negative bg-market-negative text-content-inverse",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants> & {
      index?: number;
    }
>(({ className, variant, index = 0, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      style={{
        // Use zIndex only - don't override transform which Radix uses for swipe
        zIndex: 100 - index,
        // Use opacity for depth effect instead of scale (doesn't conflict with transform)
        opacity: 1 - index * 0.1,
      }}
      {...props}
    />
  );
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-border-strong bg-transparent px-3 text-sm font-medium ring-offset-canvas transition-colors hover:bg-hover focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2 disabled:pointer-events-none disabled:text-disabled-foreground sm:h-9 group-[.destructive]:border-content-inverse/40 group-[.destructive]:hover:border-content-inverse group-[.destructive]:hover:bg-content-inverse/10 group-[.destructive]:hover:text-content-inverse group-[.destructive]:focus:ring-focus",
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-2 top-2 rounded-md p-1 text-content-muted opacity-0 transition-opacity hover:text-content focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-focus group-hover:opacity-100 group-[.destructive]:text-content-inverse/80 group-[.destructive]:hover:text-content-inverse group-[.destructive]:focus:ring-focus",
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title ref={ref} className={cn("text-sm font-semibold", className)} {...props} />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("text-sm opacity-90", className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
