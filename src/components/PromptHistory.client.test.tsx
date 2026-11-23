import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptBookmark, Task } from '../store/types';
import { PromptHistory } from './PromptHistory';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

function mount(overrides: Partial<Task> = {}, bookmarks: PromptBookmark[] = []) {
  const task: Task = {
    id: 'task',
    name: 'Task',
    projectId: 'project',
    branchName: 'branch',
    worktreePath: '/repo',
    agentIds: [],
    shellAgentIds: [],
    notes: '',
    lastPrompt: '',
    gitIsolation: 'worktree',
    ...overrides,
  };
  const parentClick = vi.fn();
  const onReuse = vi.fn();
  const onToggleBookmark = vi.fn();
  const root = document.createElement('div');
  document.body.append(root);
  dispose = render(
    () => (
      <div onClick={parentClick}>
        <PromptHistory
          task={task}
          emptyLabel="No prompts sent"
          bookmarks={bookmarks}
          agentName={(agentId) => (agentId === 'agent-1' ? 'Claude' : undefined)}
          onReuse={onReuse}
          onToggleBookmark={onToggleBookmark}
        />
      </div>
    ),
    root,
  );
  const button = root.querySelector('button');
  if (!button) throw new Error('Missing history trigger');
  return { button, parentClick, onReuse, onToggleBookmark };
}

const tab = (label: RegExp) => {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (candidate) => label.test(candidate.textContent ?? ''),
  );
  if (!button) throw new Error(`Missing tab: ${label}`);
  return button;
};
const cards = () =>
  [...document.querySelectorAll('.prompt-history-card-text')].map((card) => card.textContent);
const bookmarkButtons = () => [
  ...document.querySelectorAll<HTMLButtonElement>('.prompt-history-card-bookmark'),
];

describe('PromptHistory', () => {
  it('shows this task’s prompts newest first with counts on each tab', () => {
    const { button } = mount({
      lastPrompt: 'Second prompt',
      promptHistory: [
        { text: 'First prompt\nwith another line', sentAt: 1700000000000, agentId: 'agent-1' },
        { text: '<script>plain text</script>' },
        { text: 'Second prompt' },
      ],
    });
    button.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('[role="region"]')).toBeNull();
    button.click();
    const popover = document.querySelector('[role="region"]');
    expect(popover).not.toBeNull();
    expect(cards()).toEqual([
      'Second prompt',
      '<script>plain text</script>',
      'First prompt\nwith another line',
    ]);
    expect(tab(/^This task/).textContent).toBe('This task (3)');
    expect(tab(/^Bookmarked/).textContent).toBe('Bookmarked (0)');
    expect(popover?.querySelector('script')).toBeNull();
  });

  it('lists project bookmarks newest first and switches back to the task', () => {
    const { button } = mount({ promptHistory: [{ text: 'Task prompt' }] }, [
      { text: 'Older bookmark', savedAt: 1 },
      { text: 'Newer bookmark', savedAt: 2 },
    ]);
    button.click();
    tab(/^Bookmarked/).click();
    expect(cards()).toEqual(['Newer bookmark', 'Older bookmark']);
    expect(tab(/^Bookmarked/).textContent).toBe('Bookmarked (2)');
    expect(document.querySelector('[role="tabpanel"]')?.getAttribute('aria-label')).toBe(
      'Bookmarked prompts',
    );
    tab(/^This task/).click();
    expect(cards()).toEqual(['Task prompt']);
  });

  it('reuses a card, closes the popover and keeps the click inside', () => {
    const { button, parentClick, onReuse } = mount({
      promptHistory: [{ text: 'Old' }, { text: 'Newest' }],
    });
    button.click();
    document.querySelector<HTMLButtonElement>('.prompt-history-card-reuse')?.click();
    expect(onReuse).toHaveBeenCalledWith('Newest');
    expect(document.querySelector('[role="region"]')).toBeNull();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('toggles a bookmark without reusing or closing, and shows the saved state', () => {
    const { button, onReuse, onToggleBookmark } = mount(
      { promptHistory: [{ text: 'Saved prompt' }, { text: 'Other prompt' }] },
      [{ text: 'Saved prompt', savedAt: 1 }],
    );
    button.click();
    expect(bookmarkButtons().map((candidate) => candidate.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
    ]);
    bookmarkButtons()[1]?.click();
    expect(onToggleBookmark).toHaveBeenCalledWith('Saved prompt');
    expect(onReuse).not.toHaveBeenCalled();
    expect(document.querySelector('[role="region"]')).not.toBeNull();
  });

  it('shows an empty task history and an empty bookmark list', () => {
    const { button } = mount();
    button.click();
    expect(document.querySelector('[role="region"]')?.textContent).toContain(
      'No prompts sent yet.',
    );
    tab(/^Bookmarked/).click();
    expect(document.querySelector('[role="region"]')?.textContent).toContain(
      'No bookmarked prompts yet.',
    );
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.querySelector('[role="region"]')).toBeNull();
  });

  it('renders time only for entries that have one', () => {
    mount({
      promptHistory: [
        { text: 'Untimed' },
        { text: 'Timed', sentAt: 1700000000000, agentId: 'agent-1' },
      ],
    }).button.click();
    expect([...document.querySelectorAll('.prompt-history-card-meta time')]).toHaveLength(1);
    expect(document.querySelector('.prompt-history-card-meta')?.textContent).toContain('Claude');
  });

  it('supports keyboard access and Escape without handing focus to the terminal', () => {
    const { button, parentClick } = mount({ lastPrompt: 'Legacy prompt' });
    button.focus();
    button.click();
    expect(parentClick).not.toHaveBeenCalled();
    expect(cards()).toEqual(['Legacy prompt']);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement?.getAttribute('role')).toBe('region');
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(document.querySelector('[role="region"]')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});
