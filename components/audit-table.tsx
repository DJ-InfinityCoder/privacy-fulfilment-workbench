"use client";

import { useState } from "react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export type AuditTableEvent = {
  id: string;
  seq: number;
  requestId?: string;
  actorType: string;
  actorId: string;
  eventType: string;
  status: "ok" | "error" | "denied";
  at: string;
  toolName?: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
  prevHash: string;
  hash: string;
};

function statusVariant(status: AuditTableEvent["status"]) {
  if (status === "error") return "destructive" as const;
  if (status === "denied") return "secondary" as const;
  return "outline" as const;
}

export function AuditTable({ events }: { events: AuditTableEvent[] }) {
  const [selected, setSelected] = useState<AuditTableEvent | null>(null);
  const [verifyState, setVerifyState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success"; valid: boolean; brokenAtSeq: number | null }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function verifyChain() {
    setVerifyState({ kind: "loading" });
    try {
      const response = await fetch("/api/audit/verify", { cache: "no-store" });
      const payload: unknown = await response.json();
      const parsed = z.object({
        ok: z.boolean(),
        data: z.object({
          valid: z.boolean(),
          brokenAtSeq: z.number().nullable(),
        }).optional(),
        error: z.object({ message: z.string() }).optional(),
      }).safeParse(payload);
      if (!response.ok || !parsed.success || !parsed.data.ok || !parsed.data.data) {
        throw new Error(
          parsed.success
            ? parsed.data.error?.message ?? "Could not verify the audit chain."
            : "The server returned an invalid verification response.",
        );
      }
      setVerifyState({
        kind: "success",
        valid: parsed.data.data.valid,
        brokenAtSeq: parsed.data.data.brokenAtSeq,
      });
    } catch (error: unknown) {
      setVerifyState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not verify the audit chain.",
      });
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {events.length === 0 ? "No events in this view." : `${events.length} events on this page`}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={verifyChain}
          disabled={verifyState.kind === "loading"}
        >
          {verifyState.kind === "loading" ? "Verifying…" : "Verify chain integrity"}
        </Button>
      </div>
      {verifyState.kind === "success" && (
        <Alert className="mb-4">
          <AlertTitle>{verifyState.valid ? "Audit chain valid" : "Audit chain integrity failed"}</AlertTitle>
          <AlertDescription>
            {verifyState.valid
              ? "Every event hash links to the preceding event."
              : `The chain first breaks at sequence ${verifyState.brokenAtSeq ?? "unknown"}.`}
          </AlertDescription>
        </Alert>
      )}
      {verifyState.kind === "error" && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Verification unavailable</AlertTitle>
          <AlertDescription>{verifyState.message}</AlertDescription>
        </Alert>
      )}

      {events.length === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed bg-muted/20 px-6 text-center">
          <p className="text-sm font-medium">No audit events found</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Try changing the filters or create a mock request to generate activity.
          </p>
        </div>
      ) : (
        <Card className="ring-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sequence</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Request</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead><span className="sr-only">Details</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-xs">{event.seq}</TableCell>
                    <TableCell>
                      <div className="font-medium">{event.eventType.replaceAll("_", " ")}</div>
                      {event.toolName && <div className="font-mono text-xs text-muted-foreground">{event.toolName}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{event.requestId ?? "—"}</TableCell>
                    <TableCell>
                      <div className="text-sm">{event.actorId}</div>
                      <div className="text-xs text-muted-foreground">{event.actorType}</div>
                    </TableCell>
                    <TableCell><Badge variant={statusVariant(event.status)}>{event.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(event.at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelected(event)}
                        aria-label={`View details for audit sequence ${event.seq}`}
                      >
                        JSON
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-[min(42rem,100vw)] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Audit event details</SheetTitle>
            <SheetDescription>
              Sanitized event record. Sensitive values are hashed before they enter the audit log.
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <pre className="m-4 overflow-x-auto rounded-md border bg-muted/30 p-4 text-xs leading-relaxed">
              {JSON.stringify(selected, null, 2)}
            </pre>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
