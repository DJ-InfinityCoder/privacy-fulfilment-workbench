"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, Database, RefreshCw, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  Classification,
  DataSourceName,
} from "@/models/model-types";

type InventoryField = {
  name: string;
  classification: Classification;
  valuePreview: string;
  includeInExport: boolean;
  redactionReason?: string;
  deletionEligible: boolean;
  deletionReason?: string;
};

type InventoryItem = {
  source: DataSourceName;
  recordId: string;
  fields: InventoryField[];
  relevance: "DIRECT" | "POSSIBLE" | "UNRELATED";
  notes?: string;
};

type Inventory = {
  version: number;
  status: "DRAFT" | "REVIEWED";
  items: InventoryItem[];
  generatedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  comment?: string;
};

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { message: string };
};

const sourceLabels: Record<DataSourceName, string> = {
  user_profiles: "User profiles",
  support_tickets: "Support tickets",
  activity_logs: "Activity logs",
};

const classificationStyles: Record<Classification, string> = {
  PUBLIC: "border-slate-300 bg-slate-50 text-slate-700",
  PERSONAL: "border-blue-200 bg-blue-50 text-blue-800",
  SENSITIVE: "border-amber-200 bg-amber-50 text-amber-800",
  RESTRICTED: "border-red-200 bg-red-50 text-red-800",
  THIRD_PARTY: "border-orange-200 bg-orange-50 text-orange-800",
  INTERNAL: "border-violet-200 bg-violet-50 text-violet-800",
};

const exportBlocked = new Set<Classification>([
  "RESTRICTED",
  "THIRD_PARTY",
  "INTERNAL",
]);

function isBlocked(field: InventoryField): boolean {
  return exportBlocked.has(field.classification);
}

function itemKey(item: InventoryItem): string {
  return `${item.source}:${item.recordId}`;
}

function fieldKey(item: InventoryItem, field: InventoryField): string {
  return `${itemKey(item)}:${field.name}`;
}

