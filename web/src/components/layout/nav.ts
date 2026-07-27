import {
  Contact,
  FolderKanban,
  Inbox,
  LayoutDashboard,
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
  { href: "/", label: "لوحة التحكم", icon: LayoutDashboard, permission: null },
  { href: "/portal", label: "بورتال المترجم", icon: Inbox, permission: "portal.access" },
  { href: "/projects", label: "المشاريع", icon: FolderKanban, permission: "projects.view" },
  { href: "/clients", label: "العملاء", icon: Contact, permission: "clients.view" },
  { href: "/users", label: "المستخدمون", icon: Users, permission: "users.view" },
];

/** Breadcrumb labels by path segment. Dynamic segments resolve to a generic label. */
export const BREADCRUMB_LABELS: Record<string, string> = {
  "": "لوحة التحكم",
  portal: "بورتال المترجم",
  projects: "المشاريع",
  new: "مشروع جديد",
  clients: "العملاء",
  users: "المستخدمون",
};
