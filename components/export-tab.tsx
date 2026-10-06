"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Download, FileCheck2, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Classification, DataSourceName } from "@/models/model-types";
import type { PrivacyExport } from "@/services/export-service";
import type { InventoryItem } from "@/models/DataInventory";

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { message: string };
};

type InventoryResponse = {
  version: number;
  status: "DRAFT" | "REVIEWED";
  items: InventoryItem[];
};

const classificationStyles: Record<Classification, string> = {
  PUBLIC: "border-slate-300 bg-slate-50 text-slate-700",
  PERSONAL: "border-blue-200 bg-blue-50 text-blue-800",
  SENSITIVE: "border-amber-200 bg-amber-50 text-amber-800",
  RESTRICTED: "border-red-200 bg-red-50 text-red-800",
  THIRD_PARTY: "border-orange-200 bg-orange-50 text-orange-800",
  INTERNAL: "border-violet-200 bg-violet-50 text-violet-800",
};

const sourceLabels: Record<DataSourceName, string> = {
  user_profiles: "User profiles",
  support_tickets: "Support tickets",
  activity_logs: "Activity logs",
};

export function ExportTab({ requestId }: { requestId: string }) {
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [exportData, setExportData] = useState<PrivacyExport | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/requests/${encodeURIComponent(requestId)}/inventory`, {
        cache: "no-store",
      }).then(async (response) => {
        const payload = (await response.json()) as ApiResponse<InventoryResponse | null>;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error?.message ?? "Inventory could not be loaded.");
        }
        return payload.data ?? null;
      }),
      fetch(`/api/requests/${encodeURIComponent(requestId)}/export?format=json`, {
        cache: "no-store",
      }).then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json()) as {
            error?: { message?: string };
          };
          throw new Error(payload.error?.message ?? "Approved export is unavailable.");
        }
        return (await response.json()) as PrivacyExport;
      }),
    ])
      .then(([loadedInventory, loadedExport]) => {
        if (active) {
          setInventory(loadedInventory);
          setExportData(loadedExport);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "The export preview could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [requestId]);

  const downloadUrl = (format: "json" | "html") =>
    `/api/requests/${encodeURIComponent(requestId)}/export?format=${format}`;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium text-primary">
          <FileCheck2 className="size-4" aria-hidden="true" />
          Approved export
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">Export package</h2>
        <p className="text-sm text-muted-foreground">
          Export generation requires a reviewed inventory and a current human
          EXPORT approval bound to its included fields.
        </p>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Export unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && (
        <p className="rounded-md border p-5 text-sm text-muted-foreground">
          Preparing redaction preview…
        </p>
      )}

      {inventory && (
        <section className="space-y-3 rounded-md border p-4">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Before redaction</h3>
            <Badge variant="outline">Inventory v{inventory.version}</Badge>
            <Badge variant={inventory.status === "REVIEWED" ? "default" : "secondary"}>
              {inventory.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Previews are already masked. Policy-blocked fields are shown here
            to explain what will be removed.
          </p>
          <div className="space-y-3">
            {inventory.items.map((item) => (
              <details key={`${item.source}:${item.recordId}`} className="rounded-md border">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                  {sourceLabels[item.source]} · {item.recordId}
                </summary>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      <TableHead>Classification</TableHead>
                      <TableHead>Masked preview</TableHead>
                      <TableHead>Export selection</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {item.fields.map((field) => (
                      <TableRow key={field.name}>
                        <TableCell className="font-mono text-xs">{field.name}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={classificationStyles[field.classification]}
                          >
                            {field.classification}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {field.valuePreview}
                        </TableCell>
                        <TableCell>
                          {field.includeInExport ? "Selected" : "Excluded"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            ))}
          </div>
        </section>
      )}

      {exportData && (
        <>
          <section className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-emerald-700" aria-hidden="true" />
              <h3 className="font-semibold">After redaction</h3>
            </div>
            <pre className="max-h-96 overflow-auto rounded-md bg-background p-4 text-xs">
              {JSON.stringify(exportData.includedData, null, 2)}
            </pre>
            <p className="break-all font-mono text-xs text-muted-foreground">
              SHA-256: {exportData.contentHash}
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="font-semibold">Redaction manifest</h3>
            {exportData.redactionManifest.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No fields or text were redacted.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exportData.redactionManifest.map((entry, index) => (
                    <TableRow key={`${entry.source}:${entry.field}:${entry.ruleId}:${index}`}>
                      <TableCell>{sourceLabels[entry.source]}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.field}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.ruleId}</TableCell>
                      <TableCell className="whitespace-normal">{entry.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <a href={downloadUrl("json")} download className={buttonVariants()}>
              <Download className="size-4" aria-hidden="true" />
              Download JSON
            </a>
            <a
              href={downloadUrl("html")}
              download
              className={buttonVariants({ variant: "outline" })}
            >
              <Download className="size-4" aria-hidden="true" />
              Download HTML summary
            </a>
          </div>
          <p className="text-xs text-muted-foreground">{exportData.disclaimer}</p>
        </>
      )}
    </section>
  );
}
