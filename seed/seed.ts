import { subDays, subHours } from "date-fns";
import mongoose from "mongoose";
import { loadEnvConfig } from "@next/env";
import { connectDB } from "@/lib/db";
import { ActionExecution } from "@/models/ActionExecution";
import { ActivityLog } from "@/models/ActivityLog";
import { Approval } from "@/models/Approval";
import { Counter } from "@/models/Counter";
import { DataInventory } from "@/models/DataInventory";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import { SupportTicket } from "@/models/SupportTicket";
import { UserProfile } from "@/models/UserProfile";

loadEnvConfig(process.cwd());

const now = new Date();
const demoUserId = "USR-1001";

const users = [
  {
    userId: demoUserId,
    fullName: "Priya Sharma",
    email: "priya.sharma@example.test",
    phone: "+1-202-555-0101",
    dateOfBirth: new Date("1991-04-18T00:00:00.000Z"),
    lastOrderCity: "Sample City",
    address: "100 Example Avenue, Sample City, CA 90001",
    preferences: { language: "en", theme: "light", notifications: true },
    marketingConsent: true,
    accountStatus: "active" as const,
    internalRiskScore: 18,
    internalRiskDetails: "CANARY-RISK-9931",
  },
  {
    userId: "USR-1002",
    fullName: "Priya Sharman",
    email: "priya.sharman@example.test",
    phone: "+1-202-555-0102",
    dateOfBirth: new Date("1988-09-02T00:00:00.000Z"),
    address: "22 Demo Street, Sample City, CA 90002",
    preferences: { language: "en", theme: "dark", notifications: false },
    marketingConsent: false,
    accountStatus: "active" as const,
    internalRiskScore: 7,
    internalRiskDetails: "Synthetic near-match profile for ambiguity tests.",
  },
  {
    userId: "USR-1003",
    fullName: "Marcus Lee",
    email: "marcus.lee@example.test",
    phone: "+1-202-555-0103",
    dateOfBirth: new Date("1985-02-11T00:00:00.000Z"),
    address: "5 Mockingbird Lane, Sample City, CA 90003",
    preferences: { language: "en", theme: "system" },
    marketingConsent: true,
    accountStatus: "active" as const,
    internalRiskScore: 12,
  },
  {
    userId: "USR-1004",
    fullName: "Elena Garcia",
    email: "elena.garcia@example.test",
    phone: "+1-202-555-0104",
    dateOfBirth: new Date("1993-07-24T00:00:00.000Z"),
    address: "81 Placeholder Road, Sample City, CA 90004",
    preferences: { language: "es", theme: "light" },
    marketingConsent: false,
    accountStatus: "active" as const,
    internalRiskScore: 4,
  },
  {
    userId: "USR-1005",
    fullName: "Noah Williams",
    email: "noah.williams@example.test",
    phone: "+1-202-555-0105",
    dateOfBirth: new Date("1979-12-05T00:00:00.000Z"),
    address: "9 Fictional Crescent, Sample City, CA 90005",
    preferences: { language: "en", theme: "dark" },
    marketingConsent: true,
    accountStatus: "suspended" as const,
    internalRiskScore: 31,
  },
  {
    userId: "USR-1006",
    fullName: "Aisha Patel",
    email: "aisha.patel@example.test",
    phone: "+1-202-555-0106",
    dateOfBirth: new Date("1990-03-16T00:00:00.000Z"),
    address: "14 Sample Plaza, Sample City, CA 90006",
    preferences: { language: "en", theme: "system" },
    marketingConsent: false,
    accountStatus: "active" as const,
    internalRiskScore: 9,
  },
  {
    userId: "USR-1007",
    fullName: "Daniel Kim",
    email: "daniel.kim@example.test",
    phone: "+1-202-555-0107",
    dateOfBirth: new Date("1982-11-30T00:00:00.000Z"),
    address: "3 Testing Terrace, Sample City, CA 90007",
    preferences: { language: "ko", theme: "light" },
    marketingConsent: true,
    accountStatus: "closed" as const,
    internalRiskScore: 15,
  },
  {
    userId: "USR-1008",
    fullName: "Sofia Martinez",
    email: "sofia.martinez@example.test",
    phone: "+1-202-555-0108",
    dateOfBirth: new Date("1996-06-09T00:00:00.000Z"),
    address: "47 Test Drive, Sample City, CA 90008",
    preferences: { language: "es", theme: "system" },
    marketingConsent: false,
    accountStatus: "active" as const,
    internalRiskScore: 3,
  },
];

