# Prompt History Cards, Project Prompt Bookmarks, and Composer Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the composer at delivery, show this task's sent prompts as reusable cards, bookmark prompts at project scope, and add Clear buttons to both desktop composers.

**Architecture:** Project bookmarks are a new persisted `Project.promptBookmarks` array with a pure sanitizer and a store toggle. The existing header `PromptHistory` popover becomes a two-tab card list driven by callbacks, wired in `TaskAITerminal` so it serves terminal and chat modes. `PromptInput` clears after `sendPrompt` resolves (before echo verification) and gains a Clear button; the chat composer records the raw draft and gains the same button through its state machine.

**Tech Stack:** SolidJS, strict TypeScript, Vite, Electron, Vitest (unit + happy-dom client), CSS in `src/styles.css` and `src/components/chat/chat.css`.

**Spec:** `docs/superpowers/specs/2026-11-23-prompt-history-bookmarks-design.md`

## Global Constraints

- Strict TypeScript; no `any`, no non-null assertions, no lint warnings.
- SolidJS function components, signals and stores; cleanup any subscription or timer.
- Use existing loggers (`src/lib/log.ts`, `electron/log.ts`); only `console.warn` / `console.error` are allowed.
- UI: reserve space with `visibility`/`opacity`, never `display`, for controls that come and go. No new animation. Use existing tokens.
- Bookmark identity is the exact prompt text; 50 per project; no text-length cap.
- No phone/Android UI changes.
- Conventional commits. Run `npm run check` before handoff and `npm run test:changed` before committing.
- Vitest runs with the compact agent reporter; do not pass `--reporter`.

## Review Focus

- Clearing at delivery must not wipe text the user typed while the send was in flight.
- Clear/reuse on a fresh task must cancel a still-queued `initialPrompt`, or the auto-send effect re-fills the box.
- Chat history must record the raw draft, not the composed message with its `Referenced files:` block.
- Duplicate prompt texts share one bookmark; toggling any card updates all cards with that text.
- A corrupt persisted `promptBookmarks` value must be dropped without breaking load.
- Reuse in chat mode must reach the chat composer, not a stale terminal handle.
- Clear in the terminal composer during an in-flight send must suppress the failed-send restore.

---

### Task 1: Project prompt bookmark data layer

**Files:**

- Modify: `src/store/types.ts` (add `PromptBookmark` near `TerminalBookmark`; add `promptBookmarks?: PromptBookmark[]` to `Project` after `terminalBookmarks`)
- Modify: `src/lib/prompt-history.ts`
- Create: `src/lib/prompt-history.test.ts`
- Modify: `src/store/projects.ts` (add `togglePromptBookmark`; extend the `updateProject` Pick and its assignment)
- Modify: `src/store/store.ts` (re-export `togglePromptBookmark`)
- Modify: `src/store/persistence.ts` (project restore loop, near `p.reviewChecks = ...`)
- Test: `src/lib/prompt-history.test.ts`, `src/store/projects.test.ts`, `src/store/persistence.test.ts`

**Interfaces:**

- Produces:
  - `export interface PromptBookmark { text: string; savedAt: number }`
  - `export const MAX_PROMPT_BOOKMARKS = 50;`
  - `export function restorePromptBookmarks(value: unknown): PromptBookmark[] | undefined`
  - `export function togglePromptBookmark(projectId: string, text: string): void`

- [ ] **Step 1: Write the failing sanitizer tests**

Create `src/lib/prompt-history.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_PROMPT_BOOKMARKS, restorePromptBookmarks } from './prompt-history';

describe('restorePromptBookmarks', () => {
  it('drops non-objects, empty text and duplicates, and keeps savedAt', () => {
    expect(
      restorePromptBookmarks([
        { text: 'Fix tests', savedAt: 10 },
        { text: 'Fix tests', savedAt: 20 },
        { text: '   ' },
        { text: 42 },
        null,
        { text: 'Ship it' },
      ]),
    ).toEqual([
      { text: 'Fix tests', savedAt: 10 },
      { text: 'Ship it', savedAt: 0 },
    ]);
  });

  it('caps the list and returns undefined for unusable values', () => {
    const many = Array.from({ length: MAX_PROMPT_BOOKMARKS + 5 }, (_, index) => ({
      text: `prompt ${index}`,
      savedAt: index,
    }));
    expect(restorePromptBookmarks(many)).toHaveLength(MAX_PROMPT_BOOKMARKS);
    expect(restorePromptBookmarks([])).toBeUndefined();
    expect(restorePromptBookmarks('nope')).toBeUndefined();
    expect(restorePromptBookmarks(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the sanitizer tests to verify they fail**

Run: `npm run test:unit -- src/lib/prompt-history.test.ts`
Expected: FAIL because `restorePromptBookmarks` and `MAX_PROMPT_BOOKMARKS` are not exported.

- [ ] **Step 3: Add the type and sanitizer**

In `src/store/types.ts`, next to `TerminalBookmark`:

```ts
export interface PromptBookmark {
  /** The exact prompt text; also its identity, so the same text bookmarks once. */
  text: string;
  savedAt: number;
}
```

Add to `Project` after `terminalBookmarks?: TerminalBookmark[];`:

```ts
  /** Prompts the user pinned for reuse from any task in this project. */
  promptBookmarks?: PromptBookmark[];
