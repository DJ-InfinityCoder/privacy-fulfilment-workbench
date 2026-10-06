"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { cn } from "cn";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Download,
  FileCheck2,
  FileText,
  LoaderCircle,
  Lock,
  Printer,
  RefreshCw,
  RotateCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import type { Plan } from "@/agent/prompts";
import { ExportTab } from "@/components/export-tab";
import { InventoryTab } from "@/components/inventory-tab";
import { VerificationPanel } from "@/components/verification-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { DeadlineInfo } from "@/services/request-service";

export type RequestDetail = {
  requestId: string;
  type: "ACCESS" | "CORRECTION" | "DELETION";
  status: string;
  requesterName: string;
  requesterEmail: string;
  rawText: string;
  receivedAt: string;
  dueAt: string;
  deadline: DeadlineInfo;
  extension: { applied: boolean; reason?: string; newDueAt?: string };
  assignee?: string;
  verification: { status: string; attempts: number; score: number };
  plan: Plan | null;
  planVersion?: string;
  planHash?: string;
  fulfilmentRecordId?: string;
};

export type ApprovalKind = "PLAN" | "CORRECTION" | "DELETION" | "EXPORT";
export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CONSUMED";

export type ApprovalItem = {
  approvalId: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  actionSetHash?: string;
  requestedBy: string;
  decidedBy?: string;
  decidedByRole?: string;
  decidedAt?: string;
  expiresAt: string;
  comment?: string;
};

export type TimelineEvent = {
  seq: number;
  eventType: string;
  actorId: string;
  status: "ok" | "error" | "denied";
  at: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
};

export type ActionExecutionItem = {
  id: string;
  actionType: "CORRECTION" | "DELETION";
  target: {
    source: string;
    recordId: string;
    field?: string;
  };
  idempotencyKey: string;
  status: "PENDING" | "EXECUTING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  attempts: number;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  createdAt: string;
};

export type InventorySummary = {
  version: number;
  status: "DRAFT" | "REVIEWED";
  itemCount: number;
  reviewedBy?: string;
  reviewedAt?: string;
};

export type FulfilmentRecordSummary = {
  recordId: string;
  summary: string;
  contentHash: string;
  finalizedAt: string;
  disclaimers: string[];
};

type ApiPayload<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: { unmetPreconditions?: Array<{ message?: string }> };
  };
};

function statusTone(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "COMPLETED" || status === "APPROVED" || status === "PASSED" || status === "SUCCEEDED")
    return "default";
  if (status === "FAILED" || status === "REJECTED" || status === "LOCKED")
    return "destructive";
  if (status.startsWith("AWAITING_") || status === "PENDING" || status === "EXECUTING")
    return "secondary";
  return "outline";
}

