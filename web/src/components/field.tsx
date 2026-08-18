import { Label } from "@/components/ui/label";

interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  error?: string;
  /** Guidance shown under the control; an error replaces it rather than stacking. */
  hint?: React.ReactNode;
  children: React.ReactNode;
}

/** Label + control + hint or validation message, consistently spaced. */
export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
