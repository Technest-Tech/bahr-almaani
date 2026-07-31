"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Contact, FolderKanban, MailOpen, Users } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { NAV_ITEMS } from "@/components/layout/nav";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { looseMatch } from "@/lib/format";
import type { Client, Paginated, Project, QuoteRequest, User } from "@/lib/types";

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const { can } = useAuth();
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) setQuery("");
    onOpenChange(isOpen);
  }

  const enabled = open && q.length >= 2;

  const { data: projects } = useQuery({
    queryKey: ["palette-projects", q],
    queryFn: () =>
      api<Paginated<Project>>(`/projects?q=${encodeURIComponent(q)}&per_page=5`).then((r) => r.data),
    enabled: enabled && can("projects.view"),
  });

  const { data: clients } = useQuery({
    queryKey: ["palette-clients", q],
    queryFn: () =>
      api<Paginated<Client>>(`/clients?q=${encodeURIComponent(q)}&per_page=5`).then((r) => r.data),
    enabled: enabled && can("clients.view"),
  });

  const { data: quotes } = useQuery({
    queryKey: ["palette-quotes", q],
    queryFn: () =>
      api<Paginated<QuoteRequest>>(`/quote-requests?q=${encodeURIComponent(q)}&per_page=5`).then(
        (r) => r.data,
      ),
    enabled: enabled && can("quotes.view"),
  });

  const { data: users } = useQuery({
    queryKey: ["palette-users", q],
    queryFn: () =>
      api<Paginated<User>>(`/users?q=${encodeURIComponent(q)}&per_page=5`).then((r) => r.data),
    enabled: enabled && can("users.view"),
  });

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  const navItems = NAV_ITEMS.filter((item) => !item.permission || can(item.permission)).filter(
    (item) => looseMatch(item.label, q),
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="بحث سريع"
      description="ابحث في المشاريع والعملاء والمستخدمين"
      shouldFilter={false}
    >
      <CommandInput
        placeholder="ابحث أو انتقل إلى…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>لا توجد نتائج</CommandEmpty>

        {!!navItems.length && (
          <CommandGroup heading="التنقل">
            {navItems.map((item) => (
              <CommandItem key={item.href} value={`nav-${item.href}`} onSelect={() => go(item.href)}>
                <item.icon className="size-4" />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!!projects?.length && (
          <>
            <CommandSeparator />
            <CommandGroup heading="المشاريع">
              {projects.map((project) => (
                <CommandItem
                  key={`p-${project.id}`}
                  value={`project-${project.id}`}
                  onSelect={() => go(`/projects/${project.id}`)}
                >
                  <FolderKanban className="size-4" />
                  <span className="flex-1 truncate">{project.title}</span>
                  <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                    {project.code}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {!!quotes?.length && (
          <>
            <CommandSeparator />
            <CommandGroup heading="طلبات التسعير">
              {quotes.map((quote) => (
                <CommandItem
                  key={`q-${quote.id}`}
                  value={`quote-${quote.id}`}
                  onSelect={() => go(`/quotes/${quote.id}`)}
                >
                  <MailOpen className="size-4" />
                  <span className="flex-1 truncate">{quote.title}</span>
                  <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                    {quote.reference}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {!!clients?.length && (
          <>
            <CommandSeparator />
            <CommandGroup heading="العملاء">
              {clients.map((client) => (
                <CommandItem
                  key={`c-${client.id}`}
                  value={`client-${client.id}`}
                  onSelect={() => go("/clients")}
                >
                  <Contact className="size-4" />
                  {client.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {!!users?.length && (
          <>
            <CommandSeparator />
            <CommandGroup heading="المستخدمون">
              {users.map((user) => (
                <CommandItem
                  key={`u-${user.id}`}
                  value={`user-${user.id}`}
                  onSelect={() => go("/users")}
                >
                  <Users className="size-4" />
                  <span className="flex-1 truncate">{user.name}</span>
                  <span dir="ltr" className="text-xs text-muted-foreground">{user.email}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
