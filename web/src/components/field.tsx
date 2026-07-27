import { Label } from "@/components/ui/label";

interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
}

/** Label + control + validation message, consistently spaced. */
export function Field({ label, htmlFor, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