export function InventoryTab({
  requestId,
  onReviewed,
  currentRole = "analyst",
}: {
  requestId: string;
  onReviewed?: () => void;
  currentRole?: string;
}) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [includeSelections, setIncludeSelections] = useState<Record<string, boolean>>({});
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();

  const groupedItems = useMemo(
    () =>
      (["user_profiles", "support_tickets", "activity_logs"] as const).map(
        (source) => ({
          source,
          items: inventory?.items.filter((item) => item.source === source) ?? [],
        }),
      ),
    [inventory],
  );

  useEffect(() => {
    let active = true;
    fetch(`/api/requests/${encodeURIComponent(requestId)}/inventory`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as ApiResponse<Inventory | null>;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error?.message ?? "Inventory could not be loaded.");
        }
        if (active) {
          setInventory(payload.data ?? null);
          setIncludeSelections({});
          setComment(payload.data?.comment ?? "");
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Inventory could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setBusy(false);
        }
      });

    return () => {
      active = false;
    };
  }, [requestId]);

  async function generateInventory() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/requests/${encodeURIComponent(requestId)}/search`,
        { method: "POST" },
      );
      const payload = (await response.json()) as ApiResponse<Inventory>;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Search could not be completed.");
      }
      setInventory(payload.data);
      setIncludeSelections({});
      setComment("");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Search could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function markReviewed() {
    if (!inventory) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const fields = inventory.items.flatMap((item) =>
        item.fields.map((field) => ({
          source: item.source,
          recordId: item.recordId,
          fieldName: field.name,
          includeInExport:
            includeSelections[fieldKey(item, field)] ?? field.includeInExport,
        })),
      );
      const response = await fetch(
        `/api/requests/${encodeURIComponent(requestId)}/inventory/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inventoryVersion: inventory.version,
            fields,
            comment,
          }),
        },
      );
      const payload = (await response.json()) as ApiResponse<Inventory>;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Inventory review could not be saved.");
      }
      setInventory(payload.data);
      setIncludeSelections({});
      onReviewed?.();
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Inventory review could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleField(item: InventoryItem, field: InventoryField, checked: boolean) {
    setIncludeSelections((current) => ({
      ...current,
      [fieldKey(item, field)]: checked,
    }));
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <Database className="size-4" aria-hidden="true" />
            Search and review
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">Data inventory</h2>
          <p className="text-sm text-muted-foreground">
            Field previews are masked. Restricted, internal, and third-party
            fields are excluded from exports by policy.
          </p>
        </div>
        <Button onClick={generateInventory} disabled={busy}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {inventory ? "Regenerate inventory" : "Search data sources"}
        </Button>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Inventory action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!inventory && !busy && (
        <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 p-6 text-center">
          <Database className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">No inventory generated</p>
          <p className="text-sm text-muted-foreground">
            Run a verified search to collect this request&apos;s mock records.
          </p>
        </div>
      )}

      {inventory && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Version {inventory.version}</Badge>
            <Badge variant={inventory.status === "REVIEWED" ? "default" : "secondary"}>
              {inventory.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Generated {new Date(inventory.generatedAt).toLocaleString()}
            </span>
          </div>

          {currentRole === "analyst" && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
              <ShieldCheck className="size-4 shrink-0" />
              <span>
                Role visibility: Logged in as <strong>Analyst</strong>. Restricted organizational risk fields (RESTRICTED) are masked. Switch to Approver to inspect restricted internal metadata.
              </span>
            </div>
          )}

          <div className="space-y-4">
            {groupedItems.map(({ source, items }) => (
              <section key={source} className="overflow-hidden rounded-md border">
                <header className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{sourceLabels[source]}</h3>
                    <Badge variant="outline">{items.length} records</Badge>
                  </div>
                </header>
                {items.length === 0 ? (
                  <p className="px-4 py-5 text-sm text-muted-foreground">
                    No matching mock records.
                  </p>
                ) : (
                  <div className="divide-y">
                    {items.map((item) => (
                      <details key={itemKey(item)} className="group">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 hover:bg-muted/20">
                          <span className="flex min-w-0 items-center gap-2">
                            <ChevronDown
                              className="size-4 shrink-0 transition-transform group-open:rotate-180"
                              aria-hidden="true"
                            />
                            <span className="truncate font-mono text-sm">{item.recordId}</span>
                            <Badge variant="outline">{item.relevance}</Badge>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {item.fields.length} fields
                          </span>
                        </summary>
                        {item.notes && (
                          <p className="px-4 pb-3 text-sm text-amber-800">{item.notes}</p>
                        )}
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Field</TableHead>
                              <TableHead>Classification</TableHead>
                              <TableHead>Masked preview</TableHead>
                              <TableHead>Deletion</TableHead>
                              <TableHead className="text-right">Include in export</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {item.fields.map((field) => {
                              const blocked = isBlocked(field);
                              const checked =
                                includeSelections[fieldKey(item, field)] ??
                                field.includeInExport;
                              const toggle = (
                                <Switch
                                  aria-label={`Include ${field.name} in export`}
                                  checked={checked}
                                  disabled={blocked || inventory.status === "REVIEWED"}
                                  onCheckedChange={(value) =>
                                    toggleField(item, field, value)
                                  }
                                />
                              );
                              return (
                                <TableRow key={fieldKey(item, field)}>
                                  <TableCell className="font-mono text-xs">
                                    {field.name}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant="outline"
                                      className={classificationStyles[field.classification]}
                                    >
                                      {field.classification}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="max-w-xs truncate text-muted-foreground">
                                    {field.classification === "RESTRICTED" && currentRole === "analyst" ? (
                                      <span className="font-mono text-xs italic text-amber-700 dark:text-amber-400">
                                        [RESTRICTED — Approver Role Required]
                                      </span>
                                    ) : (
                                      field.valuePreview
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <span
                                      className={
                                        field.deletionEligible
                                          ? "text-sm text-emerald-700"
                                          : "text-sm text-muted-foreground"
                                      }
                                      title={field.deletionReason}
                                    >
                                      {field.deletionEligible ? "Eligible" : "Blocked"}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {blocked ? (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger
                                            render={<span className="inline-flex cursor-not-allowed" />}
                                          >
                                            {toggle}
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            {field.redactionReason ??
                                              `${field.classification} fields are blocked by policy.`}
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    ) : (
                                      toggle
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </details>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>

          {inventory.status === "DRAFT" ? (
            <div className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <label htmlFor="inventory-review-comment" className="text-sm font-medium">
                  Review comment
                </label>
                <Input
                  id="inventory-review-comment"
                  value={comment}
                  maxLength={2000}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Add a note about this inventory review"
                  disabled={busy}
                />
              </div>
              <Button
                onClick={markReviewed}
                disabled={busy || comment.trim().length === 0}
              >
                <ShieldCheck className="size-4" aria-hidden="true" />
                Mark reviewed
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Reviewed by {inventory.reviewedBy ?? "staff"}
              {inventory.comment ? ` — ${inventory.comment}` : ""}
            </p>
          )}
        </>
      )}
    </section>
  );
}
