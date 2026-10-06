"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AuditFilterBarProps {
  initialRequestId?: string;
  initialEventType?: string;
  initialStatus?: string;
  auditEventTypes: readonly string[];
}

export function AuditFilterBar({
  initialRequestId = "",
  initialEventType = "",
  initialStatus = "",
  auditEventTypes,
}: AuditFilterBarProps) {
  const router = useRouter();
  const [requestId, setRequestId] = useState(initialRequestId);
  const [eventType, setEventType] = useState(initialEventType);
  const [status, setStatus] = useState(initialStatus);

  const isInitialMount = useRef(true);

  const pushParams = (newReqId: string, newEvt: string, newStat: string) => {
    const params = new URLSearchParams();
    if (newReqId.trim()) params.set("requestId", newReqId.trim());
    if (newEvt) params.set("eventType", newEvt);
    if (newStat) params.set("status", newStat);
    params.set("page", "1");
    const queryString = params.toString();
    router.push(queryString ? `/audit?${queryString}` : "/audit");
  };

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const timer = setTimeout(() => {
      pushParams(requestId, eventType, status);
    }, 300);
    return () => clearTimeout(timer);
  }, [requestId]);

  const handleEventTypeChange = (val: string | null) => {
    const next = val === "ALL" || !val ? "" : val;
    setEventType(next);
    pushParams(requestId, next, status);
  };

  const handleStatusChange = (val: string | null) => {
    const next = val === "ALL" || !val ? "" : val;
    setStatus(next);
    pushParams(requestId, eventType, next);
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <label className="sr-only" htmlFor="audit-request">
          Request ID
        </label>
        <Input
          id="audit-request"
          name="requestId"
          placeholder="Filter by Request ID"
          value={requestId}
          onChange={(e) => setRequestId(e.target.value)}
          maxLength={120}
          className="h-8 rounded-md"
        />
      </div>

      <div>
        <label className="sr-only" htmlFor="audit-event">
          Event type
        </label>
        <Select value={eventType || "ALL"} onValueChange={handleEventTypeChange}>
          <SelectTrigger id="audit-event" className="h-8 w-full rounded-md">
            <SelectValue placeholder="All event types" />
          </SelectTrigger>
          <SelectContent className="max-h-60 rounded-md">
            <SelectItem value="ALL" className="rounded-md">
              All event types
            </SelectItem>
            {auditEventTypes.map((type) => (
              <SelectItem key={type} value={type} className="rounded-md">
                {type.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="sr-only" htmlFor="audit-status">
          Event status
        </label>
        <Select value={status || "ALL"} onValueChange={handleStatusChange}>
          <SelectTrigger id="audit-status" className="h-8 w-full rounded-md">
            <SelectValue placeholder="All outcomes" />
          </SelectTrigger>
          <SelectContent className="rounded-md">
            <SelectItem value="ALL" className="rounded-md">
              All outcomes
            </SelectItem>
            <SelectItem value="ok" className="rounded-md">
              Success
            </SelectItem>
            <SelectItem value="denied" className="rounded-md">
              Denied
            </SelectItem>
            <SelectItem value="error" className="rounded-md">
              Error
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
