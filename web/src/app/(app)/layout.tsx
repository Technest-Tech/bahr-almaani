"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect } from "react";
import {
  Contact,
  FolderKanban,
  LayoutDashboard,
  Loader2,
  LogOut,
  Users,
  Waves,
} from "lucide-react";
import { clsx } from "clsx";
import { useAuth } from "@/lib/auth";
import { ROLE_LABELS, type Role } from "@/lib/types";

const NAV_ITEMS = [
  { href: "/", label: "لوحة التحكم", icon: LayoutDashboard, permission: null },
  { href: "/projects", label: "المشاريع", icon: FolderKanban, permission: "projects.view" },
  { href: "/clients", label: "العملاء", icon: Contact, permission: "clients.view" },
  { href: "/users", label: "المستخدمون", icon: Users, permission: "users.view" },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, can, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-teal-700" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 start-0 z-40 flex w-64 flex-col border-e border-slate-200 bg-white">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-teal-700 text-white">
            <Waves className="size-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">بحر المعاني</p>
            <p className="text-[11px] text-slate-400">إدارة خدمات الترجمة</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.filter((item) => !item.permission || can(item.permission)).map(
            (item) => {
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-teal-50 text-teal-800"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  <item.icon className="size-4.5 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                </Link>
              );
            },
          )}
        </nav>

        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
              {user.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{user.name}</p>
              <p className="truncate text-xs text-slate-400">
                {user.roles.map((r) => ROLE_LABELS[r as Role] ?? r).join("، ")}
              </p>
            </div>
            <button
              onClick={() => logout().then(() => router.replace("/login"))}
              className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
              title="تسجيل الخروج"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="ms-64 flex-1 p-6 lg:p-8">{children}</main>
    </div>
  );
}
