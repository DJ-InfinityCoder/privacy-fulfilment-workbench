"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import type { VerificationFactor } from "@/policy/org-policy";

type VerificationPanelProps = {
  requestId: string;
  requesterEmail?: string;
  attempts?: number;
  maxAttempts?: number;
  providedFactors?: VerificationFactor[];
  missingFactors?: VerificationFactor[];
  onVerified?: () => void;
  onGoToPlan?: () => void;
  currentRole?: string;
};

type VerificationResponse = {
  ok: boolean;
  data?: {
    status: "PASSED" | "FAILED" | "LOCKED" | "AMBIGUOUS";
    missing: VerificationFactor[];
    attempts: number;
    attemptsRemaining: number;
  };
  error?: {
    message: string;
  };
};

const factorLabels: Record<VerificationFactor, string> = {
  email_match: "Email",
  account_id_or_phone_last4: "Account ID or phone last 4",
  knowledge_factor: "Date of birth or last order city",
};

export function VerificationPanel({
  requestId,
  requesterEmail = "",
  attempts: initialAttempts = 0,
  maxAttempts = 3,
  providedFactors: initialProvidedFactors = [],
  missingFactors: initialMissingFactors = [],
  onVerified,
  onGoToPlan,
  currentRole = "analyst",
}: VerificationPanelProps) {
  const [email, setEmail] = useState(requesterEmail);
  const [accountId, setAccountId] = useState("");
  const [phoneLast4, setPhoneLast4] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [lastOrderCity, setLastOrderCity] = useState("");
  const [attempts, setAttempts] = useState(initialAttempts);
  const [providedFactors, setProvidedFactors] =
    useState<VerificationFactor[]>(initialProvidedFactors);
  const [missingFactors, setMissingFactors] =
    useState<VerificationFactor[]>(initialMissingFactors);
  const [result, setResult] = useState<VerificationResponse["data"]>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  // Approver override state
  const [overrideUserId, setOverrideUserId] = useState("USR-0001");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideSuccess, setOverrideSuccess] = useState(false);

  const isLocked = result?.status === "LOCKED" || attempts >= maxAttempts;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);

    try {
      const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}/verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ...(accountId ? { accountId } : {}),
          ...(phoneLast4 ? { phoneLast4 } : {}),
          ...(dateOfBirth ? { dateOfBirth } : {}),
          ...(lastOrderCity ? { lastOrderCity } : {}),
        }),
      });
      const payload = (await response.json()) as VerificationResponse;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Verification could not be completed.");
      }

      setResult(payload.data);
      setAttempts(payload.data.attempts);
      setMissingFactors(payload.data.missing);
      const provided: VerificationFactor[] = ["email_match"];
      if (accountId || phoneLast4) {
        provided.push("account_id_or_phone_last4");
      }
      if (dateOfBirth || lastOrderCity) {
        provided.push("knowledge_factor");
      }
      setProvidedFactors(provided);
      if (payload.data.status === "PASSED") {
        onVerified?.();
      }
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Verification could not be completed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOverride(event: FormEvent) {
    event.preventDefault();
    setOverrideSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/requests/${encodeURIComponent(requestId)}/verification/override`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectUserId: overrideUserId.trim(),
            reason: overrideReason.trim(),
          }),
        },
      );
      const payload: unknown = await response.json();
      const res = payload as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || !res?.ok) {
        throw new Error(res?.error?.message ?? "Approver override failed.");
      }
      setOverrideSuccess(true);
      onVerified?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Approver override failed.");
    } finally {
      setOverrideSubmitting(false);
    }
  }

  return (
    <section className="space-y-5 rounded-md border bg-card p-5">
      <header className="flex items-start gap-3">
        <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <h2 className="font-semibold">Identity verification</h2>
          <p className="text-sm text-muted-foreground">
            Confirm at least two factors, including the account email.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">MOCK verification: demonstration only</Badge>
            <Badge variant="secondary" className="text-xs">
              Role: {currentRole}
            </Badge>
          </div>
        </div>
      </header>

      <div className="flex items-center gap-2 rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span>💡 <strong>Seed Record Reference:</strong> Account ID <code className="font-mono text-foreground">USR-1001</code> · Date of Birth: <code className="font-mono text-foreground">1991-04-18</code> (April 18, 1991) · Last order city: <code className="font-mono text-foreground">Sample City</code></span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {(["email_match", "account_id_or_phone_last4", "knowledge_factor"] as const).map(
          (factor) => {
            const provided = providedFactors.includes(factor);
            const missing = missingFactors.includes(factor);
            return (
              <div
                key={factor}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span>{factorLabels[factor]}</span>
                <Badge
                  variant={missing ? "destructive" : provided ? "default" : "outline"}
                >
                  {missing ? "Unmatched" : provided ? "Verified" : "Not provided"}
                </Badge>
              </div>
            );
          },
        )}
      </div>

      {(result?.status === "PASSED" || overrideSuccess) && (
        <Alert>
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>Identity verified</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>The request is verified. Continue with the next review step.</p>
            {onGoToPlan && (
              <Button size="sm" onClick={onGoToPlan} className="mt-2">
                Continue to AI Planning Assistant →
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {isLocked && !overrideSuccess && (
        <div className="space-y-4 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start gap-2.5 text-destructive">
            <AlertCircle className="size-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">Verification locked (Maximum 3 attempts reached)</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {currentRole === "analyst"
                  ? "As an Analyst, you cannot override verification lockout under organizational policy. An authorized Approver must inspect supporting evidence and submit an override."
                  : "Approver Authorization Active: You are logged in as an authorized Approver to record an audited verification override."}
              </p>
            </div>
          </div>

          {currentRole !== "analyst" ? (
            <form onSubmit={handleOverride} className="space-y-3 pt-2 border-t border-destructive/20">
              <p className="text-xs font-semibold text-foreground">Record Approver Override</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="override-userid" className="text-xs">Subject User ID</Label>
                  <Input
                    id="override-userid"
                    value={overrideUserId}
                    onChange={(e) => setOverrideUserId(e.target.value)}
                    required
                    placeholder="e.g. USR-0001"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="override-reason" className="text-xs">Override Justification</Label>
                  <Input
                    id="override-reason"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    required
                    placeholder="e.g. Identity verified via government ID and phone confirmation"
                  />
                </div>
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={overrideSubmitting || !overrideReason.trim()}
              >
                {overrideSubmitting ? "Recording override..." : "Apply Approver Override"}
              </Button>
            </form>
          ) : (
            <div className="pt-2 border-t border-destructive/20 text-xs text-muted-foreground">
              Override controls are disabled for Analyst. Switch role to <strong>Approver</strong> to review and record an override.
            </div>
          )}
        </div>
      )}

      {result && result.status !== "PASSED" && !isLocked && (
        <Alert variant={result.status === "AMBIGUOUS" ? "default" : "destructive"}>
          <AlertCircle aria-hidden="true" />
          <AlertTitle>
            {result.status === "AMBIGUOUS"
              ? "More information required"
              : "Verification incomplete"}
          </AlertTitle>
          <AlertDescription className="space-y-1">
            <p>
              {result.status === "AMBIGUOUS"
                ? "Multiple profiles match. Provide an account ID to identify the correct profile."
                : "Submitted factor values did not match database records. Review the factors and retry."}
            </p>
            {result.status === "FAILED" && (
              <p className="text-xs text-muted-foreground">
                Tip: For Priya Sharma, the seeded record matches Email: <code className="font-mono text-foreground">priya.sharma@example.test</code>, Account ID: <code className="font-mono text-foreground">USR-1001</code>, DOB: <code className="font-mono text-foreground">1991-04-18</code> (April 18, 1991) or City: <code className="font-mono text-foreground">Sample City</code>.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Verification error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="verification-email">Email</Label>
            <Input
              id="verification-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isLocked || submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="verification-account-id">Account ID</Label>
            <Input
              id="verification-account-id"
              autoComplete="off"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              disabled={isLocked || submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="verification-phone">Phone last 4 digits</Label>
            <Input
              id="verification-phone"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              value={phoneLast4}
              onChange={(event) => setPhoneLast4(event.target.value)}
              disabled={isLocked || submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="verification-dob">Date of birth</Label>
            <DatePicker
              id="verification-dob"
              value={dateOfBirth}
              onChange={(val) => setDateOfBirth(val)}
              disabled={isLocked || submitting}
              placeholder="Select date of birth"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="verification-city">Last order city</Label>
            <Input
              id="verification-city"
              value={lastOrderCity}
              onChange={(event) => setLastOrderCity(event.target.value)}
              disabled={isLocked || submitting}
            />
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Attempts: {attempts} of {maxAttempts}
          </p>
          <Button type="submit" disabled={isLocked || submitting}>
            {submitting ? "Checking..." : "Submit verification"}
          </Button>
        </div>
      </form>
    </section>
  );
}
