export type Role = "admin" | "project_manager" | "translator" | "accountant";

export interface Language {
  id: number;
  code: string;
  name_ar: string;
  name_en: string;
  is_rtl: boolean;
}

export interface LanguagePair {
  id: number;
  source_language_id: number;
  target_language_id: number;
  source_language?: Language;
  target_language?: Language;
}

export interface User {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  status: "active" | "suspended";
  locale: string;
  last_login_at: string | null;
  created_at: string;
  roles: Role[];
  language_pairs?: LanguagePair[];
}

export interface Paginated<T> {
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "الإدارة",
  project_manager: "مدير مشاريع",
  translator: "مترجم",
  accountant: "محاسب",
};
