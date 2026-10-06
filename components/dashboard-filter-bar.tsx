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
import type { RequestStatus, RequestType } from "@/models/model-types";

interface DashboardFilterBarProps {
  initialSearch?: string;
  initialStatus?: string;
  initialType?: string;
  initialDeadlineState?: string;
  requestStatuses: readonly RequestStatus[];
  requestTypes: readonly RequestType[];
}

export function DashboardFilterBar({
  initialSearch = "",
  initialStatus = "",
  initialType = "",
  initialDeadlineState = "",
  requestStatuses,
  requestTypes,
}: DashboardFilterBarProps) {
  const router = useRouter();
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState(initialStatus);
  const [type, setType] = useState(initialType);
  const [deadlineState, setDeadlineState] = useState(initialDeadlineState);

  const isInitialMount = useRef(true);

  const pushParams = (
    newSearch: string,
    newStatus: string,
    newType: string,
    newDeadline: string,
  ) => {
    const params = new URLSearchParams();
    if (newSearch.trim()) params.set("search", newSearch.trim());
    if (newStatus) params.set("status", newStatus);
    if (newType) params.set("type", newType);
    if (newDeadline) params.set("deadlineState", newDeadline);
    const queryString = params.toString();
    router.push(queryString ? `/?${queryString}` : "/");
  };

  // Debounced search on input change
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const timer = setTimeout(() => {
      pushParams(search, status, type, deadlineState);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleStatusChange = (val: string | null) => {
    const next = val === "ALL" || !val ? "" : val;
    setStatus(next);
    pushParams(search, next, type, deadlineState);
  };

  const handleTypeChange = (val: string | null) => {
    const next = val === "ALL" || !val ? "" : val;
    setType(next);
    pushParams(search, status, next, deadlineState);
  };

  const handleDeadlineChange = (val: string | null) => {
    const next = val === "ALL" || !val ? "" : val;
    setDeadlineState(next);
    pushParams(search, status, type, next);
  };

  return (
    <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1.4fr)_repeat(3,minmax(9rem,1fr))]">
      <div>
        <label className="sr-only" htmlFor="request-search">
          Search requests
        </label>
        <Input
          id="request-search"
          name="search"
          placeholder="Search ID, requester, or request text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 rounded-md"
        />
      </div>

      <div>
        <label className="sr-only" htmlFor="status-filter">
          Filter by status
        </label>
        <Select value={status || "ALL"} onValueChange={handleStatusChange}>
          <SelectTrigger id="status-filter" className="h-8 w-full rounded-md">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent className="max-h-60 rounded-md">
            <SelectItem value="ALL" className="rounded-md">
              All statuses
            </SelectItem>
            {requestStatuses.map((s) => (
              <SelectItem key={s} value={s} className="rounded-md">
                {s.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="sr-only" htmlFor="type-filter">
          Filter by request type
        </label>
        <Select value={type || "ALL"} onValueChange={handleTypeChange}>
          <SelectTrigger id="type-filter" className="h-8 w-full rounded-md">
            <SelectValue placeholder="All request types" />
          </SelectTrigger>
          <SelectContent className="rounded-md">
            <SelectItem value="ALL" className="rounded-md">
              All request types
            </SelectItem>
            {requestTypes.map((t) => (
              <SelectItem key={t} value={t} className="rounded-md">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="sr-only" htmlFor="deadline-filter">
          Filter by deadline
        </label>
        <Select value={deadlineState || "ALL"} onValueChange={handleDeadlineChange}>
          <SelectTrigger id="deadline-filter" className="h-8 w-full rounded-md">
            <SelectValue placeholder="All deadlines" />
          </SelectTrigger>
          <SelectContent className="rounded-md">
            <SelectItem value="ALL" className="rounded-md">
              All deadlines
            </SelectItem>
            <SelectItem value="ON_TRACK" className="rounded-md">
              On track
            </SelectItem>
            <SelectItem value="AT_RISK" className="rounded-md">
              At risk
            </SelectItem>
            <SelectItem value="OVERDUE" className="rounded-md">
              Overdue
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