```

In `src/lib/prompt-history.ts`, add:

```ts
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
```

Import `PromptBookmark` in the same file.

- [ ] **Step 4: Run the sanitizer tests to verify they pass**

Run: `npm run test:unit -- src/lib/prompt-history.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing toggle tests**

Add to `src/store/projects.test.ts` inside `describe('updateProject', ...)`:

```ts
it('toggles a project prompt bookmark by exact text', () => {
  setStore('projects', [{ id: 'p1', name: 'Project', path: '/repo', color: '' }]);

  togglePromptBookmark('p1', '  Fix the tests  ');
  expect(store.projects[0]?.promptBookmarks?.map((bookmark) => bookmark.text)).toEqual([
    '  Fix the tests  ',
  ]);

  togglePromptBookmark('p1', '  Fix the tests  ');
  expect(store.projects[0]?.promptBookmarks).toBeUndefined();

  togglePromptBookmark('missing', 'ignored');
  togglePromptBookmark('p1', '   ');
  expect(store.projects[0]?.promptBookmarks).toBeUndefined();
});

it('keeps only the newest 50 prompt bookmarks', () => {
  setStore('projects', [{ id: 'p1', name: 'Project', path: '/repo', color: '' }]);
  for (let index = 0; index < 55; index++) togglePromptBookmark('p1', `prompt ${index}`);
  expect(store.projects[0]?.promptBookmarks).toHaveLength(50);
  expect(store.projects[0]?.promptBookmarks?.[0]?.text).toBe('prompt 5');
  expect(store.projects[0]?.promptBookmarks?.at(-1)?.text).toBe('prompt 54');
});
```

Import `togglePromptBookmark` from `./projects`.

- [ ] **Step 6: Run the toggle tests to verify they fail**

Run: `npm run test:unit -- src/store/projects.test.ts`
Expected: FAIL because `togglePromptBookmark` is not exported.

- [ ] **Step 7: Implement `togglePromptBookmark` and the update path**

In `src/store/projects.ts` (requires `MAX_PROMPT_BOOKMARKS` from `../lib/prompt-history`):

```ts
export function togglePromptBookmark(projectId: string, text: string): void {
  if (!text.trim()) return;
  const project = getProject(projectId);
  if (!project) return;
  const current = project.promptBookmarks ?? [];
  const saved = current.some((bookmark) => bookmark.text === text);
  const next = saved
    ? current.filter((bookmark) => bookmark.text !== text)
    : [...current, { text, savedAt: Date.now() }].slice(-MAX_PROMPT_BOOKMARKS);
  updateProject(projectId, { promptBookmarks: next.length > 0 ? next : undefined });
}
```

Add `'promptBookmarks'` to the `updateProject` `Pick<...>` union and, in the `produce` block next to `terminalBookmarks`:

```ts
if (Object.prototype.hasOwnProperty.call(updates, 'promptBookmarks'))
  s.projects[idx].promptBookmarks = updates.promptBookmarks;
```

Use `hasOwnProperty` so `undefined` removes the field.

- [ ] **Step 8: Run the toggle tests to verify they pass**

