import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * `text-base sm:text-sm` is not a style choice.
 *
 * iOS Safari zooms the whole page in when a form control smaller than 16px takes
 * focus, and it does not zoom back out afterwards — so tapping the title field
 * left the reminder form magnified and half off-screen, and every field after it
 * had to be found by panning. 16px on a phone stops that; 14px returns from `sm`
 * up, where it is a mouse and the browser never zooms.
 *
 * The 44px height goes with it: a 40px control is under the size a fingertip
 * reliably hits, and these are the app's main input surface.
 */
const baseField =
  "flex h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50 sm:h-10 sm:text-sm";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-sm font-medium leading-none mb-1.5 block", className)}
      {...props}
    />
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(baseField, className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    // sm:h-auto as well as h-auto: baseField sets sm:h-10, which would otherwise
    // clamp the box back to one line's worth on anything wider than a phone.
    className={cn(baseField, "h-auto min-h-[80px] sm:h-auto", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(baseField, "cursor-pointer", className)}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Field({
  label,
  children,
  "data-tour": dataTour,
}: {
  label: string;
  children: React.ReactNode;
  /**
   * Anchor for a guided tour (lib/tours.ts). Taken as a prop rather than left to the
   * caller to wrap in a div: a Field is often a grid child, and an extra wrapper
   * around one silently drops it out of the grid it was laid out in.
   */
  "data-tour"?: string;
}) {
  return (
    <div data-tour={dataTour}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
