"use client";

import { clsx } from "clsx";
import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <div className="w-full">
      <input
        ref={ref}
        className={clsx(
          "h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 transition-colors",
          "placeholder:text-slate-400",
          "focus:outline-none focus:ring-2 focus:ring-offset-1",
          error
            ? "border-red-400 focus:ring-red-400"
            : "border-slate-300 focus:border-teal-600 focus:ring-teal-600/30",
          className,
        )}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  ),
);
Input.displayName = "Input";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={clsx("mb-1.5 block text-sm font-medium text-slate-700", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  error,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) {
  return (
    <div className="w-full">
      <select
        className={clsx(
          "h-10 w-full appearance-none rounded-lg border bg-white px-3 text-sm text-slate-900",
          "focus:outline-none focus:ring-2 focus:ring-offset-1",
          error
            ? "border-red-400 focus:ring-red-400"
            : "border-slate-300 focus:border-teal-600 focus:ring-teal-600/30",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
