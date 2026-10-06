import { z } from "zod";
import { appendAudit, type AuditActorType } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import {
  NotFoundError,
  PolicyViolationError,
  ValidationError,
  VerificationRequiredError,
} from "@/lib/errors";
import { sha256 } from "@/lib/hash";
import { PrivacyRequest, type PrivacyRequestDocument } from "@/models/PrivacyRequest";
import { UserProfile, type UserProfileDocument } from "@/models/UserProfile";
import { orgPolicy, type VerificationFactor } from "@/policy/org-policy";
import { evaluateVerification } from "@/policy/policy-engine";

const verificationInputSchema = z
  .object({
    email: z.string().trim().email().max(320),
    accountId: z.string().trim().min(1).max(120).optional(),
    phoneLast4: z.string().regex(/^\d{4}$/).optional(),
    dateOfBirth: z.union([z.iso.date(), z.iso.datetime()]).optional(),
    lastOrderCity: z.string().trim().min(1).max(160).optional(),
  })
  .refine((input) => input.accountId !== undefined || input.phoneLast4 !== undefined, {
    message: "An account ID or phone last four digits are required.",
  })
  .refine((input) => input.dateOfBirth !== undefined || input.lastOrderCity !== undefined, {
    message: "Date of birth or last order city is required.",
  });

export type VerificationInput = z.input<typeof verificationInputSchema>;

export type VerificationActor = {
  actorId: string;
  actorType: AuditActorType;
};

export type VerificationResult = {
  status: "PASSED" | "FAILED" | "LOCKED" | "AMBIGUOUS";
  missing: VerificationFactor[];
  attempts: number;
  attemptsRemaining: number;
};

export type VerificationOverrideActor = VerificationActor & {
  role: string;
};

export type VerificationOverrideInput = {
  subjectUserId: string;
  reason: string;
};

