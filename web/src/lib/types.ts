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

export interface Client {
  id: number;
  name: string;
  type: "individual" | "company";
  phone: string | null;
  email: string | null;
  notes: string | null;
  projects_count?: number;
  created_at: string;
}

export type ProjectStatus =
  | "draft"
  | "available"
  | "claimed"
  | "delivered"
  | "in_review"
  | "revision_requested"
  | "approved"
  | "completed"
  | "archived"
  | "cancelled";

export type Priority = "normal" | "urgent" | "critical";

export interface ProjectFile {
  id: number;
  category: "source" | "reference" | "deliverable" | "final";
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  word_count: number | null;
  page_count: number | null;
  count_status: "pending" | "processing" | "done" | "failed" | "not_applicable";
  count_source: "auto" | "manual";
  version: number;
  uploaded_by?: { id: number; name: string };
  created_at: string;
}

export interface Transition {
  id: number;
  from_status: ProjectStatus;
  from_label: string;
  to_status: ProjectStatus;
  to_label: string;
  note: string | null;
  actor: { id: number; name: string } | null;
  created_at: string;
}

export interface Project {
  id: number;
  code: string;
  title: string;
  status: ProjectStatus;
  status_label: string;
  priority: Priority;
  service_type: "certified" | "regular";
  country_code: string | null;
  declared_pages: number | null;
  total_words: number | null;
  total_pages: number | null;
  deadline_at: string;
  is_late: boolean;
  instructions: string | null;
  quoted_amount: string | null;
  currency: string;
  published_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  client?: Client | null;
  source_language?: Language;
  target_language?: Language;
  creator?: { id: number; name: string };
  files?: ProjectFile[];
  files_count?: number;
}

export const STATUS_TONES: Record<ProjectStatus, "green" | "red" | "slate" | "teal" | "amber" | "blue"> = {
  draft: "slate",
  available: "blue",
  claimed: "amber",
  delivered: "teal",
  in_review: "amber",
  revision_requested: "red",
  approved: "teal",
  completed: "green",
  archived: "slate",
  cancelled: "red",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  normal: "عادي",
  urgent: "عاجل",
  critical: "حرج",
};

export const PRIORITY_TONES: Record<Priority, "slate" | "amber" | "red"> = {
  normal: "slate",
  urgent: "amber",
  critical: "red",
};

export const COUNT_STATUS_LABELS: Record<ProjectFile["count_status"], string> = {
  pending: "بانتظار العد",
  processing: "جارِ العد…",
  done: "تم العد",
  failed: "فشل العد",
  not_applicable: "يتطلب عداً يدوياً",
};
