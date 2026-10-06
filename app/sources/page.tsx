import { Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { orgPolicy } from "@/policy/org-policy";

const classificationStyles: Record<string, string> = {
  PUBLIC: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
  PERSONAL: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
  SENSITIVE: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  RESTRICTED: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200",
  THIRD_PARTY: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-200",
  INTERNAL: "border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200",
};

const sourceDescriptions: Record<string, string> = {
  user_profiles: "Profile and account preference records used for mock identity matching and fulfilment.",
  support_tickets: "Customer support records. Third-party messages and internal notes are excluded from exports.",
  activity_logs: "Synthetic account activity. IP values are masked and security-flagged logs have a retention exception.",
};

export default function SourcesPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-medium text-primary">
          <Database className="size-4" aria-hidden="true" />
          Mock data catalog
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Data sources</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Read-only catalog of the three synthetic sources available to request workflows and their policy classifications.
        </p>
      </section>

      <div className="space-y-5">
        {Object.entries(orgPolicy.dataSources).map(([source, config]) => (
          <Card key={source}>
            <CardHeader>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <CardTitle className="font-mono text-lg">{source}</CardTitle>
                  <CardDescription className="mt-1 max-w-2xl">
                    {sourceDescriptions[source]}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {config.allowedOperations.map((operation) => (
                    <Badge key={operation} variant="outline">{operation}</Badge>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(config.fields).map(([field, classification]) => (
                  <div key={field} className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-muted/10 px-3 py-2">
                    <span className="truncate font-mono text-xs" title={field}>{field}</span>
                    <Badge
                      variant="outline"
                      className={classificationStyles[classification]}
                    >
                      {classification.replaceAll("_", " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
