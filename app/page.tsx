import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FilePlus2,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { connectDB } from "@/lib/db";
import { Approval } from "@/models/Approval";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import { requestStatuses, requestTypes } from "@/models/model-types";
import { DashboardFilterBar } from "@/components/dashboard-filter-bar";
import { getDeadlineInfo, listRequests } from "@/services/request-service";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "COMPLETED") return "default";
  if (status === "FAILED" || status === "REJECTED") return "destructive";
  if (status.startsWith("AWAITING_")) return "secondary";
  return "outline";
}

function deadlineColor(state: string): string {
  if (state === "OVERDUE") return "bg-destructive";
  if (state === "AT_RISK") return "bg-amber-500";
  return "bg-emerald-600";
}

function deadlineTextColor(state: string): string {
  if (state === "OVERDUE") return "text-destructive";
  if (state === "AT_RISK") return "text-amber-700 dark:text-amber-400";
  return "text-emerald-700 dark:text-emerald-400";
}

function StatCard({
  label,
  value,
  description,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  description: string;
  icon: typeof Activity;
  tone: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardDescription>{label}</CardDescription>
          <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
        </div>
        <span className={`rounded-md p-2.5 ${tone}`}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const filters = {
    status: first(query.status),
    type: first(query.type) as "ACCESS" | "CORRECTION" | "DELETION" | undefined,
    deadlineState: first(query.deadlineState) as
      | "ON_TRACK"
      | "AT_RISK"
      | "OVERDUE"
      | undefined,
    search: first(query.search),
    page: Number(first(query.page) ?? 1),
    pageSize: 10,
  };

  await connectDB();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [allRequests, pendingApprovals, completedThisMonth, result] =
    await Promise.all([
      PrivacyRequest.find({}).select("status receivedAt dueAt extension").lean(),
      Approval.countDocuments({ status: "PENDING" }),
      PrivacyRequest.countDocuments({
        status: "COMPLETED",
        updatedAt: { $gte: monthStart },
      }),
      listRequests(filters),
    ]);

  const active = allRequests.filter(
    (request) => request.status !== "COMPLETED" &&
      request.status !== "REJECTED" &&
      request.status !== "FAILED",
  );
  const deadlines = active.map((request) => getDeadlineInfo(request, now));
  const openCount = active.length;
  const atRiskCount = deadlines.filter((deadline) => deadline.state === "AT_RISK").length;
  const overdueCount = deadlines.filter((deadline) => deadline.state === "OVERDUE").length;
  const rows = result.requests
    .map(({ request }) => ({
      request,
      deadline: getDeadlineInfo(request, now),
    }))
    .sort(
      (left, right) =>
        new Date(left.request.dueAt).getTime() -
        new Date(right.request.dueAt).getTime(),
    );
  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.status) params.set("status", filters.status);
    if (filters.type) params.set("type", filters.type);
    if (filters.deadlineState) params.set("deadlineState", filters.deadlineState);
    params.set("page", String(targetPage));
    return `/?${params.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <p className="text-sm font-medium text-primary">Privacy operations overview</p>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Monitor request deadlines, review queues, and completed work across this mock workspace.
          </p>
        </div>
        <Link
          href="/requests/new"
          className={buttonVariants({ className: "self-start sm:self-auto" })}
        >
          <FilePlus2 aria-hidden="true" />
          New request
        </Link>
      </section>

      <section aria-label="Request statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Open requests"
          value={openCount}
          description="All requests not yet completed or closed."
          icon={Activity}
          tone="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
        />
        <StatCard
          label="At risk"
          value={atRiskCount}
          description="Seven days or less until the deadline."
          icon={Clock3}
          tone="bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        />
        <StatCard
          label="Overdue"
          value={overdueCount}
          description="Past the current effective deadline."
          icon={AlertTriangle}
          tone="bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
        />
        <StatCard
          label="Awaiting approval"
          value={pendingApprovals}
          description="Human approval decisions still pending."
          icon={ShieldAlert}
          tone="bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
        />
        <StatCard
          label="Completed this month"
          value={completedThisMonth}
          description="Requests completed since the start of this month."
          icon={CheckCircle2}
          tone="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        />
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <CardTitle>Requests by deadline</CardTitle>
              <CardDescription className="mt-1">
                Sorted by nearest due date. Use filters to narrow the work queue.
              </CardDescription>
            </div>
            <Badge variant="outline">{result.total} matching requests</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <DashboardFilterBar
            initialSearch={filters.search}
            initialStatus={filters.status}
            initialType={filters.type}
            initialDeadlineState={filters.deadlineState}
            requestStatuses={requestStatuses}
            requestTypes={requestTypes}
          />

          {rows.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 px-6 text-center">
              <FilePlus2 className="size-5 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">
                {result.total === 0 ? "No requests yet" : "No requests match these filters"}
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {result.total === 0
                  ? "Create a request to start the mock fulfilment workflow."
                  : "Adjust the filters or clear them to see more requests."}
              </p>
              {result.total === 0 && (
                <Link href="/requests/new" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-2" })}>
                  Create request <ArrowRight aria-hidden="true" />
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Requester</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Deadline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ request, deadline }) => (
                  <TableRow key={request.requestId}>
                    <TableCell>
                      <Link
                        href={`/requests/${encodeURIComponent(request.requestId)}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {request.requestId}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        Received {new Date(request.receivedAt).toLocaleDateString()}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-48 truncate">{request.requesterName}</TableCell>
                    <TableCell><Badge variant="outline">{request.type}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(request.status)}>
                        {request.status.replaceAll("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="min-w-48">
                      <div className="flex items-center justify-between gap-3">
                        <span className={`text-xs font-medium ${deadlineTextColor(deadline.state)}`}>
                          {deadline.state === "OVERDUE"
                            ? `${Math.abs(deadline.daysRemaining)}d overdue`
                            : `${deadline.daysRemaining}d remaining`}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(request.dueAt).toLocaleDateString()}
                        </span>
                      </div>
                      <Progress
                        value={deadline.percentElapsed}
                        aria-label={`${deadline.percentElapsed.toFixed(0)}% of SLA elapsed`}
                        className="mt-2 gap-0"
                        indicatorClassName={deadlineColor(deadline.state)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {result.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t pt-4">
              <Link
                href={pageHref(Math.max(1, result.page - 1))}
                aria-disabled={result.page <= 1}
                className={buttonVariants({
                  variant: "outline",
                  className: result.page <= 1 ? "pointer-events-none opacity-50" : "",
                })}
              >
                Previous
              </Link>
              <span className="text-xs text-muted-foreground">
                Page {result.page} of {result.totalPages}
              </span>
              <Link
                href={pageHref(Math.min(result.totalPages, result.page + 1))}
                aria-disabled={result.page >= result.totalPages}
                className={buttonVariants({
                  variant: "outline",
                  className:
                    result.page >= result.totalPages
                      ? "pointer-events-none opacity-50"
                      : "",
                })}
              >
                Next
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