function riskTone(severity: string): "default" | "secondary" | "outline" | "destructive" {
  if (severity === "CRITICAL" || severity === "HIGH") return "destructive";
  if (severity === "MEDIUM") return "secondary";
  return "outline";
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function shortenKey(key: string): string {
  if (!key || key.length <= 16) return key;
  return `${key.slice(0, 8)}...${key.slice(-6)}`;
}

function useCountdown(targetDate?: string) {
  const [timeLeft, setTimeLeft] = useState("");
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    if (!targetDate) {
      setTimeLeft("");
      setIsExpired(false);
      return;
    }
    const dateStr = targetDate;
    function update() {
      const ms = new Date(dateStr).getTime() - Date.now();
      if (ms <= 0) {
        setTimeLeft("Expired");
        setIsExpired(true);
      } else {
        const totalSec = Math.floor(ms / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        const hours = Math.floor(mins / 60);
        if (hours > 0) {
          setTimeLeft(`${hours}h ${mins % 60}m remaining`);
        } else {
          setTimeLeft(`${mins}m ${secs}s remaining`);
        }
        setIsExpired(false);
      }
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return { timeLeft, isExpired };
}

export function RequestDetailWorkspace({
  request,
  approvals,
  events,
  executions,
  inventory,
  fulfilmentRecord,
  currentRole,
  currentActorId,
}: {
  request: RequestDetail;
  approvals: ApprovalItem[];
  events: TimelineEvent[];
  executions: ActionExecutionItem[];
  inventory: InventorySummary | null;
  fulfilmentRecord: FulfilmentRecordSummary | null;
  currentRole: string;
  currentActorId: string;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("overview");
  const [busyAction, setBusyAction] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  // Dialog states
  const [extensionDialogOpen, setExtensionDialogOpen] = useState(false);
  const [extensionReason, setExtensionReason] = useState("");
  const [planApprovalDialogOpen, setPlanApprovalDialogOpen] = useState(false);

  // Approval card decision state
  const [decisionComments, setDecisionComments] = useState<Record<string, string>>({});
  const [confirmApproveKind, setConfirmApproveKind] = useState<"CORRECTION" | "DELETION" | "EXPORT" | null>(null);
  const [confirmRejectKind, setConfirmRejectKind] = useState<"CORRECTION" | "DELETION" | "EXPORT" | null>(null);

  // Execution dialog state
  const [confirmExecuteKind, setConfirmExecuteKind] = useState<"CORRECTION" | "DELETION" | null>(null);

  // Finalize dialog state
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);

  // Tool trace toggle
  const [toolTraceOpen, setToolTraceOpen] = useState(false);

  // Timeline filter
  const [timelineFilter, setTimelineFilter] = useState<
    "ALL" | "TOOLS" | "PROVIDERS" | "APPROVALS" | "ACTIONS" | "ERRORS"
  >("ALL");
  const [expandedSeqs, setExpandedSeqs] = useState<Record<number, boolean>>({});

  async function post<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(path, {
      method: "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    const payload = (await response.json()) as ApiPayload<T>;
    if (!response.ok || !payload.ok || payload.data === undefined) {
      const details = payload.error?.details?.unmetPreconditions;
      if (Array.isArray(details)) {
        const reasons = details
          .map((item) =>
            typeof item === "object" && item !== null && "message" in item
              ? String(item.message)
              : "",
          )
          .filter(Boolean);
        throw new Error(
          reasons.length
            ? `Still needed: ${reasons.join(" ")}`
            : payload.error?.message ?? "The action could not be completed.",
        );
      }
      throw new Error(payload.error?.message ?? "The action could not be completed.");
    }
    return payload.data;
  }

  async function run(
    action: string,
    operation: () => Promise<unknown>,
    success: string,
  ) {
    setBusyAction(action);
    setError(undefined);
    setNotice(undefined);
    try {
      await operation();
      setNotice(success);
      router.refresh();
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The action could not be completed.",
      );
    } finally {
      setBusyAction(undefined);
    }
  }

  // Preconditions & workflow checks
  const isVerified = request.verification.status === "PASSED";
  const hasPlan = Boolean(request.plan);
  const planApproval = approvals.find((a) => a.kind === "PLAN");
  const isPlanApproved =
    planApproval?.status === "APPROVED" || planApproval?.status === "CONSUMED";

  const isInventoryReviewed = inventory?.status === "REVIEWED";

  const plannedActions = request.plan?.proposedActions ?? [];
  const correctionActions = plannedActions.filter((a) => a.type === "CORRECTION");
  const deletionActions = plannedActions.filter((a) => a.type === "DELETION");

  const correctionApproval = approvals.find((a) => a.kind === "CORRECTION");
  const deletionApproval = approvals.find((a) => a.kind === "DELETION");
  const exportApproval = approvals.find((a) => a.kind === "EXPORT");

  const isCorrectionApproved =
    correctionApproval?.status === "APPROVED" ||
    correctionApproval?.status === "CONSUMED";
  const isDeletionApproved =
    deletionApproval?.status === "APPROVED" ||
    deletionApproval?.status === "CONSUMED";
  const isExportApproved =
    exportApproval?.status === "APPROVED" ||
    exportApproval?.status === "CONSUMED";

  const writeApprovalsResolved =
    (correctionActions.length === 0 || isCorrectionApproved) &&
    (deletionActions.length === 0 || isDeletionApproved);

  const writeActionsExecuted =
    plannedActions.length === 0
      ? true
      : executions.length >= plannedActions.length &&
        plannedActions.every((p) =>
          executions.some(
            (e) =>
              e.actionType === p.type &&
              e.target.source === p.source &&
              (e.status === "SUCCEEDED" || e.status === "SKIPPED"),
          ),
        );

  const isExportReady =
    request.type !== "ACCESS" ||
    events.some((e) => e.eventType === "EXPORT_GENERATED" && e.status === "ok");

  const isFinalized = Boolean(
    request.fulfilmentRecordId || fulfilmentRecord || request.status === "COMPLETED",
  );

  // Preconditions for finalization
  const preconditionsMet =
    isVerified &&
    isPlanApproved &&
    isInventoryReviewed &&
    writeApprovalsResolved &&
    writeActionsExecuted &&
    isExportReady;

  // Next step calculation
  let nextStepLabel = "Workflow completed";
  let nextStepTab = "record";
  let nextStepDescription = "The request has been fully finalized.";

  if (!isVerified) {
    nextStepLabel = "Verify identity";
    nextStepTab = "verification";
    nextStepDescription =
      "Requester identity verification must be completed before processing.";
  } else if (!hasPlan) {
    nextStepLabel = "Generate plan";
    nextStepTab = "plan";
    nextStepDescription =
      "Request the AI assistant to propose a policy-checked fulfilment plan.";
  } else if (!isPlanApproved) {
    nextStepLabel = "Approve plan";
    nextStepTab = "plan";
    nextStepDescription =
      "Review the proposed steps, risks, and sources and approve the plan.";
  } else if (!isInventoryReviewed) {
    nextStepLabel = "Search & review inventory";
    nextStepTab = "inventory";
    nextStepDescription =
      "Execute automated discovery and review data fields across systems.";
  } else if (!writeApprovalsResolved) {
    if (deletionActions.length > 0 && !isDeletionApproved) {
      nextStepLabel = "Request/decide deletion approval";
      nextStepTab = "approvals";
      nextStepDescription =
        "A formal human deletion approval is required prior to removing data.";
    } else {
      nextStepLabel = "Request/decide correction approval";
      nextStepTab = "approvals";
      nextStepDescription =
        "A formal human correction approval is required prior to applying changes.";
    }
  } else if (!writeActionsExecuted) {
    nextStepLabel = "Execute approved actions";
    nextStepTab = "execution";
    nextStepDescription =
      "Trigger idempotent execution of approved write actions against data sources.";
  } else if (request.type === "ACCESS" && !isExportReady) {
    nextStepLabel = "Generate export";
    nextStepTab = "export";
    nextStepDescription =
      "Review and generate the policy-redacted export package.";
  } else if (!isFinalized) {
    nextStepLabel = "Finalize request";
    nextStepTab = "record";
    nextStepDescription =
      "Create the immutable, hash-verified fulfilment record.";
  }

  // Stepper items (adaptive by request type)
  const isExportGenerated = events.some(
    (e) => e.eventType === "EXPORT_GENERATED" && e.status === "ok",
  );

  const stepperSteps =
    request.type === "ACCESS"
      ? [
          { id: "verification", label: "Verify", completed: isVerified },
          { id: "plan", label: "Plan", completed: isPlanApproved },
          { id: "inventory", label: "Search & Inventory", completed: isInventoryReviewed },
          { id: "export", label: "Export", completed: isExportGenerated },
          { id: "record", label: "Final Record", completed: isFinalized },
        ]
      : [
          { id: "verification", label: "Verify", completed: isVerified },
          { id: "plan", label: "Plan", completed: isPlanApproved },
          { id: "inventory", label: "Search & Inventory", completed: isInventoryReviewed },
          {
            id: "approvals",
            label: "Approvals",
            completed: isPlanApproved && writeApprovalsResolved,
          },
          {
            id: "execution",
            label: "Execute",
            completed: isPlanApproved && writeActionsExecuted,
          },
          { id: "record", label: "Final Record", completed: isFinalized },
        ];

  // Role permissions checks
  const canDecideGeneral = currentRole === "approver";
  const isAssignee =
    Boolean(request.assignee) && currentActorId === request.assignee;
  const canDecideDeletion = canDecideGeneral && !isAssignee;

  // Live countdowns
  const correctionCountdown = useCountdown(correctionApproval?.expiresAt);
  const deletionCountdown = useCountdown(deletionApproval?.expiresAt);
  const exportCountdown = useCountdown(exportApproval?.expiresAt);

  // Skipped actions detection
  const hasSkippedActions = executions.some(
    (e) => e.status === "SKIPPED" || e.result?.skipped === true,
  );

  // Extend deadline
  async function submitExtension(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(
      "extend",
      () =>
        post(`/api/requests/${encodeURIComponent(request.requestId)}/extend`, {
          reason: extensionReason,
        }),
      "Deadline extension recorded.",
    );
    setExtensionDialogOpen(false);
    setExtensionReason("");
  }

  // Plan generation
  async function generatePlan() {
    await run(
      "plan",
      () =>
        post(
          `/api/requests/${encodeURIComponent(request.requestId)}/agent/plan`,
        ),
      "Agent plan generated.",
    );
  }

  async function replan() {
    await run(
      "replan",
      () =>
        post(
          `/api/requests/${encodeURIComponent(request.requestId)}/agent/replan`,
        ),
      "Agent plan refreshed.",
    );
  }

  async function handleApprovePlan() {
    let approved = false;
    // If no plan approval exists, request it first
    if (!planApproval) {
      await run(
        "approve-plan",
        async () => {
          const req = await post<{ approvalId: string }>(
            `/api/requests/${encodeURIComponent(request.requestId)}/approvals`,
            { kind: "PLAN" },
          );
          if (canDecideGeneral) {
            await post(`/api/approvals/${encodeURIComponent(req.approvalId)}/decide`, {
              decision: "APPROVED",
            });
            approved = true;
          }
        },
        canDecideGeneral
          ? "Plan approved successfully. Advancing to Search & Inventory."
          : "Plan approval requested. Switch role to Approver (Rahul) to authorize.",
      );
    } else if (planApproval.status === "PENDING" && canDecideGeneral) {
      await run(
        "approve-plan",
        async () => {
          await post(
            `/api/approvals/${encodeURIComponent(planApproval.approvalId)}/decide`,
            { decision: "APPROVED" },
          );
          approved = true;
        },
        "Plan approved successfully. Advancing to Search & Inventory.",
      );
    }
    setPlanApprovalDialogOpen(false);
    if (approved) {
      setActiveTab("inventory");
    }
  }

  // Request approval
  async function handleRequestApproval(kind: ApprovalKind) {
    await run(
      `request-${kind}`,
      () =>
        post(`/api/requests/${encodeURIComponent(request.requestId)}/approvals`, {
          kind,
        }),
      `${kind.toLowerCase()} approval requested.`,
    );
  }

  // Decide approval
  async function handleDecideApproval(
    approval: ApprovalItem,
    decision: "APPROVED" | "REJECTED",
  ) {
    const comment = decisionComments[approval.approvalId];
    await run(
      `decide-${approval.approvalId}`,
      () =>
        post(`/api/approvals/${encodeURIComponent(approval.approvalId)}/decide`, {
          decision,
          ...(comment ? { comment } : {}),
        }),
      `${approval.kind.toLowerCase()} approval ${decision.toLowerCase()}.`,
    );
    setConfirmApproveKind(null);
    setConfirmRejectKind(null);
  }

  // Execute actions
  async function handleExecuteActions(kind: "CORRECTION" | "DELETION") {
    await run(
      `execute-${kind}`,
      () =>
        post(`/api/requests/${encodeURIComponent(request.requestId)}/execute`, {
          kind,
        }),
      `Approved ${kind.toLowerCase()} actions executed.`,
    );
    setConfirmExecuteKind(null);
  }

  // Retry action
  async function handleRetryAction(actionId: string) {
    await run(
      `retry-${actionId}`,
      () => post(`/api/actions/${encodeURIComponent(actionId)}/retry`),
      "Action retry initiated.",
    );
  }

  // Finalize request
  async function handleFinalize() {
    await run(
      "finalize",
      () =>
        post(
          `/api/requests/${encodeURIComponent(request.requestId)}/finalize`,
        ),
      "Request successfully finalized.",
    );
    setFinalizeDialogOpen(false);
    setActiveTab("record");
  }

  // Tool trace events
  const toolTraceEvents = events.filter(
    (e) =>
      e.eventType.includes("TOOL") ||
      e.eventType.includes("PROVIDER") ||
      e.eventType.includes("AGENT"),
  );

  // Filtered timeline events
  const filteredEvents = events.filter((e) => {
    if (timelineFilter === "ALL") return true;
    if (timelineFilter === "TOOLS") return e.eventType.includes("TOOL");
    if (timelineFilter === "PROVIDERS")
      return e.eventType.includes("PROVIDER") || e.eventType.includes("AGENT");
    if (timelineFilter === "APPROVALS") return e.eventType.includes("APPROVAL");
    if (timelineFilter === "ACTIONS") return e.eventType.includes("ACTION");
    if (timelineFilter === "ERRORS")
      return e.status === "error" || e.status === "denied" || Boolean(e.error);
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{request.type}</Badge>
            <Badge variant={statusTone(request.status)}>
              {request.status.replaceAll("_", " ")}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {request.requestId}
            </span>
            <Badge variant="outline" className="text-xs">
              Role: {currentRole}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {request.requesterName}
          </h1>
          <p className="text-sm text-muted-foreground">{request.requesterEmail}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasPlan && (
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(busyAction)}
              onClick={replan}
            >
              {busyAction === "replan" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <RotateCw className="size-3.5" />
              )}
              Re-plan
            </Button>
          )}

          {isFinalized ? (
            <a
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              href={`/api/requests/${encodeURIComponent(request.requestId)}/record?format=html`}
              target="_blank"
              rel="noreferrer"
            >
              <FileCheck2 className="size-3.5" />
              View Final Record
            </a>
          ) : (
            <Button
              size="sm"
              disabled={!preconditionsMet || Boolean(busyAction)}
              onClick={() => setFinalizeDialogOpen(true)}
            >
              <ClipboardCheck className="size-3.5" />
              Finalize Request
            </Button>
          )}
        </div>
      </header>

      {/* Role Context & Visibility Banner */}
      <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between text-xs">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-primary shrink-0" />
          <span className="font-semibold text-foreground">
            Role: {currentRole.toUpperCase()}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            {currentRole === "analyst"
              ? "Asha (Analyst): Manages intake, factor matching, AI plan generation, search inventory, execution, and finalization. Write approvals require Approver (Rahul)."
              : "Rahul (Approver): Authorized for independent oversight. Decides approvals (PLAN, CORRECTION, DELETION, EXPORT), verification override, and deadline extensions."}
          </span>
        </div>
        <Badge variant="outline" className="text-[11px] self-start sm:self-auto shrink-0">
          Switch role anytime in top bar
        </Badge>
      </div>

      {/* Global Alerts */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Action could not be completed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <Check className="size-4" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {/* Stepper Navigation */}
      <nav aria-label="Workbench Stepper" className="rounded-md border bg-card p-3 shadow-xs">
        <ol className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {stepperSteps.map((step, index) => {
            const isCurrent = activeTab === step.id;
            return (
              <li key={step.id} className="flex items-center gap-1 sm:gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab(step.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors ${
                    isCurrent
                      ? "bg-primary font-medium text-primary-foreground shadow-xs"
                      : step.completed
                        ? "bg-muted text-foreground hover:bg-muted/80"
                        : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <span
                    className={`inline-flex size-4.5 items-center justify-center rounded-md text-[10px] font-semibold ${
                      isCurrent
                        ? "bg-primary-foreground text-primary"
                        : step.completed
                          ? "bg-emerald-600 text-white dark:bg-emerald-500"
                          : "border border-border bg-background"
                    }`}
                  >
                    {step.completed ? (
                      <Check className="size-3 stroke-[3]" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="truncate">{step.label}</span>
                </button>
                {index < stepperSteps.length - 1 && (
                  <ChevronRight className="size-3.5 text-muted-foreground/40" />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Next Step Banner */}
      {!isFinalized && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <ArrowRight className="size-3 stroke-[2.5]" />
              </span>
              <p className="text-sm font-semibold">
                Next recommended step: {nextStepLabel}
              </p>
            </div>
            <p className="text-xs text-muted-foreground pl-7">
              {nextStepDescription}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setActiveTab(nextStepTab)}
            className="shrink-0"
          >
            Go to {nextStepLabel}
          </Button>
        </div>
      )}

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="inline-flex h-auto w-full flex-wrap items-center justify-start gap-1 rounded-md border bg-muted/60 p-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
          <TabsTrigger value="plan" className="gap-1.5 font-medium">
            <Sparkles className="size-3.5 text-primary" />
            Plan
            {hasPlan && (
              <span className="size-1.5 rounded-full bg-primary" />
            )}
          </TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="approvals" className="gap-1.5">
            Approvals
            {(correctionApproval?.status === "PENDING" || deletionApproval?.status === "PENDING") && (
              <span className="size-1.5 rounded-full bg-amber-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="execution">Execution</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="record">Final Record</TabsTrigger>
        </TabsList>

        {/* 1. OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="flex items-start gap-3 p-4">
                <CalendarClock className="mt-0.5 size-4 text-primary shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">SLA Deadline</p>
                  <p className="font-semibold">{dateLabel(request.dueAt)}</p>
                  <Badge variant={statusTone(request.deadline.state)} className="mt-1">
                    {request.deadline.state.replaceAll("_", " ")} · {request.deadline.daysRemaining}d left
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start gap-3 p-4">
                <ShieldCheck className="mt-0.5 size-4 text-primary shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Identity Verification</p>
                  <Badge variant={statusTone(request.verification.status)} className="mt-1">
                    {request.verification.status}
                  </Badge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {request.verification.attempts} / 3 attempts
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start gap-3 p-4">
                <Sparkles className="mt-0.5 size-4 text-primary shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Plan Status</p>
                  <p className="font-semibold">
                    {request.planVersion ?? "No plan yet"}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground truncate max-w-36">
                    {request.planHash ? shortenKey(request.planHash) : "Not hashed"}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1.5 h-7 text-xs gap-1"
                    onClick={() => setActiveTab("plan")}
                  >
                    <Sparkles className="size-3 text-primary" />
                    {hasPlan ? "View Plan Tab" : "Open Plan Tab"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start gap-3 p-4">
                <Activity className="mt-0.5 size-4 text-primary shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Assignee & Audit</p>
                  <p className="font-semibold truncate">
                    {request.assignee ? request.assignee : "Unassigned"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {events.length} audit events logged
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            {/* Requester Statement */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-primary" />
                  <CardTitle className="text-base">Requester Statement</CardTitle>
                </div>
                <CardDescription>
                  Original free-text prompt submitted by the data subject.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <blockquote className="rounded-md border-l-2 border-primary/40 bg-muted/30 p-3.5 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap font-sans">
                  {request.rawText}
                </blockquote>
                <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                  <span className="font-semibold">Prompt-injection defense:</span> Requester text is untrusted DATA. User text cannot override policy rules, bypass approvals, or command write operations.
                </div>
              </CardContent>
            </Card>

            {/* Deadline & Extension Card */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <CalendarClock className="size-4 text-primary" />
                  <CardTitle className="text-base">Deadline Extension</CardTitle>
                </div>
                <CardDescription>
                  Policy-permitted one-time extension of the SLA deadline.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {request.extension.applied ? (
                  <div className="space-y-2 rounded-md bg-muted/40 p-3.5 text-sm">
                    <Badge variant="default">Extension Applied</Badge>
                    <p className="text-xs text-muted-foreground">
                      New Due Date:{" "}
                      <span className="font-medium text-foreground">
                        {request.extension.newDueAt ? dateLabel(request.extension.newDueAt) : "Recorded"}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Reason: <span className="text-foreground">{request.extension.reason}</span>
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      A single 30-day extension may be recorded under organizational policy if request complexity requires additional verification or multi-source retrieval.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExtensionDialogOpen(true)}
                      className="w-full"
                    >
                      Extend Deadline
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 2. VERIFICATION TAB */}
        <TabsContent value="verification" className="space-y-4">
          {isVerified ? (
            <div className="space-y-4 rounded-md border bg-card p-5">
              <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400">
                <span className="flex size-9 items-center justify-center rounded-md bg-emerald-500/10">
                  <ShieldCheck className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold text-foreground">
                    Identity Verification Confirmed
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    At least two verification factors successfully matched. Raw factor values were not retained per policy.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="default">Status: PASSED</Badge>
                  <span className="text-xs text-muted-foreground">
                    Score: {request.verification.score} factors · {request.verification.attempts} attempt(s) used
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={() => setActiveTab("plan")}
                  className="gap-1.5"
                >
                  <Sparkles className="size-3.5" />
                  Proceed to Plan Tab →
                </Button>
              </div>
            </div>
          ) : (
            <VerificationPanel
              requestId={request.requestId}
              requesterEmail={request.requesterEmail}
              attempts={request.verification.attempts}
              maxAttempts={3}
              currentRole={currentRole}
              onVerified={() => router.refresh()}
              onGoToPlan={() => setActiveTab("plan")}
            />
          )}
        </TabsContent>

        {/* 3. AGENT PLAN TAB */}
        <TabsContent value="plan" className="space-y-4">
          {!isVerified ? (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <ShieldAlert className="size-5" />
                  <CardTitle>Identity Verification Required</CardTitle>
                </div>
                <CardDescription>
                  Under organizational policy, the autonomous planning assistant cannot be executed until identity verification has been confirmed.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Confirm identity factors for the requester before generating an AI fulfilment plan or scanning mock sources.
                </p>
                <Button
                  onClick={() => setActiveTab("verification")}
                  className="gap-2"
                >
                  <ShieldCheck className="size-4" />
                  Go to Verification Tab
                </Button>
              </CardContent>
            </Card>
          ) : !request.plan ? (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="size-5 text-primary" />
                  <CardTitle>Autonomous Planning Assistant</CardTitle>
                </div>
                <CardDescription>
                  Generate an AI-driven, policy-checked fulfilment plan with multi-provider failover.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  The agent will interpret the user statement, evaluate missing factors, inspect likely data sources, and outline read-only and write steps.
                </p>
                <Button
                  onClick={generatePlan}
                  disabled={Boolean(busyAction)}
                  className="gap-2"
                >
                  {busyAction === "plan" ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  Generate Plan
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Plan Metadata & Provider Badge */}
              <div className="flex flex-col justify-between gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm">
                      Plan {request.planVersion ?? "v1"}
                    </span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      Hash: {request.planHash ? shortenKey(request.planHash) : "N/A"}
                    </Badge>
                    {/* Provider badge */}
                    <Badge variant="secondary" className="gap-1">
                      <Bot className="size-3" />
                      {request.plan.generatedBy.provider.toUpperCase()} (
                      {request.plan.generatedBy.model})
                    </Badge>
                  </div>
                  {request.plan.generatedBy.usedFallbackPlanner && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Note: Failover occurred — rule-based deterministic fallback planner was engaged.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!isPlanApproved && (
                    <Button
                      size="sm"
                      onClick={() => setPlanApprovalDialogOpen(true)}
                      disabled={Boolean(busyAction)}
                      className="gap-1.5"
                    >
                      <Check className="size-3.5" />
                      {canDecideGeneral ? "Approve Plan" : "Request Approval"}
                    </Button>
                  )}
                  {isPlanApproved && (
                    <Badge variant="default" className="gap-1">
                      <CheckCircle2 className="size-3" />
                      Plan Approved
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={replan}
                    disabled={Boolean(busyAction)}
                    className="gap-1.5"
                  >
                    <RefreshCw className="size-3.5" />
                    Re-plan
                  </Button>
                </div>
              </div>

              {/* Interpretation Box */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">
                    Interpretation · {request.plan.interpretation.requestType} ·{" "}
                    {Math.round(request.plan.interpretation.confidence * 100)}% Confidence
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm leading-relaxed">
                    {request.plan.interpretation.summary}
                  </p>
                  {request.plan.interpretation.ambiguities.length > 0 && (
                    <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                      <span className="font-semibold">Ambiguities identified:</span>{" "}
                      {request.plan.interpretation.ambiguities.join("; ")}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Missing Information (Blocking Highlighted) */}
              {request.plan.missingInformation.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">
                      Missing Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {request.plan.missingInformation.map((info, idx) => (
                        <li
                          key={idx}
                          className={`flex items-start justify-between gap-3 rounded-md border p-3 text-xs ${
                            info.blocking
                              ? "border-destructive/40 bg-destructive/10 text-destructive-foreground dark:bg-destructive/20"
                              : "border-border bg-card"
                          }`}
                        >
                          <div>
                            <p className="font-medium text-foreground">{info.item}</p>
                            <p className="mt-0.5 text-muted-foreground">{info.whyNeeded}</p>
                          </div>
                          {info.blocking && (
                            <Badge variant="destructive" className="shrink-0 text-[10px]">
                              Blocking
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Likely Sources */}
              {request.plan.likelySources.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">
                      Likely Data Sources
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {request.plan.likelySources.map((src, idx) => (
                        <div key={idx} className="rounded-md border p-3 text-xs space-y-1">
                          <p className="font-semibold text-foreground">{src.source}</p>
                          <p className="text-muted-foreground">{src.rationale}</p>
                          <div className="flex flex-wrap gap-1 pt-1">
                            {src.expectedRecordTypes.map((rt, i) => (
                              <Badge key={i} variant="outline" className="text-[9px]">
                                {rt}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Workflow Steps */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Workflow Steps</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-2">
                    {request.plan.steps.map((step) => (
                      <li
                        key={step.order}
                        className="flex items-start justify-between gap-3 rounded-md border p-3 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold">#{step.order}</span>
                            <span className="text-foreground">{step.description}</span>
                          </div>
                          {step.toolsUsed.length > 0 && (
                            <p className="text-muted-foreground">
                              Tools: {step.toolsUsed.join(", ")}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant={step.requiresApproval ? "secondary" : "outline"}
                          className="shrink-0 text-[10px]"
                        >
                          {step.requiresApproval ? "Approval Required" : "Read Only"}
                        </Badge>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>

              {/* Risks with Severity Badges */}
              {request.plan.risks.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">
                      Risks & Mitigations
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {request.plan.risks.map((risk, idx) => (
                        <li key={idx} className="rounded-md border p-3 text-xs space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-foreground">
                              {risk.description}
                            </span>
                            <Badge variant={riskTone(risk.severity)} className="text-[10px]">
                              {risk.severity}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground">
                            Mitigation: {risk.mitigation}
                          </p>
                          {risk.policyRef && (
                            <p className="font-mono text-[10px] text-muted-foreground">
                              Ref: {risk.policyRef}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Policy Exceptions */}
              {request.plan.policyExceptions.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">
                      Policy Exceptions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {request.plan.policyExceptions.map((exc, idx) => (
                        <li key={idx} className="rounded-md border p-3 text-xs space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{exc.source}</Badge>
                            <span className="font-mono font-medium">{exc.exceptionCode}</span>
                          </div>
                          <p className="text-muted-foreground">{exc.explanation}</p>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Collapsible Tool-Call Trace */}
              <div
                role="button"
                tabIndex={0}
                aria-expanded={toolTraceOpen}
                onClick={() => setToolTraceOpen(!toolTraceOpen)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setToolTraceOpen(!toolTraceOpen);
                  }
                }}
                className={cn(
                  "w-full rounded-md border bg-card text-card-foreground shadow-xs transition-colors cursor-pointer select-none overflow-hidden",
                  "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                <div className="flex w-full items-center justify-between p-3.5 text-xs font-semibold">
                  <span className="flex items-center gap-2">
                    <Wrench className="size-4 text-primary shrink-0" />
                    <span>Tool-call Trace ({toolTraceEvents.length} calls)</span>
                  </span>
                  <span className="text-muted-foreground">
                    {toolTraceOpen ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </span>
                </div>

                {toolTraceOpen && (
                  <div
                    className="border-t bg-muted/10 p-3 text-xs cursor-default"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {toolTraceEvents.length === 0 ? (
                      <p className="text-muted-foreground">No tool calls logged yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                        {toolTraceEvents.map((t) => (
                          <div key={t.seq} className="rounded-md border bg-background/80 p-2.5 font-mono text-[11px]">
                            <div className="flex items-center justify-between text-muted-foreground">
                              <span>#{t.seq} · {t.eventType}</span>
                              <span>{new Date(t.at).toLocaleTimeString()}</span>
                            </div>
                            {t.input && Object.keys(t.input).length > 0 && (
                              <pre className="mt-1 overflow-x-auto text-[10px] text-foreground">
                                {JSON.stringify(t.input, null, 2)}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Mandatory Policy Disclaimer */}
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground leading-relaxed">
                {request.plan.disclaimer}
              </div>
            </div>
          )}
        </TabsContent>

        {/* 4. INVENTORY TAB */}
        <TabsContent value="inventory" className="space-y-4">
          <InventoryTab
            requestId={request.requestId}
            onReviewed={() => router.refresh()}
            currentRole={currentRole}
          />
        </TabsContent>

        {/* 5. APPROVALS TAB */}
        <TabsContent value="approvals" className="space-y-6">
          {currentRole === "analyst" && (
            <div className="flex items-center gap-2.5 rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              <ShieldAlert className="size-4 shrink-0" />
              <span>
                <strong>Four-Eyes Governance:</strong> You are viewing this workspace as <strong>Analyst</strong>. Analysts can request approvals for proposed write actions, but cannot approve or reject write actions. Switch to <strong>Rahul (Approver)</strong> in the top bar to record approval decisions.
              </span>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Per organizational policy, correction approval and deletion approval are separate entities and cannot be combined. All write actions require an unexpired human decision.
          </p>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* CARD 1: CORRECTION APPROVAL */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="size-4 text-primary" />
                    <CardTitle className="text-base">Correction Approval</CardTitle>
                  </div>
                  <Badge variant={statusTone(correctionApproval?.status ?? "NOT_REQUESTED")}>
                    {correctionApproval?.status ?? "NOT REQUESTED"}
                  </Badge>
                </div>
                <CardDescription>
                  Governs authorized modification of user profile or ticket attributes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                {/* Actions covered */}
                <div>
                  <p className="font-semibold text-foreground">Actions Covered:</p>
                  {correctionActions.length === 0 ? (
                    <p className="mt-1 text-muted-foreground">
                      No correction actions proposed in the current plan.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1.5">
                      {correctionActions.map((act, i) => (
                        <li key={i} className="rounded-md border p-2 space-y-0.5">
                          <p className="font-medium text-foreground">
                            {act.source} · Record: <code className="font-mono">{act.recordId}</code>
                          </p>
                          {act.field && (
                            <p className="text-muted-foreground">
                              Field: <span className="font-semibold">{act.field}</span> →{" "}
                              <code className="font-mono">{JSON.stringify(act.newValue)}</code>
                            </p>
                          )}
                          <p className="text-muted-foreground">{act.rationale}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Expiry countdown */}
                {correctionApproval && (
                  <div className="flex items-center justify-between rounded-md bg-muted/40 p-2.5">
                    <span className="text-muted-foreground">Expiry Window:</span>
                    <span
                      className={`font-medium ${
                        correctionCountdown.isExpired ? "text-destructive" : "text-foreground"
                      }`}
                    >
                      {correctionCountdown.timeLeft || "Checking..."}
                    </span>
                  </div>
                )}

                {/* Status and Action Buttons */}
                {!correctionApproval && correctionActions.length > 0 && (
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={Boolean(busyAction)}
                    onClick={() => handleRequestApproval("CORRECTION")}
                  >
                    Request Correction Approval
                  </Button>
                )}

                {correctionApproval?.status === "PENDING" && (
                  <div className="space-y-3 pt-2">
                    <div className="space-y-1">
                      <Label htmlFor="corr-comment" className="text-xs">
                        Comment (Required to reject)
                      </Label>
                      <Input
                        id="corr-comment"
                        value={decisionComments[correctionApproval.approvalId] ?? ""}
                        onChange={(e) =>
                          setDecisionComments((prev) => ({
                            ...prev,
                            [correctionApproval.approvalId]: e.target.value,
                          }))
                        }
                        placeholder="Add rationale or justification"
                      />
                    </div>

                    {!canDecideGeneral && (
                      <div className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
                        Approve/Reject disabled: Current role &apos;{currentRole}&apos; is not authorized to decide approvals. Switch to &apos;approver&apos; in the top bar.
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={!canDecideGeneral || Boolean(busyAction)}
                        onClick={() => setConfirmApproveKind("CORRECTION")}
                      >
                        Approve Corrections
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        disabled={
                          !canDecideGeneral ||
                          Boolean(busyAction) ||
                          !(decisionComments[correctionApproval.approvalId] ?? "").trim()
                        }
                        onClick={() => setConfirmRejectKind("CORRECTION")}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* CARD 2: DELETION APPROVAL */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Trash2 className="size-4 text-destructive" />
                    <CardTitle className="text-base">Deletion Approval</CardTitle>
                  </div>
                  <Badge variant={statusTone(deletionApproval?.status ?? "NOT_REQUESTED")}>
                    {deletionApproval?.status ?? "NOT REQUESTED"}
                  </Badge>
                </div>
                <CardDescription>
                  Governs irreversible deletion or anonymization of subject records.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                {/* Actions covered */}
                <div>
                  <p className="font-semibold text-foreground">Actions Covered:</p>
                  {deletionActions.length === 0 ? (
                    <p className="mt-1 text-muted-foreground">
                      No deletion actions proposed in the current plan.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1.5">
                      {deletionActions.map((act, i) => (
                        <li key={i} className="rounded-md border p-2 space-y-0.5">
                          <p className="font-medium text-foreground">
                            {act.source} · Record: <code className="font-mono">{act.recordId}</code>
                          </p>
                          <p className="text-muted-foreground">{act.rationale}</p>
                          <Badge variant="destructive" className="text-[9px]">
                            Irreversible
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Expiry countdown */}
                {deletionApproval && (
                  <div className="flex items-center justify-between rounded-md bg-muted/40 p-2.5">
                    <span className="text-muted-foreground">Expiry Window:</span>
                    <span
                      className={`font-medium ${
                        deletionCountdown.isExpired ? "text-destructive" : "text-foreground"
                      }`}
                    >
                      {deletionCountdown.timeLeft || "Checking..."}
                    </span>
                  </div>
                )}

                {/* Status and Action Buttons */}
                {!deletionApproval && deletionActions.length > 0 && (
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={Boolean(busyAction)}
                    onClick={() => handleRequestApproval("DELETION")}
                  >
                    Request Deletion Approval
                  </Button>
                )}

                {deletionApproval?.status === "PENDING" && (
                  <div className="space-y-3 pt-2">
                    <div className="space-y-1">
                      <Label htmlFor="del-comment" className="text-xs">
                        Comment (Required to reject)
                      </Label>
                      <Input
                        id="del-comment"
                        value={decisionComments[deletionApproval.approvalId] ?? ""}
                        onChange={(e) =>
                          setDecisionComments((prev) => ({
                            ...prev,
                            [deletionApproval.approvalId]: e.target.value,
                          }))
                        }
                        placeholder="Add rationale or justification"
                      />
                    </div>

                    {!canDecideDeletion && (
                      <div className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
                        {isAssignee
                          ? "Approve/Reject disabled: Under the four-eyes policy, the request assignee cannot approve their own deletion request. An independent Approver must decide."
                          : `Approve/Reject disabled: Current role '${currentRole}' is not authorized to decide approvals. Switch to 'approver' in the top bar.`}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="flex-1"
                        disabled={!canDecideDeletion || Boolean(busyAction)}
                        onClick={() => setConfirmApproveKind("DELETION")}
                      >
                        Approve Deletions
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        disabled={
                          !canDecideGeneral ||
                          Boolean(busyAction) ||
                          !(decisionComments[deletionApproval.approvalId] ?? "").trim()
                        }
                        onClick={() => setConfirmRejectKind("DELETION")}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* CARD 3: EXPORT APPROVAL */}
            {(request.type === "ACCESS" || isInventoryReviewed) && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileCheck2 className="size-4 text-primary" />
                      <CardTitle className="text-base">Export Approval</CardTitle>
                    </div>
                    <Badge variant={statusTone(exportApproval?.status ?? "NOT_REQUESTED")}>
                      {exportApproval?.status ?? "NOT REQUESTED"}
                    </Badge>
                  </div>
                  <CardDescription>
                    Authorizes generation and release of customer export package under reviewed policy redactions.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs">
                  <div>
                    <p className="font-semibold text-foreground">Scope Covered:</p>
                    <p className="mt-1 text-muted-foreground">
                      {inventory
                        ? `Reviewed Data Inventory v${inventory.version} (${inventory.itemCount} records)`
                        : "Requires reviewed data inventory."}
                    </p>
                  </div>

                  {exportApproval && (
                    <div className="flex items-center justify-between rounded-md bg-muted/40 p-2.5">
                      <span className="text-muted-foreground">Expiry Window:</span>
                      <span
                        className={`font-medium ${
                          exportCountdown.isExpired ? "text-destructive" : "text-foreground"
                        }`}
                      >
                        {exportCountdown.timeLeft || "Checking..."}
                      </span>
                    </div>
                  )}

                  {!exportApproval && (
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={Boolean(busyAction) || !isInventoryReviewed}
                      onClick={() => handleRequestApproval("EXPORT")}
                    >
                      {isInventoryReviewed
                        ? "Request Export Approval"
                        : "Review Inventory First"}
                    </Button>
                  )}

                  {exportApproval?.status === "PENDING" && (
                    <div className="space-y-3 pt-2">
                      <div className="space-y-1">
                        <Label htmlFor="exp-comment" className="text-xs">
                          Comment (Required to reject)
                        </Label>
                        <Input
                          id="exp-comment"
                          value={decisionComments[exportApproval.approvalId] ?? ""}
                          onChange={(e) =>
                            setDecisionComments((prev) => ({
                              ...prev,
                              [exportApproval.approvalId]: e.target.value,
                            }))
                          }
                          placeholder="Add approval comment or rejection reason"
                        />
                      </div>

                      {!canDecideGeneral && (
                        <div className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
                          {`Approve/Reject disabled: Current role '${currentRole}' is not authorized to decide approvals. Switch to 'approver' in the top bar.`}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1"
                          disabled={!canDecideGeneral || Boolean(busyAction)}
                          onClick={() => setConfirmApproveKind("EXPORT")}
                        >
                          Approve Export
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          disabled={
                            !canDecideGeneral ||
                            Boolean(busyAction) ||
                            !(decisionComments[exportApproval.approvalId] ?? "").trim()
                          }
                          onClick={() => setConfirmRejectKind("EXPORT")}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* 6. EXECUTION TAB */}
        <TabsContent value="execution" className="space-y-4">
          <div className="flex flex-col justify-between gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="font-semibold text-sm">Action Execution Engine</h3>
              <p className="text-xs text-muted-foreground">
                Executes approved writes idempotently. Server guarantees duplicate executions are safely skipped.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {isCorrectionApproved && (
                <Button
                  size="sm"
                  disabled={Boolean(busyAction)}
                  onClick={() => setConfirmExecuteKind("CORRECTION")}
                >
                  <Zap className="size-3.5" />
                  Execute Corrections
                </Button>
              )}
              {isDeletionApproved && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={Boolean(busyAction)}
                  onClick={() => setConfirmExecuteKind("DELETION")}
                >
                  <Trash2 className="size-3.5" />
                  Execute Deletions
                </Button>
              )}
            </div>
          </div>

          {/* Skipped Duplicates Notice */}
          {hasSkippedActions && (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertTitle>Idempotency Notice</AlertTitle>
              <AlertDescription>
                Duplicate actions were safely skipped. Stored records or conditions were already satisfied in an earlier execution. No redundant modifications were applied.
              </AlertDescription>
            </Alert>
          )}

          {/* Execution Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Action Executions</CardTitle>
            </CardHeader>
            <CardContent>
              {executions.length === 0 ? (
                <p className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                  No actions have been executed yet. Obtain approval and click &apos;Execute&apos; above.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">Type</TableHead>
                        <TableHead>Target</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-20">Attempts</TableHead>
                        <TableHead>Idempotency Key</TableHead>
                        <TableHead className="text-right w-24">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {executions.map((act) => (
                        <TableRow key={act.id}>
                          <TableCell>
                            <Badge
                              variant={
                                act.actionType === "DELETION" ? "destructive" : "secondary"
                              }
                              className="text-[10px]"
                            >
                              {act.actionType}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="font-semibold">{act.target.source}</span>
                            <span className="text-muted-foreground"> · {act.target.recordId}</span>
                            {act.target.field && (
                              <span className="text-muted-foreground"> ({act.target.field})</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusTone(act.status)} className="text-[10px]">
                              {act.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {act.attempts} / 4
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground" title={act.idempotencyKey}>
                            {shortenKey(act.idempotencyKey)}
                          </TableCell>
                          <TableCell className="text-right">
                            {act.status === "FAILED" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={Boolean(busyAction)}
                                onClick={() => handleRetryAction(act.id)}
                                className="h-7 px-2 text-xs"
                              >
                                Retry
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 7. EXPORT TAB */}
        <TabsContent value="export" className="space-y-4">
          <ExportTab requestId={request.requestId} />
        </TabsContent>

        {/* 8. TIMELINE / AUDIT TAB */}
        <TabsContent value="timeline" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["ALL", "All"],
                  ["TOOLS", "Tool Calls"],
                  ["PROVIDERS", "AI Calls"],
                  ["APPROVALS", "Approvals"],
                  ["ACTIONS", "Actions"],
                  ["ERRORS", "Errors"],
                ] as const
              ).map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={timelineFilter === key ? "default" : "outline"}
                  onClick={() => setTimelineFilter(key)}
                  className="h-7 text-xs"
                >
                  {label}
                </Button>
              ))}
            </div>
            <Badge variant="outline">{filteredEvents.length} events</Badge>
          </div>

          {/* Events List */}
          <div className="space-y-2">
            {filteredEvents.length === 0 ? (
              <p className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                No events matched the selected filter.
              </p>
            ) : (
              filteredEvents.map((e) => {
                const isExpanded = Boolean(expandedSeqs[e.seq]);
                return (
                  <div key={e.seq} className="rounded-md border bg-card p-3 text-xs space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={statusTone(e.status)} className="text-[10px]">
                          {e.eventType}
                        </Badge>
                        <span className="font-mono text-muted-foreground">#{e.seq}</span>
                        <span className="text-muted-foreground">Actor: {e.actorId}</span>
                      </div>
                      <time className="text-muted-foreground text-[11px]">
                        {dateLabel(e.at)}
                      </time>
                    </div>

                    {e.error && (
                      <p className="text-destructive font-mono text-[11px]">
                        Error: {JSON.stringify(e.error)}
                      </p>
                    )}

                    {/* Expandable JSON drawer */}
                    <div>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSeqs((prev) => ({
                            ...prev,
                            [e.seq]: !prev[e.seq],
                          }))
                        }
                        className="flex items-center gap-1 font-medium text-primary hover:underline text-[11px]"
                      >
                        {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                        {isExpanded ? "Hide Details" : "View Payload & Details"}
                      </button>

                      {isExpanded && (
                        <div className="mt-2 space-y-2 rounded-md bg-muted/40 p-3 font-mono text-[10px]">
                          {e.input && (
                            <div>
                              <p className="font-semibold text-muted-foreground">Input:</p>
                              <pre className="overflow-x-auto text-foreground">
                                {JSON.stringify(e.input, null, 2)}
                              </pre>
                            </div>
                          )}
                          {e.output && (
                            <div>
                              <p className="font-semibold text-muted-foreground">Output:</p>
                              <pre className="overflow-x-auto text-foreground">
                                {JSON.stringify(e.output, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </TabsContent>

        {/* 9. FINAL RECORD TAB */}
        <TabsContent value="record" className="space-y-6">
          {/* Preconditions Checklist Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Preconditions Checklist</CardTitle>
              <CardDescription>
                All verification, planning, inventory, and action milestones must be satisfied before finalization.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="grid gap-2 sm:grid-cols-2 text-xs">
                <li className="flex items-center gap-2 rounded-md border p-2.5">
                  {isVerified ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="size-4 text-destructive shrink-0" />
                  )}
                  <span>Identity Verification: {isVerified ? "Passed" : "Missing"}</span>
                </li>

                <li className="flex items-center gap-2 rounded-md border p-2.5">
                  {isPlanApproved ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="size-4 text-destructive shrink-0" />
                  )}
                  <span>Plan Approved: {isPlanApproved ? "Yes" : "Missing"}</span>
                </li>

                <li className="flex items-center gap-2 rounded-md border p-2.5">
                  {isInventoryReviewed ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="size-4 text-destructive shrink-0" />
                  )}
                  <span>Data Inventory: {isInventoryReviewed ? "Reviewed" : "Draft / Missing"}</span>
                </li>

                <li className="flex items-center gap-2 rounded-md border p-2.5">
                  {writeApprovalsResolved ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="size-4 text-destructive shrink-0" />
                  )}
                  <span>Write Approvals: {writeApprovalsResolved ? "Resolved" : "Pending decision"}</span>
                </li>

                <li className="flex items-center gap-2 rounded-md border p-2.5">
                  {writeActionsExecuted ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="size-4 text-destructive shrink-0" />
                  )}
                  <span>Write Executions: {writeActionsExecuted ? "Complete" : "Pending execution"}</span>
                </li>

                <li className="flex items-center gap-2 rounded-md border p-2.5">
                  {isExportReady ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="size-4 text-destructive shrink-0" />
                  )}
                  <span>Export Package: {isExportReady ? "Ready" : "Pending generation"}</span>
                </li>
              </ul>

              {!isFinalized && (
                <div className="pt-2">
                  <Button
                    onClick={() => setFinalizeDialogOpen(true)}
                    disabled={!preconditionsMet || Boolean(busyAction)}
                    className="w-full sm:w-auto"
                  >
                    <ClipboardCheck className="size-4" />
                    Finalize Fulfilment Record
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rendered Record Card (when finalized) */}
          {fulfilmentRecord && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="text-base">Fulfilment Record</CardTitle>
                    <CardDescription>
                      Cryptographically sealed, immutable record of completion.
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={`/api/requests/${encodeURIComponent(request.requestId)}/record?format=html`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted"
                    >
                      <Printer className="size-3.5" />
                      Print HTML
                    </a>
                    <a
                      href={`/api/requests/${encodeURIComponent(request.requestId)}/record?format=json`}
                      download={`${fulfilmentRecord.recordId}.json`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted"
                    >
                      <Download className="size-3.5" />
                      Download JSON
                    </a>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div className="grid gap-3 sm:grid-cols-2 rounded-md bg-muted/30 p-4">
                  <div>
                    <p className="text-muted-foreground">Record ID</p>
                    <p className="font-mono font-medium text-foreground">{fulfilmentRecord.recordId}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Finalized At</p>
                    <p className="font-medium text-foreground">{dateLabel(fulfilmentRecord.finalizedAt)}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-muted-foreground">Content Hash (SHA-256)</p>
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-xs break-all text-foreground">
                        {fulfilmentRecord.contentHash}
                      </code>
                      <Badge variant="default" className="text-[10px]">
                        Hash Verified
                      </Badge>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="font-semibold text-foreground">Summary Statement</p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">{fulfilmentRecord.summary}</p>
                </div>

                <div className="space-y-1">
                  <p className="font-semibold text-foreground">Disclaimers</p>
                  {fulfilmentRecord.disclaimers.map((d, i) => (
                    <p key={i} className="text-muted-foreground">
                      {d}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* DIALOG 1: EXTEND DEADLINE */}
      <Dialog open={extensionDialogOpen} onOpenChange={setExtensionDialogOpen}>
        <DialogContent>
          <form onSubmit={submitExtension} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Extend Request Deadline</DialogTitle>
              <DialogDescription>
                Provide the operational reason for granting a policy-permitted 30-day extension.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="ext-reason">Reason</Label>
              <Textarea
                id="ext-reason"
                required
                maxLength={2000}
                value={extensionReason}
                onChange={(e) => setExtensionReason(e.target.value)}
                placeholder="Describe complexity factors necessitating additional time"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setExtensionDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={Boolean(busyAction)}>
                Confirm Extension
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ALERT DIALOG: APPROVE PLAN */}
      <AlertDialog
        open={planApprovalDialogOpen}
        onOpenChange={setPlanApprovalDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {canDecideGeneral ? "Approve Proposed Plan?" : "Request Plan Approval?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This will {canDecideGeneral ? "approve" : "request approval for"} Plan {request.planVersion ?? "v1"} (Hash:{" "}
                {request.planHash ? shortenKey(request.planHash) : "N/A"}). This authorizes the read investigation steps and proposed action sets.
              </p>
              {!canDecideGeneral && (
                <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
                  <p className="font-semibold">Role: Analyst ({currentActorId})</p>
                  <p className="mt-0.5">
                    Under organizational policy, Analysts cannot decide approvals. Switch to <strong>Rahul (Approver)</strong> in the top-right header to approve this plan directly.
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busyAction)}
              onClick={handleApprovePlan}
            >
              {canDecideGeneral ? "Confirm Plan Approval" : "Request Approval"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ALERT DIALOG: APPROVE CORRECTION */}
      <AlertDialog
        open={confirmApproveKind === "CORRECTION"}
        onOpenChange={(open) => !open && setConfirmApproveKind(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Correction Actions?</AlertDialogTitle>
            <AlertDialogDescription>
              You are authorizing modifications to {correctionActions.length} record(s).
              Ensure all values have been verified against trusted documentation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busyAction)}
              onClick={() =>
                correctionApproval &&
                handleDecideApproval(correctionApproval, "APPROVED")
              }
            >
              Authorize Corrections
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ALERT DIALOG: REJECT CORRECTION */}
      <AlertDialog
        open={confirmRejectKind === "CORRECTION"}
        onOpenChange={(open) => !open && setConfirmRejectKind(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Correction Actions?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reject the correction proposal. The agent will need to replan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busyAction)}
              onClick={() =>
                correctionApproval &&
                handleDecideApproval(correctionApproval, "REJECTED")
              }
            >
              Confirm Rejection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ALERT DIALOG: APPROVE DELETION */}
      <AlertDialog
        open={confirmApproveKind === "DELETION"}
        onOpenChange={(open) => !open && setConfirmApproveKind(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Authorize Permanent Deletions?</AlertDialogTitle>
            <AlertDialogDescription>
              WARNING: Deletion actions are IRREVERSIBLE. You are authorizing the permanent removal or anonymization of {deletionActions.length} record(s).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={Boolean(busyAction)}
              onClick={() =>
                deletionApproval &&
                handleDecideApproval(deletionApproval, "APPROVED")
              }
            >
              Authorize Deletions
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ALERT DIALOG: REJECT DELETION */}
      <AlertDialog
        open={confirmRejectKind === "DELETION"}
        onOpenChange={(open) => !open && setConfirmRejectKind(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Deletion Proposal?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reject the deletion proposal. Reason comment: &apos;
              {deletionApproval ? decisionComments[deletionApproval.approvalId] : ""}
              &apos;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busyAction)}
              onClick={() =>
                deletionApproval &&
                handleDecideApproval(deletionApproval, "REJECTED")
              }
            >
              Confirm Rejection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ALERT DIALOG: APPROVE EXPORT */}
      <AlertDialog
        open={confirmApproveKind === "EXPORT"}
        onOpenChange={(open) => !open && setConfirmApproveKind(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Customer Export Package?</AlertDialogTitle>
            <AlertDialogDescription>
              You are authorizing generation and release of the customer data export. Policy redactions will automatically mask third-party and restricted content.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busyAction)}
              onClick={() =>
                exportApproval &&
                handleDecideApproval(exportApproval, "APPROVED")
              }
            >
              Authorize Export
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ALERT DIALOG: REJECT EXPORT */}
      <AlertDialog
        open={confirmRejectKind === "EXPORT"}
        onOpenChange={(open) => !open && setConfirmRejectKind(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Export Request?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reject the export approval. The inventory will need to be re-reviewed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busyAction)}
              onClick={() =>
                exportApproval &&
                handleDecideApproval(exportApproval, "REJECTED")
              }
            >
              Confirm Rejection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ALERT DIALOG: EXECUTE ACTIONS */}
      <AlertDialog
        open={Boolean(confirmExecuteKind)}
        onOpenChange={(open) => !open && setConfirmExecuteKind(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Execute Approved {confirmExecuteKind} Actions?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmExecuteKind === "DELETION"
                ? "This will permanently delete or anonymize target records across data stores. Actions are executed with strict idempotency leases."
                : "This will update field values across target data stores according to the approved correction plan."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirmExecuteKind === "DELETION"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
              disabled={Boolean(busyAction)}
              onClick={() =>
                confirmExecuteKind && handleExecuteActions(confirmExecuteKind)
              }
            >
              Confirm Execution
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ALERT DIALOG: FINALIZE REQUEST */}
      <AlertDialog
        open={finalizeDialogOpen}
        onOpenChange={setFinalizeDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize Request Fulfilment?</AlertDialogTitle>
            <AlertDialogDescription>
              Finalization seals the request with a cryptographic content hash. Once finalized, fulfilment records are write-once and permanently immutable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busyAction)}
              onClick={handleFinalize}
            >
              Confirm Finalization
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
