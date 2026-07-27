interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

/** Stripe-style settings section: sticky explainer column + fields column. */
export function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <section className="grid gap-5 px-6 py-6 md:grid-cols-[210px_1fr] md:gap-10">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="grid max-w-xl content-start gap-4">{children}</div>
    </section>
  );
}
