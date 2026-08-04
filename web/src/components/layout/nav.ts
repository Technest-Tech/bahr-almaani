import {
  BarChart3,
  CalendarCheck,
  Contact,
  FolderKanban,
  History,
  Inbox,
  LayoutDashboard,
  MailOpen,
  Stamp,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: string | null;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard, permission: null },
  { href: "/portal", label: "بورتال المترجم", icon: Inbox, permission: "portal.access" },
  { href: "/daily-words", label: "إنتاجي اليومي", icon: CalendarCheck, permission: "portal.access" },
  { href: "/quotes", label: "طلبات التسعير", icon: MailOpen, permission: "quotes.view" },
  { href: "/projects", label: "المشاريع", icon: FolderKanban, permission: "projects.view" },
  { href: "/clients", label: "العملاء", icon: Contact, permission: "clients.view" },
  { href: "/users", label: "المستخدمون", icon: Users, permission: "users.view" },
  { href: "/reports", label: "التقارير", icon: BarChart3, permission: "reports.view" },
  { href: "/letterheads", label: "الترويسات والأختام", icon: Stamp, permission: "letterheads.view" },
  { href: "/activity", label: "سجل النشاط", icon: History, permission: "activity-log.view" },
];

/** Breadcrumb labels by path segment. Dynamic segments resolve to a generic label. */
export const BREADCRUMB_LABELS: Record<string, string> = {
  "": "لوحة التحكم",
  dashboard: "لوحة التحكم",
  portal: "بورتال المترجم",
  "daily-words": "إنتاجي اليومي",
  quotes: "طلبات التسعير",
  projects: "المشاريع",
  new: "مشروع جديد",
  clients: "العملاء",
  users: "المستخدمون",
  reports: "التقارير",
  letterheads: "الترويسات والأختام",
  activity: "سجل النشاط",
  settings: "الإعدادات",
};
