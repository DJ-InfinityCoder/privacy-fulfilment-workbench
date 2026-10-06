"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { orgPolicy } from "@/policy/org-policy";
import { computeDueDate } from "@/policy/policy-engine";

const intakeSchema = z.object({
  requesterName: z.string().trim().min(1, "Enter the requester name.").max(200),
  requesterEmail: z.email("Enter a valid email address.").max(320),
  type: z.enum(["ACCESS", "CORRECTION", "DELETION"]),
  rawText: z.string().trim().min(1, "Describe the request.").max(10_000),
  receivedAt: z.iso.date("Choose a valid received date."),
});

type IntakeValues = z.infer<typeof intakeSchema>;

const today = new Date().toISOString().slice(0, 10);

export function RequestIntakeForm() {
  const router = useRouter();
  const [type, setType] = useState<IntakeValues["type"]>("ACCESS");
  const [receivedAt, setReceivedAt] = useState(today);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [createdRequestId, setCreatedRequestId] = useState<string | null>(null);

  const slaDays = orgPolicy.requestTypes[type].slaDays;
  const dueDate = receivedAt
    ? computeDueDate(receivedAt, type, false).toLocaleDateString()
    : "—";

  async function submitForm(formData: FormData) {
    const parsed = intakeSchema.safeParse({
      requesterName: formData.get("requesterName"),
      requesterEmail: formData.get("requesterEmail"),
      type,
      rawText: formData.get("rawText"),
      receivedAt,
    });
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => issue.message);
      setErrors(messages);
      toast.error("Check the highlighted request details.");
      return;
    }

    setErrors([]);
    setSubmitting(true);
    setCreatedRequestId(null);
    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const payload: unknown = await response.json();
      const responseSchema = z.object({
        ok: z.boolean(),
        data: z.object({ requestId: z.string() }).optional(),
        error: z.object({ message: z.string() }).optional(),
      });
      const result = responseSchema.safeParse(payload);
      if (!response.ok || !result.success || !result.data.ok || !result.data.data) {
        throw new Error(
          result.success
            ? result.data.error?.message ?? "The request could not be created."
            : "The server returned an invalid response.",
        );
      }
      const createdId = result.data.data.requestId;
      setCreatedRequestId(createdId);
      toast.success(`Request ${createdId} created. Redirecting to workbench...`);
      router.push(`/requests/${encodeURIComponent(createdId)}`);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "The request could not be created.";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Request details</CardTitle>
        <CardDescription>
          Enter mock request information. Do not use real personal data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {errors.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Review these fields</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-5">
                {errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {createdRequestId && (
          <Alert>
            <AlertTitle>Request created</AlertTitle>
            <AlertDescription>
              {createdRequestId} is ready for verification and review.
              <button
                type="button"
                className="ml-1 font-medium text-primary underline underline-offset-4"
                onClick={() => router.push("/")}
              >
                Return to dashboard
              </button>
            </AlertDescription>
          </Alert>
        )}

        <form action={submitForm} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="requesterName">Requester name</Label>
              <Input
                id="requesterName"
                name="requesterName"
                autoComplete="name"
                required
                maxLength={200}
                placeholder="e.g. Alex Morgan"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="requesterEmail">Requester email</Label>
              <Input
                id="requesterEmail"
                name="requesterEmail"
                type="email"
                autoComplete="email"
                required
                maxLength={320}
                placeholder="alex@example.test"
              />
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="requestType">Request type</Label>
              <Select
                value={type}
                onValueChange={(val) => setType(val as IntakeValues["type"])}
              >
                <SelectTrigger id="requestType" className="h-9 w-full rounded-md">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent className="rounded-md">
                  <SelectItem value="ACCESS" className="rounded-md">
                    Access
                  </SelectItem>
                  <SelectItem value="CORRECTION" className="rounded-md">
                    Correction
                  </SelectItem>
                  <SelectItem value="DELETION" className="rounded-md">
                    Deletion
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Internal SLA: {slaDays} days. Due date for this intake: {dueDate}.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="receivedAt">Received date</Label>
              <DatePicker
                id="receivedAt"
                name="receivedAt"
                value={receivedAt}
                onChange={(val) => setReceivedAt(val)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rawText">Request description</Label>
            <Textarea
              id="rawText"
              name="rawText"
              required
              minLength={1}
              maxLength={10_000}
              rows={6}
              placeholder="Summarize the request using synthetic demonstration data."
            />
            <p className="text-xs text-muted-foreground">
              Treat all supplied text as untrusted data. Do not include real PII.
            </p>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/")}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create request"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
