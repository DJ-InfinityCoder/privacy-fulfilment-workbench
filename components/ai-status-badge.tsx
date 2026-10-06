"use client";

import { useEffect, useState } from "react";
import { Sparkles, AlertCircle } from "lucide-react";

type ProviderStatus = {
  configured: boolean;
  circuitOpen: boolean;
  lastError: { code: string; at: string } | null;
  lastSuccessAt: string | null;
};

type HealthResponse = {
  ok: boolean;
  data?: {
    providers: Record<string, ProviderStatus>;
  };
};

function formatProviderName(name: string): string {
  if (name.toLowerCase() === "gemini") return "Gemini";
  if (name.toLowerCase() === "groq") return "Groq";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function AIStatusBadge() {
  const [providers, setProviders] = useState<Record<string, ProviderStatus>>({});
  const [healthUnavailable, setHealthUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/ai/health", { cache: "no-store" });
        const payload = (await response.json()) as HealthResponse;
        if (active && response.ok && payload.ok && payload.data) {
          setProviders(payload.data.providers);
          setHealthUnavailable(false);
        } else if (active) {
          setHealthUnavailable(true);
        }
      } catch {
        if (active) {
          setHealthUnavailable(true);
        }
      }
    };

    void load();
    const interval = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const available = Object.entries(providers)
    .filter(([, provider]) => provider.configured && !provider.circuitOpen)
    .map(([name]) => name);
  const unavailable = Object.entries(providers)
    .filter(([, provider]) => !provider.configured || provider.circuitOpen)
    .map(([name]) => name);

  if (healthUnavailable) {
    return (
      <div
        className="flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2.5 text-xs text-muted-foreground shadow-2xs"
        title="AI provider health could not be retrieved."
        aria-label="AI provider status unavailable"
      >
        <AlertCircle className="size-3.5 text-amber-500" />
        <span className="font-medium">AI: Status Unavailable</span>
      </div>
    );
  }

  const isOnline = available.length > 0;
  const displayText = isOnline
    ? available.map(formatProviderName).join(" + ")
    : "Rule-Based Fallback";

  return (
    <div
      className="flex h-8 items-center gap-2 rounded-md border border-border/80 bg-background/80 px-2.5 text-xs text-foreground shadow-2xs"
      title={
        unavailable.length > 0
          ? `Online: ${available.join(", ") || "None"}. Offline: ${unavailable.join(", ")}`
          : `Active AI Providers: ${available.join(", ")}`
      }
      aria-label={
        isOnline
          ? `AI active: ${displayText}`
          : "AI running in deterministic fallback mode"
      }
    >
      <span className="relative flex size-2">
        {isOnline && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex size-2 rounded-full ${
            isOnline ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
      </span>
      <Sparkles className="size-3.5 text-primary" />
      <span className="text-muted-foreground">AI:</span>
      <span className="font-semibold text-foreground">{displayText}</span>
    </div>
  );
}
