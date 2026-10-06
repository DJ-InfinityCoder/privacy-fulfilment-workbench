export class TransientChaosError extends Error {
  readonly code = "TRANSIENT_CHAOS";

  constructor() {
    super("A transient tool failure occurred.");
    this.name = "TransientChaosError";
  }
}

export function maybeFailForChaos(random: () => number = Math.random): void {
  if (process.env.CHAOS_MODE === "true" && random() < 0.2) {
    throw new TransientChaosError();
  }
}