Run: `npm run test:unit -- src/store/projects.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire restore and re-export**

In `src/store/store.ts` export list from `./projects`, add `togglePromptBookmark`.

In `src/store/persistence.ts`, inside the per-project loop after `p.reviewChecks = restoreReviewChecks(p.reviewChecks);`:

```ts
p.promptBookmarks = restorePromptBookmarks(p.promptBookmarks);
```

Import `restorePromptBookmarks` from `../lib/prompt-history`.

- [ ] **Step 10: Write the failing persistence test**

Add to `src/store/persistence.test.ts` (use the existing `mockInvoke` JSON harness):

```ts
it('restores valid prompt bookmarks and drops malformed ones', async () => {
  mockInvoke.mockResolvedValueOnce(
    JSON.stringify({
      projects: [
        {
          id: 'project-1',
          name: 'Repo',
          path: '/repo',
          color: 'hsl(0, 70%, 75%)',
          promptBookmarks: [
            { text: 'Keep this', savedAt: 5 },
            { text: 'Keep this', savedAt: 6 },
            { text: '' },
            { nope: true },
          ],
        },
      ],
      lastProjectId: 'project-1',
      lastAgentId: null,
      taskOrder: [],
      collapsedTaskOrder: [],
      tasks: {},
      activeTaskId: null,
      sidebarVisible: true,
    }),
  );

  await loadState();

  expect(store.projects[0]?.promptBookmarks).toEqual([{ text: 'Keep this', savedAt: 5 }]);
});
```

- [ ] **Step 11: Run the persistence test**

Run: `npm run test:unit -- src/store/persistence.test.ts`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/store/types.ts src/lib/prompt-history.ts src/lib/prompt-history.test.ts src/store/projects.ts src/store/projects.test.ts src/store/store.ts src/store/persistence.ts src/store/persistence.test.ts
git commit -m "feat(prompts): persist project prompt bookmarks"
```

---

### Task 2: Prompt History card popover

**Files:**

- Modify: `src/components/PromptHistory.tsx`
- Modify: `src/styles.css` (`prompt-history-*` block around line 3732)
- Modify: `src/components/PromptHistory.client.test.tsx`

**Interfaces:**

- Consumes: `promptHistoryOf(task)`, `PromptHistoryEntry`, `PromptBookmark`.
- Produces:

```ts
export function PromptHistory(props: {
  task: Task;
  emptyLabel: string;
  bookmarks?: PromptBookmark[];
  agentName?: (agentId?: string) => string | undefined;
  onReuse: (text: string) => void;
  onToggleBookmark: (text: string) => void;
});
```

- [ ] **Step 1: Rewrite the failing component tests**

Replace `src/components/PromptHistory.client.test.tsx` with tests covering:

```ts
mount({ promptHistory: [...], lastPrompt: 'Newest', bookmarks: [...] })
```

required props `onReuse`/`onToggleBookmark` are `vi.fn()` spies returned from `mount`.

- This task tab shows entries newest first: texts `['Newest', '<script>plain text</script>', 'First prompt\nwith another line']`.
- Clicking the Bookmarked tab shows project bookmark texts, newest by `savedAt`.
- Clicking a card's reuse button calls `onReuse('Newest')` and closes the popover; the parent click spy is not called.
- Clicking a card's bookmark button calls `onToggleBookmark('Newest')`, does not call `onReuse`, does not close, and the button has `aria-pressed="true"` when that text is in `bookmarks`.
- Empty states: `No prompts sent yet.` and `No bookmarked prompts yet.`
- A legacy entry with no `sentAt` renders no `<time>`.
- Escape closes and returns focus to the trigger; an outside pointerdown closes.
- ArrowDown on the trigger opens and focuses the popover.

