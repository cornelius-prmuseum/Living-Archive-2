/**
 * Compatibility wrapper for older imports.
 *
 * Suggested-question data now lives in lib/agents.ts so there is one source
 * of truth for every AgentSlug, including Museum Staff-only personalities.
 */
import type { AgentSlug } from "@/lib/agents";
import {
  SUGGESTED_QUESTION_POOLS as AGENT_QUESTION_POOLS,
  getSuggestedQuestions,
} from "@/lib/agents";

export const SUGGESTED_QUESTION_POOLS: Record<AgentSlug, readonly string[]> =
  AGENT_QUESTION_POOLS;

// Preserve the older export name in case an earlier component still imports it.
export const SUGGESTED_QUESTIONS: Record<AgentSlug, readonly string[]> =
  AGENT_QUESTION_POOLS;

export { getSuggestedQuestions };

export default SUGGESTED_QUESTION_POOLS;
