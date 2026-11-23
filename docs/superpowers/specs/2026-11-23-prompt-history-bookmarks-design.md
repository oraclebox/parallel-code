# Prompt history cards, project prompt bookmarks, and composer polish

Date: 2026-11-23
Status: proposed
Scope: Desktop terminal and built-in chat composers

## Intent

A prompt the user sends to an agent should leave the message box once it is
delivered, be reviewable as a card in the task's prompt history, be reusable
with one click, and be bookmarkable for reuse from any task in the same
project. The message box also needs a clear action beside Send.

Today the terminal composer only empties after the auto-send echo
verification finishes, which can take seconds per attempt, so a delivered
prompt keeps sitting in the box. The existing Prompt History popover lists
plain text and times only: no cards, no click-to-reuse, no bookmarks. The only
bookmarks in the app are project shell commands.

## Goals

1. The terminal prompt box empties as soon as the prompt is delivered, not
   after echo verification; a failed send still restores the text unless the
   user has typed something newer.
2. Prompt History shows this task's sent prompts as cards, newest first, with
   text preview, time and agent.
3. Clicking a history card fills the active composer with that prompt.
4. Each card has a bookmark toggle. Bookmarked prompts appear in a
   "Bookmarked" list scoped to the project, and clicking one fills the
   composer from any task in that project.
5. Both desktop composers gain a Clear button that empties the draft.

## Non-goals

- Phone/Android UI changes. The phone keeps its own "Recent messages" flow.
- Editing, renaming, searching, grouping or reordering bookmarks.
- Cross-project bookmarks.
- Changing history retention (100 prompts per task). The only recording change
  is that chat sends store the raw draft instead of the composed message.
- Bookmarking attachments; bookmarks hold prompt text only.

## Approaches considered

- **A. Extend the header popover (chosen).** The Prompt History popover above
  the agent pane is already task-scoped and reachable in both terminal and chat
  modes. Upgrading it to cards plus a Bookmarked tab adds the feature without a
  new layout surface or width state.
- **B. A task side drawer.** More room for cards, but adds a collapsible panel,
  remembered width, focus routing and a new way to leave it open.
- **C. A global prompt palette.** Useful for discovery across tasks, but it
  loses the "this task only" scope the user asked for and duplicates search.

## Design

### Data

- New `PromptBookmark` in `src/store/types.ts`:
  `{ text: string; savedAt: number }`.
- New `Project.promptBookmarks?: PromptBookmark[]`.
- Bookmark identity is the exact prompt text. Bookmarking the same text twice
  is one bookmark, so duplicates in history all show the pressed state.
- Cap: 50 bookmarks per project. Bookmark text has no new length limit: the
  terminal composer never limited prompt length, so truncating or rejecting a
  long prompt would make a bookmark vanish or differ from what was sent.
- Task history keeps its current shape (`PromptHistoryEntry`); the UI derives
  newest-first order by reversing `promptHistoryOf(task)`.
- Store action in `src/store/projects.ts`:
  `togglePromptBookmark(projectId, text)`. It adds `{ text, savedAt: now }` or
  removes the matching text, ignores empty text, and keeps the newest 50.
  Re-export through `src/store/store.ts`.
- Persistence: project objects are autosaved wholesale, so the array needs no
  new save path. Add `restorePromptBookmarks(value)` in
  `src/lib/prompt-history.ts` and call it from the project restore loop in
  `src/store/persistence.ts` (next to the other project field sanitizers). It
  drops non-objects, empty or non-string text and duplicates, caps the list,
  and coerces `savedAt` to a finite timestamp or 0.
- `promptBookmarks` is added to the `updateProject` accepted keys so the
  toggle uses the existing project update path.

### What chat history records

The chat composer sends a composed message: the draft plus a
`Referenced files:` block. History cards must show and reuse the prompt the
user typed, not that block, so chat sends record the raw draft separately:

- `PromptHistoryEntry` is unchanged; `sendPrompt` gains an optional
  `historyText` used only for `setLastPrompt` and `lastPrompt`.
- `ComposerInput.onSend` and `ChatProps.onSend` gain an optional third argument
  carrying the raw draft. `QueuedMessage` gains an optional `draftText` kept
  with the composed text, so a message queued mid-turn records the same raw
  draft when it is finally sent. `editQueued` restores `draftText` when
  present.
- Terminal sends keep recording their text as today.
- An image-only chat message has an empty raw draft; `setLastPrompt` already
  ignores empty text, so it adds no history entry.

### Prompt History popover

`src/components/PromptHistory.tsx` becomes a card list:

- Props: `task`, `emptyLabel`, `bookmarks`, optional `agentName(agentId?)`,
  `onReuse(text)`, `onToggleBookmark(text)`.
- Trigger stays as today: history icon plus the task's last prompt (or the
  caller's empty/status label).
- Popover header has two tabs: **This task** (default) and **Bookmarked**,
  each with a count.
- **This task** lists the task's prompts newest first. Each card is:
  - a reuse button holding the prompt text (clamped to four lines) and a meta
    line with the local time and the agent's name when known;
  - a bookmark button (`BookmarkIcon`, `aria-pressed` when saved).
    Clicking the reuse button calls `onReuse(text)` and closes the popover.
    Clicking the bookmark button toggles without closing; the click does not
    bubble to reuse.
- **Bookmarked** lists project bookmarks newest first with the same card shape.
  The bookmark button removes the bookmark. Reuse works from any task in the
  project. Empty state: "No bookmarked prompts yet."
- This-task empty state keeps "No prompts sent yet."
- The popover opens at the top of the newest-first list (the old
  scroll-to-bottom behavior is removed).