const requests = [
  {
    requestId: "PRQ-2025-0001",
    type: "ACCESS" as const,
    status: "VERIFICATION_PENDING" as const,
    requesterName: "Priya Sharma",
    requesterEmail: "priya.sharma@example.test",
    rawText:
      "Please provide a copy of the information associated with my account.",
    subjectUserId: demoUserId,
    receivedAt: subDays(now, 27),
    dueAt: subDays(now, -3),
    extension: { applied: false },
    assignee: "u-analyst",
    verification: {
      status: "PENDING" as const,
      attempts: 1,
      factorsSubmitted: [
        {
          factor: "email_match",
          valueHash:
            "sha256:mock-email-proof-01-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
      score: 1,
    },
  },
  {
    requestId: "PRQ-2025-0002",
    type: "DELETION" as const,
    status: "RECEIVED" as const,
    requesterName: "Marcus Lee",
    requesterEmail: "marcus.lee@example.test",
    rawText: "Please remove my account and associated profile information.",
    subjectUserId: "USR-1003",
    receivedAt: subDays(now, 41),
    dueAt: subDays(now, 11),
    extension: { applied: false },
    assignee: "jordan.lee",
    verification: {
      status: "PENDING" as const,
      attempts: 0,
      factorsSubmitted: [],
      score: 0,
    },
  },
  {
    requestId: "PRQ-2025-0003",
    type: "CORRECTION" as const,
    status: "PLAN_PROPOSED" as const,
    requesterName: "Priya Sharma",
    requesterEmail: "priya.sharma@example.test",
    rawText: "Please correct the preferred contact address on my profile.",
    subjectUserId: demoUserId,
    receivedAt: subDays(now, 5),
    dueAt: subDays(now, -25),
    extension: { applied: false },
    assignee: "u-analyst",
    verification: {
      status: "PASSED" as const,
      attempts: 2,
      factorsSubmitted: [
        {
          factor: "email_match",
          valueHash:
            "sha256:mock-email-proof-03-cccccccccccccccccccccccccccccccccccccccc",
        },
        {
          factor: "knowledge_factor",
          valueHash:
            "sha256:mock-knowledge-proof-03-dddddddddddddddddddddddddddddddd",
        },
      ],
      score: 2,
      verifiedAt: subDays(now, 4),
      verifiedBy: "u-analyst",
    },
    plan: {
      summary: "Review and correct the profile contact address after approval.",
      proposedActions: [],
    },
    planVersion: "2025.1",
    planHash: "mock-plan-hash-0003",
  },
  {
    requestId: "PRQ-2025-0004",
    type: "ACCESS" as const,
    status: "SEARCHING" as const,
    requesterName: "Aisha Patel",
    requesterEmail: "aisha.patel@example.test",
    rawText: "I would like to see my recent account activity.",
    subjectUserId: "USR-1006",
    receivedAt: subDays(now, 12),
    dueAt: subDays(now, -18),
    extension: { applied: false },
    assignee: "sam.taylor",
    verification: {
      status: "PASSED" as const,
      attempts: 1,
      factorsSubmitted: [
        {
          factor: "email_match",
          valueHash:
            "sha256:mock-email-proof-04-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        },
        {
          factor: "account_id_or_phone_last4",
          valueHash:
            "sha256:mock-phone-proof-04-ffffffffffffffffffffffffffffffffffffffff",
        },
      ],
      score: 2,
      verifiedAt: subDays(now, 11),
      verifiedBy: "sam.taylor",
    },
  },
];

async function seed(): Promise<void> {
  await connectDB();

  await Promise.all([
    UserProfile.deleteMany({}),
    SupportTicket.deleteMany({}),
    ActivityLog.deleteMany({}),
    PrivacyRequest.deleteMany({}),
    DataInventory.deleteMany({}),
    Approval.deleteMany({}),
    ActionExecution.deleteMany({}),
    Counter.deleteMany({}),
  ]);

  await UserProfile.insertMany(users);

  await SupportTicket.insertMany([
    {
      ticketId: "TKT-PRIYA-001",
      userId: demoUserId,
      subject: "Update account contact details",
      status: "open",
      category: "account",
      messages: [
        {
          author: "Priya Sharma",
          authorType: "customer",
          text: "I need help reviewing the contact details on my account.",
          at: subDays(now, 3),
        },
        {
          author: "Support Agent Morgan",
          authorType: "agent",
          text: "We can help after confirming the requested account details.",
          at: subDays(now, 2),
        },
      ],
      internalNotes: ["Open ticket; do not delete while active."],
    },
    {
      ticketId: "TKT-PRIYA-002",
      userId: demoUserId,
      subject: "Question about a shared order",
      status: "closed",
      category: "order",
      messages: [
        {
          author: "Priya Sharma",
          authorType: "customer",
          text: "I have a question about an order placed with a friend.",
          at: subDays(now, 20),
        },
        {
          author: "Another Customer",
          authorType: "other_customer",
          text: "CANARY-OTHERCUST-7782: synthetic third-party text for redaction tests.",
          at: subDays(now, 20),
        },
        {
          author: "Support Agent Lee",
          authorType: "agent",
          text: "We answered the question and closed the ticket.",
          at: subDays(now, 19),
        },
      ],
      internalNotes: [
        "Internal mock note: do not include in customer export.",
        "Synthetic case reviewed by the privacy operations demo team.",
      ],
    },
    {
      ticketId: "TKT-PRIYA-003",
      userId: demoUserId,
      subject: "Account access review",
      status: "legal_hold",
      category: "account",
      messages: [
        {
          author: "Priya Sharma",
          authorType: "customer",
          text: "Please explain the recent account access notification.",
          at: subDays(now, 9),
        },
        {
          author: "Support Agent Morgan",
          authorType: "agent",
          text: "We are reviewing the notification and will follow up.",
          at: subDays(now, 8),
        },
      ],
      internalNotes: ["Synthetic legal hold; deletion must remain blocked."],
    },
    {
      ticketId: "TKT-PRIYA-004",
      userId: demoUserId,
      subject: "Notification preferences",
      status: "closed",
      category: "preferences",
      messages: [
        {
          author: "Priya Sharma",
          authorType: "customer",
          text: "How can I review my notification preferences?",
          at: subDays(now, 44),
        },
        {
          author: "Support Agent Patel",
          authorType: "agent",
          text: "The account settings page includes your notification options.",
          at: subDays(now, 43),
        },
      ],
      internalNotes: [],
    },
    {
      ticketId: "TKT-MARCUS-001",
      userId: "USR-1003",
      subject: "Sample delivery question",
      status: "closed",
      category: "delivery",
      messages: [
        {
          author: "Marcus Lee",
          authorType: "customer",
          text: "This is synthetic support-ticket content.",
          at: subDays(now, 7),
        },
      ],
      internalNotes: [],
    },
  ]);

  await ActivityLog.insertMany(
    Array.from({ length: 25 }, (_, index) => {
      const logNumber = String(index + 1).padStart(3, "0");
      const securityFlag = [2, 9, 18].includes(index);
      return {
        logId: `LOG-PRIYA-${logNumber}`,
        userId: demoUserId,
        event: [
          "session_started",
          "profile_viewed",
          "preferences_updated",
          "support_message_sent",
          "session_ended",
        ][index % 5],
        ip: `192.0.2.${10 + index}`,
        userAgent: "MockBrowser/1.0 (Synthetic Test Client)",
        at: subHours(now, index * 19),
        securityFlag,
        metadata: securityFlag
          ? { reviewTag: "synthetic-security-test", source: "mock-seed" }
          : { source: "mock-seed", sequence: index + 1 },
      };
    }),
  );

  await PrivacyRequest.insertMany(requests);
  await Counter.create({ _id: "privacyRequest", value: requests.length });

  const counts = await Promise.all([
    UserProfile.countDocuments(),
    SupportTicket.countDocuments(),
    ActivityLog.countDocuments(),
    PrivacyRequest.countDocuments(),
    Counter.countDocuments(),
  ]);

  console.log("Mock data seed completed:");
  console.log(`  User profiles: ${counts[0]}`);
  console.log(`  Support tickets: ${counts[1]} (4 for Priya Sharma)`);
  console.log(`  Activity logs: ${counts[2]} (25 for Priya Sharma, 3 security-flagged)`);
  console.log(`  Privacy requests: ${counts[3]} (1 at-risk, 1 overdue)`);
  console.log(`  Counters: ${counts[4]}`);
  console.log("  Audit events and finalized fulfilment records were not modified.");
}

seed()
  .catch((error: unknown) => {
    console.error("Mock data seed failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