Keep the existing tab/role queries in mind: trigger is `button.prompt-history-trigger`, tabs are `role="tab"`, cards are `button.prompt-history-card-reuse` and `button.prompt-history-card-bookmark`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:client -- src/components/PromptHistory.client.test.tsx`
Expected: FAIL (missing props/classes/tabs).

- [ ] **Step 3: Implement the card popover**

In `src/components/PromptHistory.tsx`:

- Keep trigger, portal placement, Escape/outside-click handling, and `blur`.
- Add `const [tab, setTab] = createSignal<'task' | 'bookmarks'>('task')`.
- `const entries = () => [...promptHistoryOf(props.task)].reverse();`
- `const bookmarks = () => [...(props.bookmarks ?? [])].sort((a, b) => b.savedAt - a.savedAt);`
- `const saved = (text: string) => (props.bookmarks ?? []).some((bookmark) => bookmark.text === text);`
- Header inside the popover: a `role="tablist"` with two `role="tab"` buttons labelled `This task (N)` and `Bookmarked (M)`, `aria-selected`.
- `role="tabpanel"` list:
  - for task entries: `li.prompt-history-card` containing
    `button.prompt-history-card-reuse` (span `prompt-history-card-text` with the text, meta span `prompt-history-card-meta` with local `HH:mm` when `sentAt` and `agentName(agentId)` when available) and
    `button.prompt-history-card-bookmark` (`aria-label` `Bookmark prompt` / `Remove bookmark`, `aria-pressed={saved(entry.text)}`).
  - for bookmarks: same card with `savedAt` time and reuse/remove.
- Reuse click: `props.onReuse(text); setOpen(false);`
- Bookmark click: `event.stopPropagation(); props.onToggleBookmark(text);` (no tab switch, no close).
- Remove the scroll-to-bottom effect; the newest-first list opens at the top.
- Escape closes; keep focus return when focus is inside.

- [ ] **Step 4: Add styles**

Beside `.prompt-history-popover` in `src/styles.css` add `.prompt-history-tabs`, `.prompt-history-tab[aria-selected='true']`, `.prompt-history-card`, `.prompt-history-card-reuse`, `.prompt-history-card-text` (4-line clamp with `-webkit-line-clamp`), `.prompt-history-card-meta`, `.prompt-history-card-bookmark` (`color: var(--fg-subtle)`, accent color when `aria-pressed='true'`), and hover states. No animation.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:client -- src/components/PromptHistory.client.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/PromptHistory.tsx src/components/PromptHistory.client.test.tsx src/styles.css
git commit -m "feat(prompts): show prompt history as reusable cards with bookmarks"
```

---

### Task 3: Wire history reuse and bookmarks into the task header

**Files:**

- Modify: `src/components/TaskAITerminal.tsx` (`PromptHistory` call around line 326)
- Modify: `src/components/TaskAITerminal.client.test.tsx`
- Test: `src/components/TaskAITerminal.client.test.tsx`

**Interfaces:**

- Consumes: `getProject`, `togglePromptBookmark`, `clearInitialPrompt`, `setTaskPromptDraft`, `setTaskPromptDraftActive`, `setTaskFocusedPanel`, `PromptInputHandle.setText`, `PromptHistory` props from Task 2.
- Produces: header behaviour; no new exports.

- [ ] **Step 1: Write the failing header tests**

Add to `src/components/TaskAITerminal.client.test.tsx`:

```ts
it('reuses a history card into the terminal box and cancels a queued prompt', () => {
  setStore('tasks', 'task', {
    ...store.tasks.task,
    promptHistory: [{ text: 'Old prompt', sentAt: 1 }],
    initialPrompt: 'Queued first prompt',
  });
  const setText = vi.fn();
  dispose = render(
    () => (
      <TaskAITerminal
        task={store.tasks.task}
        selectedAgentId="agent"
        isActive
        promptHandle={{ getText: () => '', setText }}
      />
    ),
    host,
  );

  document.querySelector<HTMLButtonElement>('.prompt-history-trigger')?.click();
  document.querySelector<HTMLButtonElement>('.prompt-history-card-reuse')?.click();

  expect(setText).toHaveBeenCalledWith('Old prompt');
  expect(store.tasks.task.initialPrompt).toBeUndefined();
  expect(store.tasks.task.promptDraftActive).toBe(true);
  expect(store.focusedPanel.task).toBe('prompt');
});

it('toggles a project bookmark from the history card', () => {
  setStore('projects', [{ id: 'project', name: 'Repo', path: '/repo', color: '' }]);
  setStore('tasks', 'task', {
    ...store.tasks.task,
    promptHistory: [{ text: 'Old prompt', sentAt: 1 }],
  });
  mount();

  document.querySelector<HTMLButtonElement>('.prompt-history-trigger')?.click();
  document.querySelector<HTMLButtonElement>('.prompt-history-card-bookmark')?.click();

  expect(store.projects[0]?.promptBookmarks?.map((bookmark) => bookmark.text)).toEqual([
    'Old prompt',
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:client -- src/components/TaskAITerminal.client.test.tsx`
Expected: FAIL because the header is not wired.

- [ ] **Step 3: Wire the header**

In `src/components/TaskAITerminal.tsx`:

- Import `getProject`, `togglePromptBookmark`, `clearInitialPrompt`, `setTaskPromptDraft`, `setTaskPromptDraftActive` from `../store/store`.
- Replace the `PromptHistory` call with:

```tsx
<PromptHistory
  task={props.task}
  emptyLabel={infoBarStatus().text}
  bookmarks={getProject(props.task.projectId)?.promptBookmarks ?? []}
  agentName={(agentId) => (agentId ? store.agents[agentId]?.def.name : undefined)}
  onToggleBookmark={(text) => togglePromptBookmark(props.task.projectId, text)}
  onReuse={(text) => {
    clearInitialPrompt(props.task.id);
    if (props.promptHandle) props.promptHandle.setText(text);
    else setTaskPromptDraft(props.task.id, text);
    setTaskPromptDraftActive(props.task.id, true);
    setTaskFocusedPanel(props.task.id, 'prompt');
  }}
/>
```

The header is shared by terminal and chat modes; `props.promptHandle` is undefined in chat mode, so the store path feeds the chat draft. Reset `projects` (and `focusedPanel` if the harness keeps it) in the test file's `beforeEach` so the new tests do not leak into their neighbours.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:client -- src/components/TaskAITerminal.client.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/TaskAITerminal.tsx src/components/TaskAITerminal.client.test.tsx
git commit -m "feat(prompts): reuse and bookmark prompts from the task header"
```

---

### Task 4: Terminal composer clears at delivery and gains Clear

**Files:**

- Modify: `src/components/PromptInput.tsx` (`handleSend`, `setText`, textarea JSX around line 992)
- Modify: `src/styles.css` (add `.prompt-clear-btn` near `.prompt-send-btn` usages)
- Modify: `src/components/PromptInput.client.test.tsx`

**Interfaces:**

- Consumes: `clearInitialPrompt`, `setTaskPromptDraftActive` (already imported).
- Produces: no new public API.

- [ ] **Step 1: Add the verification mock and failing tests**

At the top of `src/components/PromptInput.client.test.tsx` add:

```ts
const pollMock = vi.hoisted(() => ({ pollUntilPromptAppearsInOutput: vi.fn(async () => true) }));
vi.mock('./prompt-verify', () => pollMock);
```

In the file's `beforeEach`, reset it before each test:

```ts
pollMock.pollUntilPromptAppearsInOutput.mockReset();
pollMock.pollUntilPromptAppearsInOutput.mockResolvedValue(true);
vi.mocked(clearInitialPrompt).mockReset();
```

Add a helper that lets the test clear the `initialPrompt` prop the way the
store does (the real `sendPrompt` clears it on delivery, and the retry path
restores it):

```ts
let setInitialRef: (text: string | undefined) => void = () => {};

function mountReactiveInitial() {
  const [initial, setInitial] = createSignal<string | undefined>('do it');
  setInitialRef = (text) => setInitial(text);
  vi.mocked(setInitialPrompt).mockImplementation((_taskId, text) => setInitial(text));
  vi.mocked(clearInitialPrompt).mockImplementation(() => setInitial(undefined));
  const container = document.createElement('div');
  document.body.append(container);
  disposers.push(
    render(
      () => (
        <PromptInput taskId="task-1" taskName="Task" agentId="agent-1" initialPrompt={initial()} />
      ),
      container,
    ),
  );
  return container.querySelector<HTMLTextAreaElement>('textarea.prompt-textarea');
}
```

Import `setInitialPrompt` and `clearInitialPrompt` from the store mock in the
test file's import list.

Add tests:

```ts
it('clears the box when the prompt is delivered, before the echo check returns', async () => {
  let finishSend = (): void => {};
  let finishPoll = (): void => {};
  vi.mocked(sendPrompt).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishSend = () => {
          setInitialRef(undefined);
          resolve();
        };
      }),
  );
  pollMock.pollUntilPromptAppearsInOutput.mockImplementationOnce(
    () => new Promise((resolve) => (finishPoll = () => resolve(true))),
  );
  vi.useFakeTimers();
  try {
    vi.mocked(getAgentOutputTail).mockReturnValue('Claude Code\n❯ ');
    storeMock.tasks = { 'task-1': { id: 'task-1', agentIds: ['agent-1'] } };
    const textarea = mountReactiveInitial();
    await vi.advanceTimersByTimeAsync(10_000);
    finishSend();
    await vi.advanceTimersByTimeAsync(0);
    expect(textarea?.value).toBe('');
    finishPoll();
  } finally {
    vi.useRealTimers();
  }
});