- Keyboard: the trigger keeps ArrowDown-to-open and Escape-to-close; the
  popover is focusable; cards are ordinary buttons in DOM order.

Wiring in `src/components/TaskAITerminal.tsx` (the header is shared by
terminal and chat modes):

- `bookmarks`: `getProject(task.projectId)?.promptBookmarks ?? []`.
- `onToggleBookmark`: `togglePromptBookmark(task.projectId, text)`.
- `agentName`: `store.agents[agentId]?.def.name`.
- `onReuse(text)`:
  - cancel any still-queued `initialPrompt` (`clearInitialPrompt`), because an
    explicit reuse takes over the box and must not let the old prompt reappear
    or auto-send later;
  - terminal mode: `props.promptHandle?.setText(text)` (this also writes the
    store draft and updates the mounted textarea);
  - chat mode, or no handle: `setTaskPromptDraft(task.id, text)`;
  - mark the draft active (`setTaskPromptDraftActive(task.id, true)`) so
    coordinator automation treats a filled box as the user's draft;
  - then `setTaskFocusedPanel(task.id, 'prompt')` so whichever composer is
    visible takes focus.

Styles go in `src/styles.css` beside the existing `prompt-history-*` rules:
tabs, cards, clamped text, meta line, bookmark button (accent when pressed),
and empty states. Use existing tokens; no new animation.

### Composer clearing

`src/components/PromptInput.tsx`:

- Capture the exact draft at submit. After `await sendPrompt(...)` resolves,
  clear the local text and stored draft immediately, before the auto-send echo
  verification, but only if the field still holds that exact draft.
- When auto verification returns `retry` or `giveup`, put the text back if the
  field is still empty, so a manual retry is available (the retry path already
  re-arms the stored initial prompt).
- The failure path keeps its existing restore, guarded the same way so newer
  typing is never overwritten. A Clear click during the in-flight send also
  suppresses the restore for that send: the user asked for an empty box.
- Manual and automatic paths both clear at delivery; manual sends already
  cleared right after delivery and now clear a few synchronous statements
  earlier.

The auto-send effect re-fills an empty box from a queued `initialPrompt`, so
Clear and reuse cancel that stored prompt (above) before emptying or replacing
the text. Otherwise Clear on a fresh task would immediately be undone.

The chat `Composer` already empties its draft before awaiting the send and
restores on failure, so it needs no clearing change. Because the draft is
already empty while a chat send is in flight, there is no mid-send Clear
window there; a Clear click after a failed restore simply leaves the box
empty.

### Clear button

Terminal `PromptInput`:

- A small round Clear button inside the box at the bottom right, to the left of
  Send. It is disabled and visibility-hidden (space reserved) when the draft is
  empty.
- Clicking clears the local text and stored draft, cancels a still-queued
  `initialPrompt`, clears the prompt-draft-active flag, suppresses the restore
  of an in-flight send, and focuses the textarea.
- The textarea's right padding grows from 36px to 64px to keep text clear of
  both buttons.

Chat `Composer`:

- A subtle icon button in `.chat-composer-settings` immediately before Send,
  with the same empty/disabled and visibility rules.
- Clicking clears only the draft, closes the @-mention and command popovers,
  and focuses the textarea. Attached images and file references stay; each has
  its own remove control.
- The button uses `CloseThinIcon` (or `CloseIcon`) at 14px, no accent fill.

## Edge cases

- A bookmarked prompt deleted from this task's history (for example by the
  100-entry cap) remains bookmarked and reusable.
- Bookmarks survive task deletion because they belong to the project; removing
  the project removes them.
- Corrupt persisted bookmarks are dropped on load.
- Legacy history entries without `sentAt` show text only.
- Shell `!` commands appear in history (already recorded via prompt detection)
  and can be bookmarked and reused as text.
- Reusing into a landed/disabled task fills the disabled box without sending.
- In chat mode the header popover is still visible; reuse writes the chat draft
  and focus lands in the chat composer.
- Clear or reuse while a coordinator-owned `initialPrompt` is queued cancels
  that prompt. The user's explicit action wins over the queued assignment.
- Chat history from before this change may contain the `Referenced files:`
  block; it is displayed and reused as recorded. New entries store the raw
  draft.

## Testing

- `src/lib/prompt-history.test.ts`: sanitizer drops invalid entries, dedupes,
  caps the list, preserves order and timestamps.
- `src/components/PromptHistory.client.test.tsx`: tabs and counts, newest-first
  cards, reuse callback and close, bookmark toggle without reuse, pressed
  state, project bookmarks reuse, empty states, Escape and outside click,
  legacy entries.
- `src/components/PromptInput.client.test.tsx`: text clears when the send
  resolves but before echo verification (deferred promise and fake timers);
  failure restores; `giveup` restores if untouched; newer typing survives; a
  Clear click during a send suppresses the restore; the Clear button is
  disabled when empty, clears text and store draft, cancels a queued
  `initialPrompt`, and focuses the textarea; padding update.
- `src/components/chat/ChatView.client.test.tsx`: Clear button disabled/visible
  rules, clears draft, closes mention popover, focuses textarea.
- `src/components/AgentChatView.client.test.tsx` and chat send tests: the raw
  draft, not the composed message, is recorded as history; a queued message
  keeps its raw draft for editing and later recording.
- Run `npm run check`, focused unit/client suites, then `npm run test:changed`.

## Risks

- Clearing before echo verification briefly shows an empty box for a prompt the
  agent may have dropped; the retry/giveup path restores the text and is
  covered by tests.
- Bookmarked prompt text adds to project state; the 50-entry cap bounds it.
- Prompt text is stored in app state, as task prompt history already is. The
  phone project API exposes only id, name, color, icon and last-used, so
  bookmarks do not reach the phone.
