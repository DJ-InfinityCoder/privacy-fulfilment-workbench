import { getProviderHealth } from "@/ai/router";

export function getAIHealth() {
  return {
    providers: getProviderHealth(),
    checkedAt: new Date().toISOString(),
  };
}