it('puts the prompt back when the echo check gives up and the box is still empty', async () => {
  vi.mocked(sendPrompt).mockImplementation(async () => {
    setInitialRef(undefined);
  });
  pollMock.pollUntilPromptAppearsInOutput.mockResolvedValue(false);
  vi.useFakeTimers();
  try {
    vi.mocked(getAgentOutputTail).mockReturnValue('Claude Code\n❯ ');
    storeMock.tasks = { 'task-1': { id: 'task-1', agentIds: ['agent-1'] } };
    const textarea = mountReactiveInitial();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(textarea?.value).toBe('do it');
  } finally {
    vi.useRealTimers();
  }
});

it('clears the draft without cancelling typing that arrived during the send', async () => {
  let finishSend = (): void => {};
  vi.mocked(sendPrompt).mockImplementationOnce(
    () => new Promise<void>((resolve) => (finishSend = resolve)),
  );
  storeMock.tasks = { 'task-1': { id: 'task-1', agentIds: ['agent-1'], promptDraft: 'first' } };
  const textarea = mount('task-1');
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  textarea.value = 'second';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  finishSend();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(textarea.value).toBe('second');
  expect(setTaskPromptDraft).not.toHaveBeenCalledWith('task-1', '');
});

it('clears the box, queued prompt and draft flag from the Clear button', () => {
  storeMock.tasks = {
    'task-1': { id: 'task-1', agentIds: ['agent-1'], promptDraft: 'do it' },
  };
  const [initial, setInitial] = createSignal<string | undefined>('do it');
  vi.mocked(clearInitialPrompt).mockImplementation(() => setInitial(undefined));
  const container = document.createElement('div');
  document.body.append(container);
  disposers.push(
    render(
      () => (
        <PromptInput taskId="task-1" taskName="Task" agentId="agent-1" initialPrompt={initial()} />
      ),
      container,
    ),
  );
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea.prompt-textarea');
  const clear = container.querySelector<HTMLButtonElement>('.prompt-clear-btn');
  if (!textarea || !clear) throw new Error('missing composer controls');
  expect(clear.disabled).toBe(false);
  clear.click();
  expect(textarea.value).toBe('');
  expect(setTaskPromptDraft).toHaveBeenLastCalledWith('task-1', '');
  expect(clearInitialPrompt).toHaveBeenCalledWith('task-1');
  expect(setTaskPromptDraftActive).toHaveBeenLastCalledWith('task-1', false);
  expect(document.activeElement).toBe(textarea);
  expect(clear.disabled).toBe(true);
});

it('keeps a cleared box empty when the send fails afterwards', async () => {
  let fail = (): void => {};
  vi.mocked(sendPrompt).mockImplementationOnce(
    () => new Promise<void>((_, reject) => (fail = () => reject(new Error('offline')))),
  );
  storeMock.tasks = { 'task-1': { id: 'task-1', agentIds: ['agent-1'], promptDraft: 'send me' } };
  const textarea = mount('task-1');
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const clear = document.querySelector<HTMLButtonElement>('.prompt-clear-btn');
  clear?.click();
  fail();
  await waitFor(() => vi.mocked(showNotification).mock.calls.length > 0);
  expect(textarea.value).toBe('');
});
```

Adjust the test file's store import list to include `clearInitialPrompt`,
`setInitialPrompt` and `setTaskPromptDraftActive` with the existing mocks.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:client -- src/components/PromptInput.client.test.tsx`
Expected: FAIL for the new expectations.

- [ ] **Step 3: Implement clear-at-delivery and the Clear button**

In `PromptInput`:

- Add a local `let suppressRestore = false;`.
- In `handleSend`, capture `const draft = text();` at submit time. After `await sendPrompt(...)` succeeds (before the `if (mode === 'auto')` verification block):

```ts
// The prompt is delivered; the echo check can take seconds, so empty the
// box now. Later typing stays.
if (text() === draft) setText('');
```

- Reset `suppressRestore = false;` at the start of `handleSend`.
- In the auto `retry`/`giveup` branch, before `return`, put the prompt back only if the box is empty:
  `if (!suppressRestore && !text()) setText(draft);`
- In the `catch`, restore only when the user neither typed nor cleared:
  `if (!suppressRestore && !text()) setText(draft);`
- Keep the later `setTaskPromptDraftActive(false)` and `props.onSend?.(val)`
  bookkeeping. Remove the final `setText('')`: delivery already cleared the box,
  and clearing again after the await could wipe newer typing.
- Add `clearDraft()`:

