import { For, Show, createEffect, createSignal, createUniqueId, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createAnchorEffect, placeBelow } from '../lib/floating';
import type { BelowAnchor } from '../lib/floating';
import type { PromptBookmark, Task } from '../store/types';
import { promptHistoryOf } from '../lib/prompt-history';
import { BookmarkIcon, HistoryAltIcon } from './icons';

type HistoryTab = 'task' | 'bookmarks';

interface HistoryCard {
  text: string;
  at?: number;
  agentId?: string;
}

export function PromptHistory(props: {
  task: Task;
  emptyLabel: string;
  bookmarks?: PromptBookmark[];
  agentName?: (agentId?: string) => string | undefined;
  onReuse: (text: string) => void;
  onToggleBookmark: (text: string) => void;
}) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<HistoryTab>('task');
  const entries = () => [...promptHistoryOf(props.task)].reverse();
  const bookmarks = () => [...(props.bookmarks ?? [])].sort((a, b) => b.savedAt - a.savedAt);
  const cards = (): HistoryCard[] =>
    activeTab() === 'task'
      ? entries().map((entry) => ({ text: entry.text, at: entry.sentAt, agentId: entry.agentId }))
      : bookmarks().map((bookmark) => ({ text: bookmark.text, at: bookmark.savedAt }));
  const savedText = (text: string) =>
    (props.bookmarks ?? []).some((bookmark) => bookmark.text === text);
  const [position, setPosition] = createSignal<BelowAnchor>({ top: 0, right: 0, maxHeight: 360 });
  let anchor: HTMLButtonElement | undefined;
  let popover: HTMLDivElement | undefined;
  const contains = (node: Node | null) =>
    !!node && (anchor?.contains(node) || popover?.contains(node));
  const blur = (event: FocusEvent) => {
    if (!(event.relatedTarget instanceof Node) || !contains(event.relatedTarget)) setOpen(false);
  };

  createAnchorEffect(open, () => {
    if (!anchor) return;
    setPosition(
      placeBelow(
        anchor.getBoundingClientRect(),
        Math.min(420, window.innerWidth - 24),
        { width: window.innerWidth, height: window.innerHeight },
        12,
        360,
      ),
    );
  });
  createEffect(() => {
    if (!open()) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (popover?.contains(document.activeElement)) anchor?.focus();
      setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    onCleanup(() => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    });
  });

  function reuse(text: string) {
    props.onReuse(text);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={anchor}
        type="button"
        class="prompt-history-trigger"
        aria-label="Prompt history"
        aria-expanded={open()}
        aria-controls={open() ? id : undefined}
        onBlur={blur}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open());
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            popover?.focus();
          }
        }}
      >
        <HistoryAltIcon size={14} />
        <span>{props.task.lastPrompt || props.emptyLabel}</span>
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={popover}
            id={id}
            role="region"
            aria-label="Prompt history"
            tabIndex={0}
            class="prompt-history-popover"
            onClick={(event) => event.stopPropagation()}
            onFocusOut={blur}
            style={{
              top: `${position().top}px`,
              right: `${position().right}px`,
              'max-height': `${Math.min(360, position().maxHeight)}px`,
            }}
          >
            <div class="prompt-history-tabs" role="tablist" aria-label="Prompt history">
              <button
                type="button"
                role="tab"
                class="prompt-history-tab"
                aria-selected={activeTab() === 'task'}
                onClick={() => setActiveTab('task')}
              >
                This task ({entries().length})
              </button>
              <button
                type="button"
                role="tab"
                class="prompt-history-tab"
                aria-selected={activeTab() === 'bookmarks'}
                onClick={() => setActiveTab('bookmarks')}
              >
                Bookmarked ({bookmarks().length})
              </button>
            </div>
            <div
              role="tabpanel"
              aria-label={activeTab() === 'task' ? 'This task prompts' : 'Bookmarked prompts'}
            >
              <Show
                when={cards().length}
                fallback={
                  <p>
                    {activeTab() === 'task' ? 'No prompts sent yet.' : 'No bookmarked prompts yet.'}
                  </p>
                }
              >
                <ol class="prompt-history-cards">
                  <For each={cards()}>
                    {(card) => (
                      <li class="prompt-history-card">
                        <button
                          type="button"
                          class="prompt-history-card-reuse"
                          title="Reuse this prompt"
                          onClick={() => reuse(card.text)}
                        >
                          <span class="prompt-history-card-text">{card.text}</span>
                          <span class="prompt-history-card-meta">
                            <Show when={card.at}>
                              {(at) => (
                                <time title={new Date(at()).toLocaleString()}>
                                  {new Date(at()).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </time>
                              )}
                            </Show>
                            <Show when={props.agentName?.(card.agentId)}>
                              {(name) => <span class="prompt-history-card-agent">{name()}</span>}
                            </Show>
                          </span>
                        </button>
                        <button
                          type="button"
                          class="prompt-history-card-bookmark"
                          aria-pressed={savedText(card.text)}
                          aria-label={savedText(card.text) ? 'Remove bookmark' : 'Bookmark prompt'}
                          title={savedText(card.text) ? 'Remove bookmark' : 'Bookmark prompt'}
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onToggleBookmark(card.text);
                          }}
                        >
                          <BookmarkIcon size={13} />
                        </button>
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}
