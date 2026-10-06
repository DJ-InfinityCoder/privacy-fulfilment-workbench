"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ClipboardList,
  Database,
  FilePlus2,
  ShieldCheck,
} from "lucide-react";
import { cn } from "cn";

const navigationItems = [
  {
    href: "/",
    label: "Dashboard",
    icon: Activity,
    exact: true,
  },
  {
    href: "/requests/new",
    label: "New Request",
    icon: FilePlus2,
    exact: true,
  },
  {
    href: "/sources",
    label: "Data Sources",
    icon: Database,
    exact: false,
  },
  {
    href: "/audit",
    label: "Audit Log",
    icon: ClipboardList,
    exact: false,
  },
  {
    href: "/policy",
    label: "Policy",
    icon: ShieldCheck,
    exact: false,
  },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
      <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Workspace
      </p>
      {navigationItems.map(({ href, label, icon: Icon, exact }) => {
        const isActive = exact
          ? pathname === href
          : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
              isActive
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon
              className={cn("size-4 shrink-0", isActive ? "text-foreground" : "text-muted-foreground")}
              aria-hidden="true"
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
