import type { PromptBookmark, PromptHistoryEntry, Task } from '../store/types';

/** Every Enter typed into an agent terminal records a prompt, and the whole array is
 *  re-serialized on each save, so a task keeps only its most recent prompts. */
export const MAX_PROMPT_HISTORY = 100;

/** Project prompt bookmarks are serialized with the project, so keep the list small. */
export const MAX_PROMPT_BOOKMARKS = 50;

/** Drop malformed saved bookmarks; the array is user-editable project state. */
export function restorePromptBookmarks(value: unknown): PromptBookmark[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const kept: PromptBookmark[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text : '';
    if (!text.trim() || seen.has(text)) continue;
    seen.add(text);
    const savedAt =
      typeof record.savedAt === 'number' && Number.isFinite(record.savedAt) ? record.savedAt : 0;
    kept.push({ text, savedAt });
    if (kept.length >= MAX_PROMPT_BOOKMARKS) break;
  }
  return kept.length > 0 ? kept : undefined;
}

/** Saves made before history was recorded still carry their one last prompt. */
export function promptHistoryOf(task: Task): PromptHistoryEntry[] {
  return task.promptHistory ?? (task.lastPrompt ? [{ text: task.lastPrompt }] : []);
}

/**
 * Drop an agent's prompts once its conversation is gone, so the history only lists
 * prompts the live agents actually received. Mutates a store draft.
 */
export function forgetAgentPrompts(task: Task, agentId: string): void {
  const history = promptHistoryOf(task);
  // Untagged entries predate per-agent tagging; nearly all were sent to the main agent.
  const kept = history.filter((entry) => (entry.agentId ?? task.agentIds[0]) !== agentId);
  if (kept.length === history.length) return;
  task.promptHistory = kept.length > 0 ? kept : undefined;
  task.lastPrompt = kept.at(-1)?.text ?? '';
}
