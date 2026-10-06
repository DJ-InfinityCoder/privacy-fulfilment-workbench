import { AlertCircle, Bot, Fingerprint, LockKeyhole, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { orgPolicy } from "@/policy/org-policy";

export default function PolicyPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-medium text-primary">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Policy reference · Version {orgPolicy.version}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Organizational policy</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Read-only summary of the rules enforced by this demonstration workbench.
        </p>
      </section>

      <Alert>
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Internal policy only</AlertTitle>
        <AlertDescription>{orgPolicy.disclaimers.footer}</AlertDescription>
      </Alert>

      <section aria-labelledby="sla-heading" className="space-y-4">
        <div>
          <h2 id="sla-heading" className="text-xl font-semibold tracking-tight">Request timelines</h2>
          <p className="text-sm text-muted-foreground">One extension is allowed when a reason is recorded.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {Object.entries(orgPolicy.requestTypes).map(([type, rule]) => (
            <Card key={type}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {type}
                  <Badge variant={rule.requiresSeparateApproval ? "secondary" : "outline"}>
                    {rule.requiresSeparateApproval ? "Separate approval" : "No action approval"}
                  </Badge>
                </CardTitle>
                <CardDescription>{rule.slaDays}-day standard service target</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Maximum extension: {rule.extensionDays} days</p>
                <p>Extension limit: {rule.maxExtensions}</p>
                <p>Reason required: {rule.extensionReasonRequired ? "Yes" : "No"}</p>
                <p>Identity verification: {rule.requiresVerification ? "Required" : "Not required"}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="verification-heading" className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Fingerprint className="size-4 text-primary" aria-hidden="true" />
              Verification
            </CardTitle>
            <CardDescription>Passed only with the required combination of factors.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              {orgPolicy.verification.factors.map((factor) => (
                <Badge key={factor} variant="outline">{factor.replaceAll("_", " ")}</Badge>
              ))}
            </div>
            <Separator />
            <p>Minimum matching factors: {orgPolicy.verification.minimumFactors} of {orgPolicy.verification.factors.length}</p>
            <p>Required factor: <span className="font-medium">{orgPolicy.verification.requiredFactor.replaceAll("_", " ")}</span></p>
            <p>Maximum attempts: {orgPolicy.verification.maxAttempts}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LockKeyhole className="size-4 text-primary" aria-hidden="true" />
              Retention and deletion exceptions
            </CardTitle>
            <CardDescription>These records are retained, restricted, or transformed according to policy.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="font-medium">Activity logs</p>
              <p className="text-muted-foreground">
                Security-flagged logs are retained for {orgPolicy.retentionDeletionExceptions.activityLogs.retentionDays} days.
                Exception {orgPolicy.retentionDeletionExceptions.activityLogs.exceptionCode}.
              </p>
            </div>
            <Separator />
            <div>
              <p className="font-medium">Support tickets</p>
              {Object.entries(orgPolicy.retentionDeletionExceptions.supportTickets.blockedStatuses).map(([status, code]) => (
                <p key={status} className="text-muted-foreground">
                  {status.replaceAll("_", " ")} tickets cannot be deleted ({code}).
                </p>
              ))}
              <p className="mt-1 text-muted-foreground">
                Other customers’ and agents’ text is third-party data.
              </p>
            </div>
            <Separator />
            <div>
              <p className="font-medium">User profiles</p>
              <p className="text-muted-foreground">
                Deletion creates an anonymized tombstone rather than hard-deleting the profile.
                Exception {orgPolicy.retentionDeletionExceptions.userProfiles.exceptionCode}.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Export redaction rules</CardTitle>
          <CardDescription>Policy rules applied before export data leaves the workbench.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {orgPolicy.redactionRules.map((rule) => (
            <div key={rule.id} className="rounded-md border bg-muted/20 p-3">
              <p className="font-mono text-xs font-medium">{rule.id}</p>
              <p className="mt-1 text-sm">{rule.action.replaceAll("_", " ")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {"classification" in rule
                  ? `Classification: ${rule.classification}`
                  : "field" in rule
                    ? `Field: ${rule.field}`
                    : "Applies to unclassified data"}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-primary" aria-hidden="true" />
            Agent tool permissions
          </CardTitle>
          <CardDescription>
            The agent may read and propose only. Writes run as the system after separate human approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(orgPolicy.agentPermissions).map(([name, permission]) => (
            <div key={name} className="flex flex-col justify-between gap-2 rounded-md border p-3 sm:flex-row sm:items-center">
              <div>
                <p className="font-mono text-sm">{name}</p>
                <p className="text-xs text-muted-foreground">
                  Allowed roles: {permission.allowedRoles.join(", ")}
                  {"approvalKind" in permission && permission.approvalKind
                    ? ` · Approval: ${permission.approvalKind}`
                    : ""}
                </p>
              </div>
              <Badge variant={permission.type === "write" ? "destructive" : "outline"}>
                {permission.type}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