```ts
function clearDraft() {
  suppressRestore = true;
  clearInitialPrompt(props.taskId);
  setTaskPromptDraftActive(props.taskId, false);
  setText('');
  textareaRef?.focus();
}
```

- Render the button inside the relative wrapper, before the send button:

```tsx
<button
  type="button"
  class="prompt-clear-btn"
  aria-label="Clear message"
  title="Clear message"
  disabled={!text()}
  onClick={clearDraft}
>
  <CloseThinIcon size={12} />
</button>
```

Import `CloseThinIcon`. Change the textarea inline `padding` from `'6px 36px 6px 10px'` to `'6px 64px 6px 10px'`.

- [ ] **Step 4: Add `.prompt-clear-btn` styles**

```css
.prompt-clear-btn {
  position: absolute;
  right: 36px;
  bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--fg-subtle);
  cursor: pointer;
}
.prompt-clear-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--fg);
}
.prompt-clear-btn:disabled {
  visibility: hidden;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:client -- src/components/PromptInput.client.test.tsx`
Expected: PASS. Update the padding assertion in the existing style test from `'6px 36px 6px 10px'` to `'6px 64px 6px 10px'`.

- [ ] **Step 6: Commit**

```bash
git add src/components/PromptInput.tsx src/components/PromptInput.client.test.tsx src/styles.css
git commit -m "fix(composer): clear the terminal prompt at delivery and add a clear button"
```

---

### Task 5: Chat history records the raw draft

**Files:**

- Modify: `src/store/tasks.ts` (`sendPrompt` options and `setLastPrompt` calls)
- Modify: `src/components/chat/composer-state.ts` (`onSend` signature, `QueuedMessage`, `transmit`, queue paths, `editQueued`)
- Modify: `src/components/chat/ChatView.tsx` (`ChatProps.onSend` signature)
- Modify: `src/components/AgentChatView.tsx` (`onSend` implementation)
- Test: `src/components/chat/ChatView.client.test.tsx`, `src/components/AgentChatView.client.test.tsx`

**Interfaces:**

- Produces:
  - `sendPrompt(..., options: { historyText?: string })`
  - `onSend: (text: string, images: ChatImage[], draftText?: string) => Promise<void>`
  - `QueuedMessage.draftText?: string`

- [ ] **Step 1: Write the failing tests**

In `src/components/chat/ChatView.client.test.tsx`:

- Update existing `send` expectations to include the raw draft as the third argument, e.g.
  `expect(send).toHaveBeenCalledWith('Keep my draft', [], 'Keep my draft')`.
- Extend the file-reference test to assert the third argument is the draft with the `@file`
  reference form the user typed (the same raw draft), while the first argument keeps the
  `Referenced files:` block.
- Extend a queue test: with `status: 'working'`, send `Raw follow-up`, let the agent become
  ready, and assert `send` receives `(composed, [], 'Raw follow-up')`.

In `src/components/AgentChatView.client.test.tsx`, add:

```ts
it('records the raw chat draft as history text', async () => {
  dispose = render(() => <AgentChatView task={task()} agentId="agent-1" active />, container);
  await tick();
  await mocks.chatProps?.onSend('Composed message\n\nReferenced files:\n"src/a.ts"', [], 'Raw @src/a.ts');
  expect(mocks.sendPrompt).toHaveBeenCalledWith('task-1', 'agent-1', 'Composed message\n\nReferenced files:\n"src/a.ts"', {
    images: [],
    historyText: 'Raw @src/a.ts',
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:client -- src/components/chat/ChatView.client.test.tsx src/components/AgentChatView.client.test.tsx`
Expected: FAIL (third argument missing).

- [ ] **Step 3: Implement the raw-draft path**

`src/store/tasks.ts`:

- Add `historyText?: string` to `sendPrompt` options.
- In both the chat and terminal branches, replace `setLastPrompt(taskId, text, agentId)` with
  `setLastPrompt(taskId, options.historyText ?? text, agentId)`.

`src/components/chat/composer-state.ts`:

- `onSend: (text: string, images: ChatImage[], draftText?: string) => Promise<void>;`
- `QueuedMessage` add `draftText?: string;`.
- `transmit(text, attached, from)` gains `draftText?: string`; call `props.onSend(text, attached, draftText)`.
- `send()`: pass `draftText: text` to the queue entry and to `transmit`.
- Auto-transmit effect and `retryQueue` pass `next.draftText`.
- `stop(true)` queue entry and `transmit` add `draftText: draft`.
- `editQueued` calls `reuse(entry.draftText ?? entry.text, entry.images)`.

