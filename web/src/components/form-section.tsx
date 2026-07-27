interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

/** Stripe-style settings section: explainer column + fields spanning the remaining width. */
export function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <section className="grid gap-5 px-6 py-6 lg:grid-cols-[240px_1fr] lg:gap-12">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="grid content-start gap-4">{children}</div>
    </section>
  );
}
