"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { demoUsers, mockRoles, type MockRole } from "@/lib/mock-auth-types";

export function RoleSwitcher({ initialRole }: { initialRole: MockRole }) {
  const router = useRouter();
  const [role, setRole] = useState(initialRole);
  const [saving, setSaving] = useState(false);

  async function changeRole(value: string | null) {
    if (!value || !(mockRoles as readonly string[]).includes(value as MockRole)) {
      return;
    }
    const nextRole = value as MockRole;
    setSaving(true);
    try {
      const response = await fetch("/api/auth/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!response.ok) {
        throw new Error("Role switch failed.");
      }
      setRole(nextRole);
      router.refresh();
    } catch {
      toast.error("Could not switch the mock role. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const isAnalyst = role === "analyst";

  return (
    <div className="flex items-center">
      <Select value={role} onValueChange={changeRole} disabled={saving}>
        <SelectTrigger
          size="sm"
          aria-label={`Current role: ${demoUsers[role]?.name ?? role}`}
          title="Switch demo actor role (Asha / Rahul)"
          className="h-8 gap-2 rounded-md border border-border/80 bg-background/80 px-2.5 text-xs shadow-2xs hover:bg-muted/40"
        >
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex size-4.5 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-2xs",
                isAnalyst ? "bg-indigo-600" : "bg-violet-600"
              )}
            >
              {isAnalyst ? "A" : "R"}
            </span>
            <span className="font-semibold text-foreground">
              {isAnalyst ? "Asha" : "Rahul"}
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                isAnalyst
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                  : "bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
              )}
            >
              {isAnalyst ? "Analyst" : "Approver"}
            </span>
          </div>
        </SelectTrigger>
        <SelectContent align="end" className="w-56 rounded-md p-1">
          <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
            Switch Demo Role
          </div>
          <SelectItem value="analyst" className="rounded-md py-1.5">
            <div className="flex items-center gap-2">
              <span className="flex size-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                A
              </span>
              <div className="text-left">
                <p className="text-xs font-semibold leading-tight text-foreground">
                  Asha (Analyst)
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Intake, Discovery & Execution
                </p>
              </div>
            </div>
          </SelectItem>
          <SelectItem value="approver" className="rounded-md py-1.5">
            <div className="flex items-center gap-2">
              <span className="flex size-5 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
                R
              </span>
              <div className="text-left">
                <p className="text-xs font-semibold leading-tight text-foreground">
                  Rahul (Approver)
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Four-Eyes Approvals & Overrides
                </p>
              </div>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
