import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import { IPC } from '../../electron/ipc/channels';
import { invoke } from '../lib/ipc';
import { errMessage } from '../lib/log';
import {
  browseCodeHostIssues,
  readCodeHostIssue,
  readCodeHostIssueActivity,
} from '../store/codehost';
import { openGitHubIssues } from '../store/github';
import type { CodeHostActivityEntry, CodeHostIssuePage, CodeHostIssueSummary } from '../ipc/types';
import type { Project } from '../store/types';
import { renderChatMarkdown } from './chat/chat-markdown';
import { AlertIcon, ArrowLeftIcon, ExternalLinkIcon, SyncIcon } from './icons';
import { ResizablePanel, type PanelChild } from './ResizablePanel';
import './github-issues.css';

const SEARCH_DEBOUNCE_MS = 400;

/** A read-only browser for a GitLab project's issues, with their notes. */
export function GitLabIssuesPage(props: { project: Project }) {
  const [search, setSearch] = createSignal('');
  const [state, setState] = createSignal<'open' | 'closed' | 'all'>('open');
  const [items, setItems] = createSignal<CodeHostIssueSummary[]>([]);
  const [repository, setRepository] = createSignal('');
  const [hasMore, setHasMore] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [revision, setRevision] = createSignal(0);
  const [nextPage, setNextPage] = createSignal(1);
  const [selectedUrl, setSelectedUrl] = createSignal<string | null>(null);
  let requestId = 0;
  let searchTimer: number | undefined;
  onCleanup(() => clearTimeout(searchTimer));

  async function load(targetPage: number, append: boolean): Promise<void> {
    const id = ++requestId;
    setLoading(true);
    setError('');
    try {
      const result: CodeHostIssuePage = await browseCodeHostIssues(props.project.path, {
        search: search(),
        state: state(),
        page: targetPage,
      });
      if (id !== requestId) return;
      setRepository(`${result.project.host}/${result.project.projectPath}`);
      setItems((previous) => (append ? [...previous, ...result.items] : result.items));
      setHasMore(result.hasMore);
      setNextPage(targetPage + 1);
      if (!append && !result.items.some((item) => item.url === selectedUrl())) {
        setSelectedUrl(result.items[0]?.url ?? null);
      }
    } catch (err) {
      if (id !== requestId) return;
      setError(errMessage(err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
    } finally {
      if (id === requestId) setLoading(false);
    }
  }

  // A new search, state or refresh starts over from page 1 and keeps the selection if it survives.
  createEffect(
    on([search, state, revision], () => {
      void load(1, false);
    }),
  );

  function refresh(): void {
    setRevision((value) => value + 1);
  }

  function searchChanged(value: string): void {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => setSearch(value.trim()), SEARCH_DEBOUNCE_MS);
  }

  const listPane: PanelChild = {
    id: 'list',
    minSize: 220,
    defaultSize: 400,
    resizeLabel: 'Resize issue list',
    content: () => (
      <div class="github-issues-listpane">
        <div class="github-issues-filters">
          <input
            type="search"
            name="search"
            aria-label="Search issues"
            placeholder="Search issues…"
            onInput={(event) => searchChanged(event.currentTarget.value)}
          />
          <select
            aria-label="Issue state"
            value={state()}
            onChange={(event) => setState(event.currentTarget.value as 'open' | 'closed' | 'all')}
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
          <button
            type="button"
            aria-label="Refresh"
            title="Refresh the list and the open issue"
            disabled={loading()}
            onClick={refresh}
          >
            <SyncIcon />
          </button>
        </div>
        <section class="github-issues-list" aria-label="Repository issues">
          <Show when={error()}>
            <div role="alert" class="github-issues-error">
              <AlertIcon size={14} />
              <span>{error()}</span>
              <button onClick={refresh}>Retry</button>
            </div>
          </Show>
          <Show when={loading() && !items().length}>
            <div role="status" class="github-issues-loading">
              Loading issues…
              <span class="github-issues-skeleton" aria-hidden="true" />
              <span class="github-issues-skeleton" aria-hidden="true" />
              <span class="github-issues-skeleton" aria-hidden="true" />
            </div>
          </Show>
          <div class="github-issues-rows" aria-busy={loading() || undefined}>
            <Show when={!error() && !loading() && !items().length}>
              <div class="github-issues-empty">No issues match these filters.</div>
            </Show>
            <For each={items()}>
              {(issue) => (
                <button
                  type="button"
                  class="github-issue-row"
                  aria-pressed={selectedUrl() === issue.url}
                  onClick={() => setSelectedUrl(issue.url)}
                >
                  <span class="github-issue-row-head">
                    <strong>{issue.title}</strong>
                    <time dateTime={issue.updatedAt}>
                      {new Date(issue.updatedAt).toLocaleDateString()}
                    </time>
                  </span>
                  <span class="github-issue-row-meta">
                    <span class={`github-issue-state ${issue.state}`}>{issue.state}</span>
                    <span>#{issue.iid}</span>
                    <span>@{issue.author}</span>
                  </span>
                  <Show when={issue.labels.length}>
                    <span class="github-issue-labels">
                      <For each={issue.labels}>{(label) => <span>{label}</span>}</For>
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
          <Show when={hasMore()}>
            <div class="github-issues-pagination">
              <button
                type="button"
                disabled={loading()}
                aria-busy={loading() || undefined}
                onClick={() => void load(nextPage(), true)}
              >
                {loading() ? 'Loading…' : 'Load more'}
              </button>
            </div>
          </Show>
        </section>
      </div>
    ),
  };
  const detailPane: PanelChild = {
    id: 'detail',
    minSize: 260,
    content: () => <GitLabIssueDetail url={selectedUrl()} revision={revision()} />,
  };
  return (
    <section class="github-issues" aria-labelledby="gitlab-issues-title">
      <header class="github-issues-heading">
        <button
          type="button"
          class="github-issues-back"
          aria-label="Back to tasks"
          title="Back to tasks"
          onClick={() => openGitHubIssues(null)}
        >
          <ArrowLeftIcon /> Tasks
        </button>
        <div class="github-issues-title">
          <h2 id="gitlab-issues-title">
            Issues <span>· {props.project.name}</span>
          </h2>
          <small>{repository() || 'GitLab'}</small>
        </div>
        <span class="github-issue-byline">GitLab</span>
      </header>
      <ResizablePanel
        direction="horizontal"
        persistKey="gitlab-split"
        class="github-issues-content"
        absorberIds={['detail']}
        children={[listPane, detailPane]}
      />
    </section>
  );
}

function GitLabIssueDetail(props: {
  url: string | null;
  /** Bumped by the list's Refresh; reloads the issue and its notes. */
  revision: number;
}) {
  const [issue, { refetch: refetchIssue }] = createResource(
    () => props.url,
    (url) => readCodeHostIssue(url),
  );
  const loaded = () => (issue.error ? undefined : issue());
  const [activityPage, setActivityPage] = createSignal(1);
  const [activityRevision, setActivityRevision] = createSignal(0);
  const [activity] = createResource(
    () =>
      props.url ? { url: props.url, page: activityPage(), revision: activityRevision() } : null,
    ({ url, page }) => readCodeHostIssueActivity(url, page).then((result) => ({ ...result, page })),
  );
  const [notes, setNotes] = createSignal<CodeHostActivityEntry[]>([]);
  // A refetch keeps its previous value while loading, so only notes fetched
  // for the current issue may land, never the last issue's.
  let notesUrl: string | null = untrack(() => props.url);
  createEffect(() => {
    const loadedPage = activity.error ? undefined : activity();
    if (!loadedPage || notesUrl !== props.url) return;
    setNotes((current) =>
      loadedPage.page === 1 ? loadedPage.items : [...current, ...loadedPage.items],
    );
  });
  createEffect(
    on(
      () => props.url,
      () => {
        notesUrl = props.url;
        batch(() => {
          setActivityPage(1);
          setNotes([]);
        });
        loadNotes();
      },
      { defer: true },
    ),
  );
  createEffect(
    on(
      () => props.revision,
      () => {
        void refetchIssue();
        reloadNotes();
      },
      { defer: true },
    ),
  );
  function loadNotes(): void {
    setActivityRevision((value) => value + 1);
  }
  function reloadNotes(): void {
    batch(() => {
      setActivityPage(1);
      loadNotes();
    });
  }
  function external(url: string): void {
    void invoke(IPC.ShellOpenExternal, { url });
  }
  return (
    <div class="github-issues-detail">
      <Show when={!props.url}>
        <div class="github-issue-detail-body">
          <p class="github-issues-empty">Select an issue to read it here.</p>
        </div>
      </Show>
      <Show when={props.url}>
        <div class="github-issue-detail-body">
          <Show when={issue.loading}>
            <p role="status">Loading issue…</p>
          </Show>
          <Show when={issue.error}>
            <p role="alert" class="github-issues-error">
              {errMessage(issue.error)} <button onClick={() => void refetchIssue()}>Retry</button>
            </p>
          </Show>
          <Show when={loaded()}>
            {(current) => (
              <>
                <div class="github-issues-actions">
                  <span class={`github-issue-state ${current().state}`}>
                    {current().state} · #{current().iid}
                  </span>
                  <button type="button" onClick={() => external(current().url)}>
                    <ExternalLinkIcon /> Open in GitLab
                  </button>
                </div>
                <h2>{current().title}</h2>
                <p class="github-issue-byline">
                  Opened by @{current().author} · updated{' '}
                  {new Date(current().updatedAt).toLocaleString()}
                </p>
                <Show when={current().labels.length}>
                  <div class="github-issue-labels">
                    <For each={current().labels}>{(label) => <span>{label}</span>}</For>
                  </div>
                </Show>
                <h3>Description</h3>
                <GitLabMarkdown
                  body={current().description || '_No description provided._'}
                  onOpen={external}
                />
                <h3>Notes</h3>
                <Show when={activity.error}>
                  <p role="alert" class="github-issues-error">
                    {errMessage(activity.error)} <button onClick={loadNotes}>Retry notes</button>
                  </p>
                </Show>
                <Show when={!activity.loading && !activity.error && !notes().length}>
                  <p>No notes yet.</p>
                </Show>
                <For each={notes()}>
                  {(note) => (
                    <article class="github-issue-activity">
                      <div class="github-issue-byline">
                        <strong>@{note.author}</strong> {note.event}{' '}
                        <time>
                          {note.createdAt ? new Date(note.createdAt).toLocaleString() : ''}
                        </time>
                      </div>
                      <Show when={note.body}>
                        <GitLabMarkdown body={note.body} onOpen={external} />
                      </Show>
                    </article>
                  )}
                </For>
                <Show when={activity.loading && !notes().length}>
                  <p role="status">Loading notes…</p>
                </Show>
                <Show
                  when={
                    !activity.error && notes().length && (activity.loading || activity()?.hasMore)
                  }
                >
                  <button
                    type="button"
                    disabled={activity.loading}
                    aria-busy={activity.loading || undefined}
                    onClick={() => setActivityPage((page) => page + 1)}
                  >
                    {activity.loading ? 'Loading notes…' : 'Load more notes'}
                  </button>
                </Show>
              </>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

function GitLabMarkdown(props: { body: string; onOpen: (url: string) => void }) {
  const html = createMemo(() => renderChatMarkdown(props.body));
  return (
    <div
      class="github-issue-markdown"
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest('a');
        if (!link) return;
        event.preventDefault();
        const url = link.getAttribute('href') ?? '';
        if (/^https?:\/\//i.test(url)) props.onOpen(url);
      }}
      // eslint-disable-next-line solid/no-innerhtml -- renderChatMarkdown sanitizes untrusted issue text.
      innerHTML={html()}
    />
  );
}