`src/components/chat/ChatView.tsx`: widen `onSend` to the three-argument signature.

`src/components/AgentChatView.tsx`:

```ts
onSend: async (text, images, draftText) => {
  await sendPrompt(props.task.id, props.agentId, text, { images, historyText: draftText });
  if (props.task.initialPrompt) clearInitialPrompt(props.task.id);
  const draft = draftText ?? text;
  if (props.task.promptDraft?.trim() === draft.trim()) setTaskPromptDraft(props.task.id, '');
},
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:client -- src/components/chat/ChatView.client.test.tsx src/components/AgentChatView.client.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the unit suite for the task store**

Run: `npm run test:unit -- src/store/tasks.test.ts`
Expected: PASS (add a `sendPrompt` historyText expectation only if the existing harness already exercises `sendPrompt`).

- [ ] **Step 6: Commit**

```bash
git add src/store/tasks.ts src/components/chat/composer-state.ts src/components/chat/ChatView.tsx src/components/AgentChatView.tsx src/components/chat/ChatView.client.test.tsx src/components/AgentChatView.client.test.tsx
git commit -m "fix(chat): record the raw draft in prompt history"
```

---

### Task 6: Chat composer Clear button

**Files:**

- Modify: `src/components/chat/composer-state.ts` (`clear`)
- Modify: `src/components/chat/Composer.tsx` (button, mention close)
- Modify: `src/components/chat/chat.css`
- Test: `src/components/chat/ChatView.client.test.tsx`

**Interfaces:**

- Produces: `Composer.clear(): void` on the object returned by `createComposer`.

- [ ] **Step 1: Write the failing test**

Add to `src/components/chat/ChatView.client.test.tsx`:

```ts
it('clears the chat draft from the clear button and hides it when empty', async () => {
  await update({ draft: 'Keep my draft' });
  const clear = button('Clear message');
  expect(clear.disabled).toBe(false);
  await act(() => clear.click());
  expect(props.draft).toBe('');
  expect(document.activeElement).toBe(composer());
  expect(clear.disabled).toBe(true);
});
```

Use the file's existing `button`, `act`, `update`, `composer` and `props` helpers.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:client -- src/components/chat/ChatView.client.test.tsx`
Expected: FAIL (no `.chat-clear`).

- [ ] **Step 3: Implement `clear` in the composer state**

In `createComposer`, add and return:

```ts
/** Empties the draft, for the Clear button beside Send. */
function clear() {
  props.onDraft('');
}
```

- [ ] **Step 4: Add the button**

In `Composer.tsx`, inside `.chat-session-controls` before the
`<Show when={!working() || hasContent()}>` that wraps the Send button (so it
stays in the DOM while the agent works):

```tsx
<button
  type="button"
  class="chat-clear"
  aria-label="Clear message"
  title="Clear message"
  disabled={!props.draft.trim()}
  onClick={() => {
    mention.close();
    c.clear();
    props.focus();
  }}
>
  <CloseThinIcon size={14} />
</button>
```

Import `CloseThinIcon` from `../icons`.

- [ ] **Step 5: Add `.chat-clear` styles**

In `src/components/chat/chat.css` near `.chat-composer :is(.chat-send, .chat-stop)`:

```css
.chat-clear {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-subtle);
  cursor: pointer;
  flex: none;
}
.chat-clear:enabled:hover {
  background: var(--bg-hover);
  color: var(--fg);
}
.chat-clear:disabled {
  visibility: hidden;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:client -- src/components/chat/ChatView.client.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/composer-state.ts src/components/chat/Composer.tsx src/components/chat/chat.css src/components/chat/ChatView.client.test.tsx
git commit -m "feat(chat): add a clear button to the composer"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run the project check**

Run: `npm run check`
Expected: backend and frontend type checks, lint and formatting all pass.

- [ ] **Step 2: Run changed tests**

Run: `npm run test:changed`
Expected: all affected unit and client suites pass.

- [ ] **Step 3: Run the full suites when time allows**

Run: `npm test`
Expected: PASS. Report any skipped opt-in suites.

- [ ] **Step 4: Confirm no stray files**

Run: `git status --short`
Expected: only the intended source, test and doc files are modified; no build output.

No commit for this task unless a verification fix is needed.
