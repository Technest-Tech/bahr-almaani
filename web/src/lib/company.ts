/**
 * Public-site copy that the office owns, not the developers.
 *
 * Everything a non-developer is likely to want changed on the marketing pages
 * lives here so it is one edit away — phone numbers, addresses, working hours
 * and the headline figures. Replace the placeholders before going live.
 */
export const COMPANY = {
  name: "بحر المعاني",
  tagline: "للترجمة المعتمدة",
  /** One sentence, used in the hero and the page description meta. */
  pitch: "مكتب ترجمة معتمد يحوّل مستنداتك إلى نسخة رسمية مقبولة لدى الجهات الحكومية والسفارات — بدقة لغوية وتسليم في الموعد.",

  email: "info@bahr-almaaani.com",
  phone: "+20 100 000 0000",
  whatsapp: "+20 100 000 0000",
  address: "القاهرة — جمهورية مصر العربية",
  workingHours: "السبت – الخميس، ٩ ص – ٦ م",

  /** Headline numbers on the landing page. Keep them honest — they are a claim. */
  stats: [
    { value: "+١٥", label: "عاماً من الخبرة" },
    { value: "+١٠٠", label: "مترجم ومراجع" },
    { value: "+٤٠", label: "لغة وزوج لغوي" },
    { value: "٪٩٨", label: "تسليم في الموعد" },
  ],
} as const;
