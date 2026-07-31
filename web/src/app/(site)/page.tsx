import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Clock3,
  FileSearch,
  FileText,
  Gavel,
  GraduationCap,
  Languages,
  Lock,
  MessageSquareQuote,
  Plus,
  Search,
  Send,
  Stamp,
  Stethoscope,
  Timer,
  Upload,
  Users,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { COMPANY } from "@/lib/company";

const SERVICES = [
  {
    icon: Stamp,
    title: "الترجمة المعتمدة",
    description:
      "مستندات رسمية بترويسة المكتب وختمه المعتمد، مقبولة لدى الجهات الحكومية والسفارات والقنصليات.",
  },
  {
    icon: Gavel,
    title: "الترجمة القانونية",
    description:
      "عقود، توكيلات، أحكام قضائية ولوائح — بمترجمين متخصصين في الصياغة القانونية ومصطلحاتها.",
  },
  {
    icon: Stethoscope,
    title: "الترجمة الطبية",
    description:
      "تقارير طبية، نشرات دوائية وأبحاث سريرية، بدقة تحفظ المعنى العلمي ولا تحتمل التأويل.",
  },
  {
    icon: Wrench,
    title: "الترجمة التقنية",
    description:
      "كتيبات تشغيل، مواصفات فنية وكراسات شروط، مع بناء قاموس مصطلحات ثابت لكل عميل.",
  },
  {
    icon: GraduationCap,
    title: "الشهادات والوثائق",
    description:
      "شهادات ميلاد وتخرج وسجلات أكاديمية وكشوف درجات — جاهزة للتقديم والمعادلة.",
  },
  {
    icon: Building2,
    title: "خدمات الشركات",
    description:
      "حسابات مؤسسية بأسعار متفق عليها، وفريق ثابت يعرف مصطلحات نشاطك ويلتزم بهويته اللغوية.",
  },
];

const STEPS = [
  {
    icon: Upload,
    title: "أرسل ملفاتك",
    description:
      "ارفع المستندات عبر النموذج، حدّد اللغة والأولوية، واذكر أي تعليمات خاصة. لا حاجة لحساب.",
  },
  {
    icon: FileSearch,
    title: "نُقدّر ونُسعّر",
    description:
      "يراجع فريقنا الملفات ويحسب عدد الكلمات والصفحات، ثم يحدد التكلفة ومدة التنفيذ الدقيقة.",
  },
  {
    icon: Send,
    title: "يصلك العرض",
    description:
      "نرسل عرض السعر على بريدك، ويمكنك مراجعته في أي وقت برقم المتابعة الذي حصلت عليه.",
  },
  {
    icon: BadgeCheck,
    title: "التنفيذ والتسليم",
    description:
      "بعد موافقتك يبدأ مترجم متخصص، يمرّ العمل على مراجع، ثم يُسلَّم موثقاً بالترويسة والختم.",
  },
];

const REASONS = [
  {
    icon: Users,
    title: "مترجمون متخصصون لا عموميون",
    description:
      "يوزَّع كل ملف على مترجم يعمل في مجاله وزوجه اللغوي فقط، ثم يراجعه مدقق مستقل قبل التسليم.",
  },
  {
    icon: Timer,
    title: "مواعيد تُحترم فعلاً",
    description:
      "نظامنا الداخلي يتابع كل ملف لحظياً وينبّه قبل اقتراب الموعد — لا مفاجآت يوم التسليم.",
  },
  {
    icon: Lock,
    title: "سرية كاملة لمستنداتك",
    description:
      "ملفاتك محفوظة على خوادم مؤمّنة ولا يصل إليها إلا من يعمل عليها. نوقّع اتفاقية سرية عند الطلب.",
  },
  {
    icon: Languages,
    title: "اتساق المصطلح عبر الوقت",
    description:
      "نبني ذاكرة ترجمة وقاموس مصطلحات لكل عميل، فتخرج مستنداتك بلغة واحدة مهما تعدد المترجمون.",
  },
  {
    icon: FileText,
    title: "تنسيق مطابق للأصل",
    description:
      "نُخرج المستند بالشكل نفسه — جداول، أختام، تواقيع ومخططات — لا نصاً مجرداً من سياقه.",
  },
  {
    icon: MessageSquareQuote,
    title: "تسعير واضح قبل البدء",
    description:
      "تعرف التكلفة والمدة قبل أن نبدأ. لا رسوم تظهر لاحقاً ولا تقديرات مفتوحة.",
  },
];