type SubmittedFactorHash = {
  factor: VerificationFactor;
  valueHash: string;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizeCity(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function normalizeDateOfBirth(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function hashSubmittedFactors(input: z.output<typeof verificationInputSchema>): SubmittedFactorHash[] {
  const factors: SubmittedFactorHash[] = [
    {
      factor: "email_match",
      valueHash: sha256(normalizeEmail(input.email)),
    },
  ];

  if (input.accountId !== undefined || input.phoneLast4 !== undefined) {
    const value =
      input.accountId !== undefined
        ? `account:${input.accountId.trim()}`
        : `phone:${input.phoneLast4}`;
    factors.push({
      factor: "account_id_or_phone_last4",
      valueHash: sha256(value),
    });
  }

  if (input.dateOfBirth !== undefined || input.lastOrderCity !== undefined) {
    const value =
      input.dateOfBirth !== undefined
        ? `date_of_birth:${normalizeDateOfBirth(input.dateOfBirth)}`
        : `last_order_city:${normalizeCity(input.lastOrderCity ?? "")}`;
    factors.push({
      factor: "knowledge_factor",
      valueHash: sha256(value),
    });
  }

  return factors;
}

function matchesKnowledge(
  input: z.output<typeof verificationInputSchema>,
  profile: UserProfileDocument,
): boolean {
  if (input.dateOfBirth !== undefined) {
    return (
      normalizeDateOfBirth(input.dateOfBirth) ===
      normalizeDateOfBirth(profile.dateOfBirth.toISOString())
    );
  }

  if (input.lastOrderCity !== undefined && profile.lastOrderCity !== undefined) {
    return normalizeCity(input.lastOrderCity) === normalizeCity(profile.lastOrderCity);
  }

  return false;
}

async function findCandidateProfiles(
  input: z.output<typeof verificationInputSchema>,
): Promise<UserProfileDocument[]> {
  if (input.accountId !== undefined) {
    const profile = await UserProfile.findOne({ userId: input.accountId });
    return profile ? [profile] : [];
  }

  if (input.phoneLast4 !== undefined) {
    const phoneDigits = normalizePhone(input.phoneLast4);
    const candidates = await UserProfile.find({
      phone: { $regex: `${phoneDigits}$` },
    });
    if (candidates.length > 1) {
      return candidates;
    }
    if (candidates.length === 1) {
      return candidates;
    }
  }

  const profile = await UserProfile.findOne({
    email: normalizeEmail(input.email),
  });
  return profile ? [profile] : [];
}

function computePassedFactors(
  input: z.output<typeof verificationInputSchema>,
  profile: UserProfileDocument | undefined,
): VerificationFactor[] {
  if (!profile) {
    return [];
  }

  const passed: VerificationFactor[] = [];
  if (normalizeEmail(input.email) === normalizeEmail(profile.email)) {
    passed.push("email_match");
  }

  const accountMatches =
    input.accountId !== undefined && input.accountId === profile.userId;
  const phoneMatches =
    input.phoneLast4 !== undefined &&
    normalizePhone(profile.phone).endsWith(input.phoneLast4);
  if (accountMatches || phoneMatches) {
    passed.push("account_id_or_phone_last4");
  }

  if (matchesKnowledge(input, profile)) {
    passed.push("knowledge_factor");
  }
  return passed;
}

function makeResult(
  status: VerificationResult["status"],
  missing: VerificationFactor[],
  attempts: number,
): VerificationResult {
  return {
    status,
    missing,
    attempts,
    attemptsRemaining: Math.max(0, orgPolicy.verification.maxAttempts - attempts),
  };
}

function parseSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}

export async function verifyRequestIdentity(
  requestId: string,
  input: unknown,
  actor: VerificationActor,
): Promise<VerificationResult> {
  const validated = parseSchema(verificationInputSchema, input);
  await connectDB();
  const request = await PrivacyRequest.findOne({ requestId });
  if (!request) {
    throw new NotFoundError(`Request ${requestId} was not found.`);
  }

  if (request.verification.status === "LOCKED") {
    throw new PolicyViolationError("Verification is locked for this request.", 409);
  }
  if (request.verification.status === "PASSED") {
    throw new PolicyViolationError("This request is already verified.", 409);
  }

  const attempts = request.verification.attempts + 1;
  const submittedFactors = hashSubmittedFactors(validated);
  const candidates = await findCandidateProfiles(validated);
  const ambiguous =
    validated.accountId === undefined &&
    candidates.length > 1;

  let passedFactors: VerificationFactor[] = [];
  let missing: VerificationFactor[] = [];
  if (ambiguous) {
    missing = ["account_id_or_phone_last4"];
  } else {
    passedFactors = computePassedFactors(validated, candidates[0]);
    missing = evaluateVerification(passedFactors).missing;
  }

  const scoreResult = evaluateVerification(passedFactors);
  const passed = !ambiguous && scoreResult.passed;
  const locked = !passed && attempts >= orgPolicy.verification.maxAttempts;
  const status: VerificationResult["status"] = passed
    ? "PASSED"
    : locked
      ? "LOCKED"
      : ambiguous
        ? "AMBIGUOUS"
        : "FAILED";
  const factorsSubmitted = [
    ...request.verification.factorsSubmitted,
    ...submittedFactors,
  ];
  const nextRequestStatus = passed ? "VERIFIED" : request.status;
  const updatedRequest = await PrivacyRequest.findOneAndUpdate(
    {
      requestId,
      "verification.attempts": request.verification.attempts,
      "verification.status": { $nin: ["PASSED", "LOCKED"] },
      status: request.status,
    },
    {
      $set: {
        status: nextRequestStatus,
        "verification.status": status,
        "verification.attempts": attempts,
        "verification.factorsSubmitted": factorsSubmitted,
        "verification.score": scoreResult.score,
        ...(passed
          ? {
              subjectUserId: candidates[0].userId,
              "verification.verifiedAt": new Date(),
              "verification.verifiedBy": actor.actorId,
            }
          : {}),
      },
    },
    { returnDocument: "after", runValidators: true },
  );

  if (!updatedRequest) {
    throw new PolicyViolationError(
      "Verification changed concurrently; reload the request before retrying.",
      409,
    );
  }

  const auditInput = {
    attempt: attempts,
    factors: submittedFactors.map(({ factor, valueHash }) => ({
      factor,
      valueHash,
    })),
    missing,
    ambiguous,
  };
  await appendAudit({
    requestId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    eventType: "VERIFICATION_ATTEMPT",
    input: auditInput,
    status: passed ? "ok" : "denied",
  });

  if (passed) {
    await appendAudit({
      requestId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      eventType: "VERIFICATION_PASSED",
      input: { factors: passedFactors, score: scoreResult.score },
      output: { subjectUserId: updatedRequest.subjectUserId },
      status: "ok",
    });
  } else {
    await appendAudit({
      requestId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      eventType: locked ? "VERIFICATION_LOCKED" : "VERIFICATION_FAILED",
      input: { attempt: attempts, missing, ambiguous },
      status: "denied",
      error: { code: locked ? "VERIFICATION_LOCKED" : "VERIFICATION_FAILED" },
    });
  }

  return makeResult(status, missing, attempts);
}

export async function overrideVerification(
  requestId: string,
  input: unknown,
  actor: VerificationOverrideActor,
): Promise<PrivacyRequestDocument> {
  const schema = z.object({
    subjectUserId: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(2000),
  });
  const validated = parseSchema(schema, input);
  await connectDB();

  if (actor.role !== "approver") {
    await appendAudit({
      requestId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      eventType: "VERIFICATION_OVERRIDE",
      input: { subjectUserId: validated.subjectUserId, reason: validated.reason },
      status: "denied",
      error: { code: "APPROVER_ROLE_REQUIRED" },
    });
    throw new PolicyViolationError("An approver role is required for verification override.");
  }

  const profile = await UserProfile.findOne({ userId: validated.subjectUserId });
  if (!profile) {
    throw new NotFoundError("The selected subject profile was not found.");
  }

  const request = await PrivacyRequest.findOne({ requestId });
  if (!request) {
    throw new NotFoundError(`Request ${requestId} was not found.`);
  }
  if (request.status !== "RECEIVED" && request.status !== "VERIFICATION_PENDING") {
    throw new PolicyViolationError(
      "Verification can only be overridden before identity is verified.",
      409,
    );
  }

  const updatedRequest = await PrivacyRequest.findOneAndUpdate(
    {
      requestId,
      status: request.status,
      "verification.status": { $nin: ["PASSED"] },
    },
    {
      $set: {
        status: "VERIFIED",
        subjectUserId: profile.userId,
        "verification.status": "PASSED",
        "verification.verifiedAt": new Date(),
        "verification.verifiedBy": actor.actorId,
      },
    },
    { returnDocument: "after", runValidators: true },
  );

  if (!updatedRequest) {
    throw new PolicyViolationError(
      "Verification changed concurrently; reload the request before retrying.",
      409,
    );
  }

  await appendAudit({
    requestId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    eventType: "VERIFICATION_OVERRIDE",
    input: {
      subjectUserId: profile.userId,
      reason: validated.reason,
      role: actor.role,
    },
    output: { status: "VERIFIED" },
    status: "ok",
  });

  return updatedRequest;
}

export function assertVerified(
  request: Pick<PrivacyRequestDocument, "verification" | "subjectUserId">,
): asserts request is typeof request & { subjectUserId: string } {
  if (request.verification.status !== "PASSED" || !request.subjectUserId) {
    throw new VerificationRequiredError();
  }
}
