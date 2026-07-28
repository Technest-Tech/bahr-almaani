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

export type TemplateKind = "letterhead" | "stamp";

export type PlacementPages = "all" | "first" | "last";

export type PlacementAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type PlacementLayer = "background" | "foreground";

/** Physical page geometry (mm) consumed unchanged by the merge job — see PlacementConfig.php. */
export interface Placement {
  pages: PlacementPages;
  anchor: PlacementAnchor;
  offset_x_mm: number;
  offset_y_mm: number;
  width_mm: number | null;
  opacity: number;
  layer: PlacementLayer;
}

export interface LetterheadTemplate {
  id: number;
  name: string;
  kind: TemplateKind;
  kind_label: string;
  file_name: string;
  mime_type: "image" | "pdf";
  is_active: boolean;
  placement: Placement;
  in_use?: boolean;
  created_by?: { id: number; name: string };
  created_at: string;
}

export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  letterhead: "ترويسة",
  stamp: "ختم",
};

export const PLACEMENT_PAGES_LABELS: Record<PlacementPages, string> = {
  all: "كل الصفحات",
  first: "الصفحة الأولى",
  last: "الصفحة الأخيرة",
};

export const PLACEMENT_ANCHOR_LABELS: Record<PlacementAnchor, string> = {
  "top-left": "أعلى اليسار",
  "top-center": "أعلى الوسط",
  "top-right": "أعلى اليمين",
  "middle-left": "منتصف اليسار",
  "middle-center": "المنتصف",
  "middle-right": "منتصف اليمين",
  "bottom-left": "أسفل اليسار",
  "bottom-center": "أسفل الوسط",
  "bottom-right": "أسفل اليمين",
};

export const PLACEMENT_LAYER_LABELS: Record<PlacementLayer, string> = {
  background: "خلف النص",
  foreground: "فوق النص",
};

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

export interface Assignment {
  id: number;
  status: "active" | "delivered" | "withdrawn";
  claimed_at: string | null;
  delivered_at: string | null;
  work_seconds: number | null;
  withdraw_reason: string | null;
  translator?: { id: number; name: string };
  project?: Project;
}

export interface AppNotification {
  id: string;
  data: {
    type: string;
    project_id?: number;
    code?: string;
    message: string;
  };
  read_at: string | null;
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
  letterhead?: LetterheadTemplate | null;
  stamp?: LetterheadTemplate | null;
  files?: ProjectFile[];
  files_count?: number;
  source_files_count?: number;
  assignment?: Assignment | null;
}

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "مسودة",
  available: "متاح",
  claimed: "قيد التنفيذ",
  delivered: "تم التسليم",
  in_review: "قيد المراجعة",
  revision_requested: "مطلوب تعديل",
  approved: "معتمد",
  completed: "مكتمل",
  archived: "مؤرشف",
  cancelled: "ملغي",
};

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
