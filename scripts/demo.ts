import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { connectDB } from "@/lib/db";
import { createRequest } from "@/services/request-service";
import { verifyRequestIdentity } from "@/services/verification-service";
import { runAgent } from "@/agent/agent";
import { requestApproval, decideApproval } from "@/services/approval-service";
import { runSearch } from "@/services/search-service";
import { reviewInventory } from "@/services/inventory-service";
import { executeApprovedActions } from "@/services/action-service";
import { finalizeRequest, getFulfilmentRecord } from "@/services/fulfilment-service";
import { listAudit, verifyAuditChain } from "@/services/audit-service";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import { UserProfile } from "@/models/UserProfile";

async function main() {
  console.log("\n================================================================================");
  console.log("  DATA PRIVACY REQUEST FULFILMENT WORKBENCH - END-TO-END PIPELINE DEMO");
  console.log("================================================================================\n");

  await connectDB();

  // Find or create a demo user to operate on
  let user = await UserProfile.findOne({ userId: "USR-DEMO-001" });
  if (!user) {
    user = await UserProfile.create({
      userId: "USR-DEMO-001",
      fullName: "Priya Sharma",
      email: "priya.sharma@example.test",
      phone: "+1-202-555-0101",
      dateOfBirth: new Date("1991-04-18T00:00:00.000Z"),
      lastOrderCity: "Sample City",
      address: "100 Example Avenue, Sample City, CA 90001",
      preferences: { language: "en", theme: "light" },
      marketingConsent: true,
      accountStatus: "active",
      internalRiskScore: 18,
      internalRiskDetails: "CANARY-RISK-DEMO",
    });
  } else {
    // Reset status and fields for demonstration replay
    await UserProfile.updateOne(
      { userId: "USR-DEMO-001" },
      {
        $set: {
          fullName: "Priya Sharma",
          email: "priya.sharma@example.test",
          phone: "+1-202-555-0101",
          dateOfBirth: new Date("1991-04-18T00:00:00.000Z"),
          lastOrderCity: "Sample City",
          address: "100 Example Avenue, Sample City, CA 90001",
          accountStatus: "active",
          marketingConsent: true,
          internalRiskScore: 18,
        },
      },
    );
    user = (await UserProfile.findOne({ userId: "USR-DEMO-001" }))!;
  }

  const requesterEmail = user.email;
  const requesterName = user.fullName;
  const analystActor = { actorId: "u-analyst", actorType: "human" as const, role: "analyst" };
  const approverActor = { actorId: "u-approver", actorType: "human" as const, role: "approver" };

  // 1. Intake
  console.log("1. INTAKE: Creating new DELETION request...");
  const request = await createRequest(
    {
      type: "DELETION",
      requesterName,
      requesterEmail,
      rawText: "Please delete my account and personal data per organizational privacy policy.",
      assignee: analystActor.actorId,
    },
    { actorId: "intake-portal", actorType: "system" },
  );
  const requestId = request.requestId;
  console.log(`   ✓ Request Created: ${requestId} (Type: ${request.type}, Status: ${request.status})\n`);

  // 2. Identity Verification
  console.log("2. VERIFICATION: Submitting identity factor proof...");
  const verification = await verifyRequestIdentity(
    requestId,
    {
      email: requesterEmail,
      accountId: user.userId,
      lastOrderCity: "Sample City",
    },
    { actorId: analystActor.actorId, actorType: "human" },
  );
  console.log(`   ✓ Identity Verified: Status=${verification.status}, Attempts=${verification.attempts}\n`);

  // 3. Autonomous AI Planning
  console.log("3. AGENT PLAN: Generating policy-checked fulfilment plan...");
  const planResult = await runAgent(requestId, { mode: "plan" });
  console.log(`   ✓ Plan Generated: Version=${planResult.planVersion}, Provider=${planResult.plan.generatedBy.provider}`);
  console.log(`     Confidence: ${Math.round(planResult.plan.interpretation.confidence * 100)}%`);
  console.log(`     Proposed Write Actions: ${planResult.plan.proposedActions.length}\n`);

  // 4. Plan Approval
  console.log("4. PLAN APPROVAL: Requesting and granting plan approval...");
  const planApproval = await requestApproval(requestId, "PLAN", analystActor);
  await decideApproval(planApproval.approvalId, "APPROVED", approverActor);
  console.log(`   ✓ Plan Approval Granted: ${planApproval.approvalId} (Decided by: ${approverActor.actorId})\n`);

  // 5. Discovery & Inventory
  console.log("5. SEARCH & INVENTORY: Discovering records and reviewing field classifications...");
  const inventory = await runSearch(requestId, { actorId: analystActor.actorId, actorType: "system" });
  console.log(`   ✓ Inventory Generated: Version ${inventory.version} with ${inventory.items.length} records`);

  await reviewInventory(
    requestId,
    {
      inventoryVersion: inventory.version,
      fields: inventory.items.flatMap((item) =>
        item.fields.map((field) => ({
          source: item.source,
          recordId: item.recordId,
          fieldName: field.name,
          includeInExport: false,
        })),
      ),
      comment: "All records reviewed for deletion eligibility.",
    },
    analystActor,
  );
  console.log(`   ✓ Inventory Marked Reviewed (Status: REVIEWED)\n`);

  // 6. Action Authorization (Four-Eyes Rule)
  console.log("6. ACTION APPROVAL: Requesting DELETION approval under four-eyes principle...");
  const deletionApproval = await requestApproval(requestId, "DELETION", analystActor);
  await decideApproval(deletionApproval.approvalId, "APPROVED", approverActor);
  console.log(`   ✓ Deletion Approved: ${deletionApproval.approvalId} (Decided by: ${approverActor.actorId})\n`);

  // 7. Execution (Idempotent)
  console.log("7. EXECUTION: Executing approved deletions...");
  const execution = await executeApprovedActions(requestId, "DELETION", {
    actorId: "executor-service",
    actorType: "system",
  });
  console.log(`   ✓ Executed ${execution.outcomes.length} action(s):`);
  for (const outcome of execution.outcomes) {
    console.log(`     - [${outcome.status}] Action ${outcome.actionId} (Idempotency: ${outcome.idempotencyKey.slice(0, 12)}...)`);
  }

  // Verify idempotency replay
  console.log("   Replaying execution to demonstrate idempotency guarantee...");
  const replay = await executeApprovedActions(requestId, "DELETION", {
    actorId: "executor-service",
    actorType: "system",
  });
  console.log(`   ✓ Replay completed with status: ${replay.outcomes[0]?.status ?? "SKIPPED"} (No duplicate mutation)\n`);

  // 8. Finalization
  console.log("8. FINALIZATION: Sealing fulfilment record with cryptographic content hash...");
  const finalized = await finalizeRequest(requestId, analystActor);
  if (!finalized.finalized) {
    console.error("   ✗ Finalization failed unmet preconditions:", finalized.unmetPreconditions);
    process.exit(1);
  }
  console.log(`   ✓ Request Finalized: Record ID = ${finalized.record.recordId}`);
  console.log(`     Content Hash: ${finalized.record.contentHash}\n`);

  // 9. Fulfilment Record Verification
  console.log("9. RECORD VERIFICATION: Checking record immutability and hash...");
  const recordCheck = await getFulfilmentRecord(requestId);
  console.log(`   ✓ Record Hash Valid: ${recordCheck.hashValid}\n`);

  // 10. Audit Chain Verification
  console.log("10. AUDIT CHAIN INTEGRITY: Verifying global append-only hash chain...");
  const chainResult = await verifyAuditChain();
  console.log(`   ✓ Global Audit Chain Valid: ${chainResult.valid} (Broken seq: ${chainResult.brokenAtSeq ?? "none"})`);

  const requestAudit = await listAudit({ requestId, pageSize: 100 });
  console.log(`   ✓ Total Audit Events for ${requestId}: ${requestAudit.events.length}`);

  console.log("\n--------------------------------------------------------------------------------");
  console.log("  RECENT AUDIT TRAIL SUMMARY (Chronological)");
  console.log("--------------------------------------------------------------------------------");
  for (const ev of requestAudit.events.slice(-10)) {
    console.log(
      `  #${String(ev.seq).padStart(3, " ")} | ${ev.eventType.padEnd(28, " ")} | Actor: ${ev.actorId.padEnd(18, " ")} | Status: ${ev.status.toUpperCase()}`,
    );
  }

  const finalReq = await PrivacyRequest.findOne({ requestId }).lean();
  console.log("\n================================================================================");
  console.log(`  FINAL PIPELINE STATUS: ${finalReq?.status}`);
  console.log("================================================================================");
  console.log("\nDISCLAIMER:");
  console.log("This tool follows internal organizational policy only. It does not provide legal");
  console.log("advice or guarantee compliance with any law or regulation. Final decisions rest");
  console.log("with authorized staff.\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("Demo failed with error:", err);
  process.exit(1);
});
