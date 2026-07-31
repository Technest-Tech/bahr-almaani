import Link from "next/link";
import { Clock, Mail, MapPin, Phone, Waves } from "lucide-react";
import { COMPANY } from "@/lib/company";

const COLUMNS = [
  {
    title: "الخدمات",
    links: [
      { href: "/#services", label: "الترجمة المعتمدة" },
      { href: "/#services", label: "الترجمة القانونية" },
      { href: "/#services", label: "الترجمة الطبية" },
      { href: "/#services", label: "الترجمة التقنية" },
    ],
  },
  {
    title: "روابط سريعة",
    links: [
      { href: "/request", label: "اطلب عرض سعر" },
      { href: "/track", label: "تتبع طلبك" },
      { href: "/#process", label: "كيف نعمل" },
      { href: "/#faq", label: "أسئلة شائعة" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-700 text-white">
                <Waves className="size-5" />
              </span>
              <span className="grid leading-tight">
                <span className="text-[15px] font-bold">{COMPANY.name}</span>
                <span className="text-[11px] text-muted-foreground">{COMPANY.tagline}</span>
              </span>
            </div>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
              {COMPANY.pitch}
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="text-sm font-semibold">{column.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-[13px] text-muted-foreground transition-colors hover:text-primary"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h3 className="text-sm font-semibold">تواصل معنا</h3>
            <ul className="mt-4 space-y-3 text-[13px] text-muted-foreground">
              <li className="flex items-start gap-2.5">
                <Phone className="mt-0.5 size-4 shrink-0 text-primary" />
                <a href={`tel:${COMPANY.phone.replace(/\s/g, "")}`} dir="ltr" className="hover:text-primary">
                  {COMPANY.phone}
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <Mail className="mt-0.5 size-4 shrink-0 text-primary" />
                <a href={`mailto:${COMPANY.email}`} dir="ltr" className="hover:text-primary">
                  {COMPANY.email}
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{COMPANY.address}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Clock className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{COMPANY.workingHours}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} {COMPANY.name} — جميع الحقوق محفوظة</p>
          <Link href="/login" className="transition-colors hover:text-primary">
            دخول فريق العمل
          </Link>
        </div>
      </div>
    </footer>
  );
}
