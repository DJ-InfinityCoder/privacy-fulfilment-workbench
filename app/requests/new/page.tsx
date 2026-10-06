import { FilePlus2 } from "lucide-react";
import { RequestIntakeForm } from "@/components/request-intake-form";

export default function NewRequestPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-medium text-primary">
          <FilePlus2 className="size-4" aria-hidden="true" />
          Intake
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">New request</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Create an internal mock request record. A staff member will verify identity before data is searched.
        </p>
      </div>
      <RequestIntakeForm />
    </div>
  );
}