const LANGUAGES = [
  "العربية", "الإنجليزية", "الفرنسية", "الألمانية", "الإسبانية", "الإيطالية",
  "التركية", "الروسية", "الصينية", "اليابانية", "الكورية", "الفارسية",
  "العبرية", "الهولندية", "البرتغالية", "الأوردية",
];

const FAQ = [
  {
    question: "ما الفرق بين الترجمة المعتمدة والعادية؟",
    answer:
      "الترجمة المعتمدة تصدر على ترويسة المكتب وتحمل ختمه وتوقيعه، وتُقبل رسمياً لدى الجهات الحكومية والسفارات. الترجمة العادية تصلح للاستخدام الداخلي والاطلاع دون صفة رسمية.",
  },
  {
    question: "كم يستغرق تنفيذ الطلب؟",
    answer:
      "يعتمد على حجم المستند وتخصصه. المستندات الشخصية القصيرة تُسلَّم غالباً خلال يوم إلى يومي عمل، والمشاريع الكبيرة تُجدول حسب حجمها. نحدد المدة بدقة في عرض السعر قبل البدء، ولدينا خدمة تنفيذ عاجل عند الحاجة.",
  },
  {
    question: "كيف تُحسب التكلفة؟",
    answer:
      "على أساس عدد الكلمات أو الصفحات، وزوج اللغات، ودرجة التخصص، والأولوية المطلوبة. نحسب ذلك من ملفاتك فعلياً — لا تقدير جزافي — ونرسل رقماً نهائياً لا يتغير بعد موافقتك.",
  },
  {
    question: "هل مستنداتي في أمان؟",
    answer:
      "نعم. الملفات محفوظة على خوادم مؤمّنة، والوصول مقصور على المترجم والمراجع المكلّفين بالعمل، وكل إجراء مسجّل في سجل تدقيق. ونوقّع اتفاقية عدم إفصاح (NDA) عند طلبك.",
  },
  {
    question: "ماذا لو لم يكن لديّ الملف بصيغة إلكترونية؟",
    answer:
      "أرفق صورة واضحة بالهاتف أو نسخة ممسوحة ضوئياً. نتعامل مع المستندات الممسوحة والمكتوبة بخط اليد، ونحسب عدد صفحاتها يدوياً عند الحاجة.",
  },
  {
    question: "هل أحتاج إلى حساب لإرسال طلب؟",
    answer:
      "لا. أرسل طلبك مباشرة من الموقع واحتفظ برقم المتابعة الذي يظهر لك فور الإرسال — به وحده تتابع حالة طلبك وعرض السعر في أي وقت.",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,--theme(--color-primary/12%),transparent_60%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 start-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
        />

        <div className="relative mx-auto w-full max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1.5 text-xs font-medium text-primary">
              <BadgeCheck className="size-3.5" />
              مكتب ترجمة معتمد — ختم وترويسة مقبولان رسمياً
            </span>

            <h1 className="mt-6 text-balance text-4xl font-extrabold leading-[1.15] tracking-tight sm:text-5xl lg:text-6xl">
              ترجمة معتمدة
              <span className="bg-gradient-to-l from-teal-500 to-teal-700 bg-clip-text text-transparent dark:from-teal-300 dark:to-teal-500">
                {" "}تُقبل من أول مرة
              </span>
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              {COMPANY.pitch}
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" asChild className="h-12 px-7 text-[15px]">
                <Link href="/request">
                  أرسل ملفك واحصل على عرض سعر
                  <ArrowLeft className="size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="h-12 px-7 text-[15px]">
                <Link href="/track">
                  <Search className="size-4" />
                  تتبع طلباً سابقاً
                </Link>
              </Button>
            </div>

            <p className="mt-5 text-xs text-muted-foreground">
              بدون حساب · الرد عادةً خلال ساعات العمل · ملفاتك تبقى سرية
            </p>
          </div>

          {/* Stats strip */}
          <dl className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border shadow-sm md:grid-cols-4">
            {COMPANY.stats.map((stat) => (
              <div key={stat.label} className="bg-card px-6 py-7 text-center">
                <dt className="text-3xl font-extrabold tracking-tight text-primary">
                  {stat.value}
                </dt>
                <dd className="mt-1.5 text-[13px] text-muted-foreground">{stat.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Services ─────────────────────────────────────────────────────── */}
      <section id="services" className="scroll-mt-20 border-t bg-muted/30 py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="خدماتنا"
            title="كل ما تحتاج ترجمته، في مكان واحد"
            description="من شهادة ميلاد من صفحة واحدة إلى كراسة شروط من مئات الصفحات — الفريق نفسه والمعيار نفسه."
          />

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((service) => (
              <div
                key={service.title}
                className="group rounded-2xl border bg-card p-6 transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
                  <service.icon className="size-5" />
                </span>
                <h3 className="mt-4 text-base font-semibold">{service.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                  {service.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Process ──────────────────────────────────────────────────────── */}
      <section id="process" className="scroll-mt-20 py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="كيف نعمل"
            title="أربع خطوات من الملف إلى المستند المعتمد"
            description="مسار واضح من لحظة إرسال الملف حتى تسلّمه موثقاً — تعرف في أي مرحلة أنت في كل وقت."
          />

          <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative">
                {/* Connector — drawn RTL, hidden on the last card and on small screens */}
                {index < STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute -start-3 top-6 hidden h-px w-6 bg-border lg:block"
                  />
                )}
                <div className="h-full rounded-2xl border bg-card p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/25">
                      <step.icon className="size-5" />
                    </span>
                    <span className="text-3xl font-extrabold text-muted-foreground/25 tabular-nums">
                      {(index + 1).toLocaleString("ar-EG")}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-10 flex justify-center">
            <Button size="lg" asChild className="h-11 px-6">
              <Link href="/request">
                ابدأ الخطوة الأولى
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Why us ───────────────────────────────────────────────────────── */}
      <section id="why" className="scroll-mt-20 border-t bg-muted/30 py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="لماذا بحر المعاني"
            title="الفرق بين ترجمة صحيحة وترجمة تُقبل"
            description="الدقة اللغوية شرط لازم لا كافٍ — ما يلي هو ما نضيفه فوقها."
          />

          <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {REASONS.map((reason) => (
              <div key={reason.title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <reason.icon className="size-5" />
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold">{reason.title}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                    {reason.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Languages ────────────────────────────────────────────────────── */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="اللغات"
            title="نترجم من وإلى أكثر من ٤٠ لغة"
            description="لا ترى لغتك في القائمة؟ أرسل طلبك ونتحقق من توفر المترجم المناسب لك."
          />

          <div className="mt-10 flex flex-wrap justify-center gap-2.5">
            {LANGUAGES.map((language) => (
              <span
                key={language}
                className="rounded-full border bg-card px-4 py-2 text-[13px] font-medium transition-colors hover:border-primary/40 hover:text-primary"
              >
                {language}
              </span>
            ))}
            <span className="rounded-full border border-dashed px-4 py-2 text-[13px] text-muted-foreground">
              ولغات أخرى…
            </span>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="scroll-mt-20 border-t bg-muted/30 py-20">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="أسئلة شائعة"
            title="ما يسأل عنه عملاؤنا عادةً"
            description="لم تجد إجابتك؟ اذكر سؤالك في خانة التفاصيل عند إرسال الطلب."
          />

          <div className="mt-10 divide-y overflow-hidden rounded-2xl border bg-card">
            {FAQ.map((item) => (
              // Native <details> — accessible and keyboard-operable without JS.
              <details key={item.question} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
                  {item.question}
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-transform group-open:rotate-45">
                    <Plus className="size-3.5" />
                  </span>
                </summary>
                <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────────── */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl bg-sidebar px-6 py-16 text-center">
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-24 start-1/2 size-[30rem] -translate-x-1/2 rounded-full bg-teal-400/20 blur-3xl"
            />
            <div className="relative mx-auto max-w-2xl">
              <h2 className="text-balance text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                أرسل ملفك الآن، واحصل على السعر والمدة
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-pretty text-[15px] leading-relaxed text-sidebar-foreground/80">
                يستغرق الأمر دقيقتين. سيصلك رقم متابعة فوراً تستخدمه لمعرفة عرض السعر
                وحالة طلبك في أي وقت.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button size="lg" asChild className="h-12 px-7 text-[15px]">
                  <Link href="/request">
                    اطلب عرض سعر مجاني
                    <ArrowLeft className="size-4" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="h-12 border-white/25 bg-transparent px-7 text-[15px] text-white hover:bg-white/10 hover:text-white"
                >
                  <Link href="/track">
                    <Clock3 className="size-4" />
                    لديّ رقم متابعة
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
      <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      <p className="mt-4 text-pretty text-[15px] leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
