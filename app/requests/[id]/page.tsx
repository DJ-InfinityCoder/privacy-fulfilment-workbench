import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RequestDetailWorkspace } from "@/components/request-detail-workspace";
import { buttonVariants } from "@/components/ui/button";
import { connectDB } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { ActionExecution } from "@/models/ActionExecution";
import { Approval } from "@/models/Approval";
import { AuditEvent } from "@/models/AuditEvent";
import { DataInventory } from "@/models/DataInventory";
import { FulfilmentRecord } from "@/models/FulfilmentRecord";
import { planSchema } from "@/agent/prompts";
import { getMockActor, getMockRole } from "@/lib/mock-auth";
import { getRequestById } from "@/services/request-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export default async function RequestDetailPage({ params }: RouteProps) {
  const { id } = await params;
  await connectDB();
  let result: Awaited<ReturnType<typeof getRequestById>>;
  try {
    result = await getRequestById(id);
  } catch (error: unknown) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const request = result.request;
  const [
    approvals,
    events,
    executions,
    inventoryDoc,
    fulfilmentRecordDoc,
    currentRole,
    currentActor,
  ] = await Promise.all([
    Approval.find({ requestId: id })
      .sort({ createdAt: -1 })
      .select(
        "approvalId kind status actionSetHash requestedBy decidedBy decidedByRole decidedAt expiresAt comment",
      )
      .lean(),
    AuditEvent.find({ requestId: id })
      .sort({ seq: -1 })
      .limit(60)
      .select("seq eventType actorId status at input output error")
      .lean(),
    ActionExecution.find({ requestId: id })
      .sort({ createdAt: 1 })
      .lean(),
    DataInventory.findOne({ requestId: id })
      .sort({ version: -1 })
      .lean(),
    FulfilmentRecord.findOne({ requestId: id }).lean(),
    getMockRole(),
    getMockActor(id),
  ]);

  const planResult = planSchema.safeParse(request.plan);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft aria-hidden="true" />
        Back to dashboard
      </Link>
      <RequestDetailWorkspace
        request={{
          requestId: request.requestId,
          type: request.type,
          status: request.status,
          requesterName: request.requesterName,
          requesterEmail: request.requesterEmail,
          rawText: request.rawText,
          receivedAt: request.receivedAt.toISOString(),
          dueAt: request.dueAt.toISOString(),
          deadline: result.deadline,
          extension: {
            applied: request.extension.applied,
            reason: request.extension.reason,
            newDueAt: request.extension.newDueAt?.toISOString(),
          },
          assignee: request.assignee,
          verification: {
            status: request.verification.status,
            attempts: request.verification.attempts,
            score: request.verification.score,
          },
          plan: planResult.success ? planResult.data : null,
          planVersion: request.planVersion,
          planHash: request.planHash,
          fulfilmentRecordId: request.fulfilmentRecordId,
        }}
        approvals={approvals.map((approval) => ({
          approvalId: approval.approvalId,
          kind: approval.kind,
          status: approval.status,
          actionSetHash: approval.actionSetHash,
          requestedBy: approval.requestedBy,
          decidedBy: approval.decidedBy,
          decidedByRole: approval.decidedByRole,
          decidedAt: approval.decidedAt?.toISOString(),
          expiresAt: approval.expiresAt.toISOString(),
          comment: approval.comment,
        }))}
        events={events.map((event) => ({
          seq: event.seq,
          eventType: event.eventType,
          actorId: event.actorId,
          status: event.status,
          at: event.at.toISOString(),
          input: event.input,
          output: event.output,
          error: event.error,
        }))}
        executions={executions.map((item) => ({
          id: item._id.toString(),
          actionType: item.actionType,
          target: {
            source: item.target.source,
            recordId: item.target.recordId,
            field: item.target.field,
          },
          idempotencyKey: item.idempotencyKey,
          status: item.status,
          attempts: item.attempts,
          result: item.result,
          error: item.error,
          createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
        }))}
        inventory={
          inventoryDoc
            ? {
                version: inventoryDoc.version,
                status: inventoryDoc.status,
                itemCount: inventoryDoc.items?.length ?? 0,
                reviewedBy: inventoryDoc.reviewedBy,
                reviewedAt: inventoryDoc.reviewedAt?.toISOString(),
              }
            : null
        }
        fulfilmentRecord={
          fulfilmentRecordDoc
            ? {
                recordId: fulfilmentRecordDoc.recordId,
                summary: fulfilmentRecordDoc.summary,
                contentHash: fulfilmentRecordDoc.contentHash,
                finalizedAt: fulfilmentRecordDoc.finalizedAt.toISOString(),
                disclaimers: fulfilmentRecordDoc.disclaimers ?? [],
              }
            : null
        }
        currentRole={currentRole}
        currentActorId={currentActor.actorId}
      />
    </div>
  );
}
