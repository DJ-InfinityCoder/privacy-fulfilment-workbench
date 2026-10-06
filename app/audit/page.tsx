import { ClipboardList, Filter } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AuditTable, type AuditTableEvent } from "@/components/audit-table";
import { AuditFilterBar } from "@/components/audit-filter-bar";
import { auditEventTypes } from "@/models/model-types";
import { listAudit } from "@/services/audit-service";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isAuditEventType(value: string | undefined): value is (typeof auditEventTypes)[number] {
  return value !== undefined && (auditEventTypes as readonly string[]).includes(value);
}

function isAuditStatus(value: string | undefined): value is "ok" | "error" | "denied" {
  return value === "ok" || value === "error" || value === "denied";
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const rawEventType = first(params.eventType);
  const rawStatus = first(params.status);
  const page = Math.max(1, Number(first(params.page) ?? "1") || 1);
  const pageSize = 25;
  const filters = {
    requestId: first(params.requestId)?.trim() || undefined,
    eventType: isAuditEventType(rawEventType) ? rawEventType : undefined,
    status: isAuditStatus(rawStatus) ? rawStatus : undefined,
  };
  const result = await listAudit({ ...filters, page, pageSize });
  const events: AuditTableEvent[] = result.events.map((event) => ({
    id: String((event as typeof event & { _id?: unknown })._id ?? event.seq),
    seq: event.seq,
    requestId: event.requestId,
    actorType: event.actorType,
    actorId: event.actorId,
    eventType: event.eventType,
    status: event.status,
    at: new Date(event.at).toISOString(),
    toolName: event.toolName,
    input: event.input,
    output: event.output,
    error: event.error,
    prevHash: event.prevHash,
    hash: event.hash,
  }));
  const previousHref = new URLSearchParams({
    ...(filters.requestId ? { requestId: filters.requestId } : {}),
    ...(filters.eventType ? { eventType: filters.eventType } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    page: String(Math.max(1, page - 1)),
  });
  const nextHref = new URLSearchParams({
    ...(filters.requestId ? { requestId: filters.requestId } : {}),
    ...(filters.eventType ? { eventType: filters.eventType } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    page: String(page + 1),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-medium text-primary">
          <ClipboardList className="size-4" aria-hidden="true" />
          Append-only event stream
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Audit log</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Review sanitized workflow activity, trace state changes, and verify the hash chain.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="size-4 text-primary" aria-hidden="true" />
            Filter events
          </CardTitle>
          <CardDescription>
            Filter by request, event type, or outcome. Event detail values are sanitized before storage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditFilterBar
            initialRequestId={filters.requestId}
            initialEventType={filters.eventType}
            initialStatus={filters.status}
            auditEventTypes={auditEventTypes}
          />
          {(rawEventType && !filters.eventType) || (rawStatus && !filters.status) ? (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
              An unsupported filter was ignored.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Audit events</CardTitle>
            <CardDescription className="mt-1">
              Showing page {result.page} of {Math.max(result.totalPages, 1)} · {result.total} total events
            </CardDescription>
          </div>
          <Badge variant="outline">Hash chained</Badge>
        </CardHeader>
        <CardContent>
          <AuditTable events={events} />
          <div className="mt-4 flex items-center justify-between border-t pt-4">
            <Link
              href={`?${previousHref.toString()}`}
              className={buttonVariants({
                variant: "outline",
                className: page <= 1 ? "pointer-events-none opacity-50" : "",
              })}
              aria-disabled={page <= 1}
            >
              Previous
            </Link>
            <span className="text-xs text-muted-foreground">
              Page {result.page} of {Math.max(result.totalPages, 1)}
            </span>
            <Link
              href={`?${nextHref.toString()}`}
              className={buttonVariants({
                variant: "outline",
                className: page >= result.totalPages ? "pointer-events-none opacity-50" : "",
              })}
              aria-disabled={page >= result.totalPages}
            >
              Next
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
