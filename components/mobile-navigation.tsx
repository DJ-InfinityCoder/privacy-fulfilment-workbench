"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ClipboardList,
  Database,
  FilePlus2,
  Menu,
  ShieldCheck,
} from "lucide-react";
import { cn } from "cn";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navigation = [
  { href: "/", label: "Dashboard", icon: Activity, exact: true },
  { href: "/requests/new", label: "New Request", icon: FilePlus2, exact: true },
  { href: "/sources", label: "Data Sources", icon: Database, exact: false },
  { href: "/audit", label: "Audit Log", icon: ClipboardList, exact: false },
  { href: "/policy", label: "Policy", icon: ShieldCheck, exact: false },
] as const;

export function MobileNavigation() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open navigation menu"
        className="inline-flex size-9 items-center justify-center rounded-md border bg-background text-foreground hover:bg-muted md:hidden"
      >
        <Menu className="size-4" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="left" className="w-[min(20rem,85vw)]">
        <SheetHeader>
          <SheetTitle>Privacy Workbench</SheetTitle>
          <SheetDescription>Internal operations console · Mock data</SheetDescription>
        </SheetHeader>
        <nav aria-label="Mobile navigation" className="flex flex-col gap-1 px-4">
          {navigation.map(({ href, label, icon: Icon, exact }) => {
            const isActive = exact
              ? pathname === href
              : pathname === href || pathname.startsWith(`${href}/`);

            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                  isActive
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    isActive ? "text-foreground" : "text-muted-foreground"
                  )}
                  aria-hidden="true"
                />
                {label}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
