import { For, Show, createSignal, onMount } from 'solid-js';
import { confirm } from '../../lib/dialog';
import { errMessage } from '../../lib/log';
import { theme } from '../../lib/theme';
import {
  clearCodeHostProjectChecks,
  deleteCodeHostHost,
  listCodeHostHosts,
  saveCodeHostHost,
  testCodeHostHost,
} from '../../store/codehost';
import type { CodeHostHostsSnapshot, CodeHostInstance } from '../../ipc/types';
import { SettingsCard, SettingsSection, settingsFieldStyle } from './settings-ui';

const errorText = (err: unknown) =>
  errMessage(err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

/**
 * GitLab instances issues can come from: one row per instance, with its PAT.
 * GitHub needs no entry; its `gh` sign-in already covers every github.com repo.
 */
export function CodeHostSettings() {
  const [snapshot, setSnapshot] = createSignal<CodeHostHostsSnapshot | null>(null);
  const [loadError, setLoadError] = createSignal('');
  // null while the form is closed; '' for a new instance, else the instance id.
  const [editing, setEditing] = createSignal<string | null>(null);
  const [label, setLabel] = createSignal('');
  const [baseUrl, setBaseUrl] = createSignal('');
  const [username, setUsername] = createSignal('');
  const [token, setToken] = createSignal('');
  const [caPath, setCaPath] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [formError, setFormError] = createSignal('');
  const [testResult, setTestResult] = createSignal('');

  function reload(): void {
    listCodeHostHosts().then(
      (result) => {
        setSnapshot(result);
        setLoadError('');
      },
      (err: unknown) => setLoadError(errorText(err)),
    );
  }
  onMount(reload);

  function startCreate(): void {
    setEditing('');
    setLabel('');
    setBaseUrl('');
    setUsername('');
    setToken('');
    setCaPath('');
    setFormError('');
    setTestResult('');
  }

  function startEdit(instance: CodeHostInstance): void {
    setEditing(instance.id);
    setLabel(instance.label);
    setBaseUrl(instance.baseUrl);
    setUsername(instance.username ?? '');
    // Blank keeps the stored token, so it never has to be retyped or revealed.
    setToken('');
    setCaPath(instance.caPath ?? '');
    setFormError('');
    setTestResult('');
  }

  const instanceId = () => {
    const id = editing();
    return id ? id : undefined;
  };

  async function test(): Promise<void> {
    setBusy(true);
    setFormError('');
    setTestResult('');
    try {
      const result = await testCodeHostHost({
        id: instanceId(),
        baseUrl: baseUrl(),
        token: token().trim() || undefined,
        caPath: caPath().trim() || undefined,
      });
      setTestResult(`Signed in as @${result.login}${result.name ? ` (${result.name})` : ''}`);
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setFormError('');
    try {
      await saveCodeHostHost({
        id: instanceId(),
        kind: 'gitlab',
        label: label().trim(),
        baseUrl: baseUrl().trim(),
        username: username().trim() || undefined,
        token: token().trim() || undefined,
        caPath: caPath().trim() || undefined,
      });
      clearCodeHostProjectChecks();
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(instance: CodeHostInstance): Promise<void> {
    const ok = await confirm(
      `Remove ${instance.label}? Projects on it stop showing issues until it is added again.`,
      { okLabel: 'Remove', cancelLabel: 'Keep' },
    );
    if (!ok) return;
    try {
      await deleteCodeHostHost(instance.id);
      clearCodeHostProjectChecks();
      reload();
    } catch (err) {
      setLoadError(errorText(err));
    }
  }

  return (
    <SettingsSection title="Code hosts">
      <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>
        GitHub issues come from your <code>gh</code> sign-in. Add each GitLab instance once; its
        projects then show their issues in the same browser, read with your personal access token.
      </span>
      <Show when={loadError()}>
        <span role="alert" style={{ 'font-size': '12px', color: theme.error }}>
          {loadError()}
        </span>
      </Show>
      <For each={snapshot()?.instances ?? []}>
        {(instance) => (
          <SettingsCard>
            <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
              <strong style={{ 'font-size': '13px' }}>{instance.label}</strong>
              <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>
                {instance.baseUrl}
                {instance.username ? ` · ${instance.username}` : ''}
                {instance.hasToken ? '' : ' · no token'}
              </span>
              <span style={{ 'margin-left': 'auto', display: 'flex', gap: '6px' }}>
                <button type="button" onClick={() => startEdit(instance)}>
                  Edit
                </button>
                <button type="button" onClick={() => void remove(instance)}>
                  Remove
                </button>
              </span>
            </div>
          </SettingsCard>
        )}
      </For>
      <Show when={snapshot() && snapshot()?.instances.length === 0}>
        <SettingsCard>
          <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>
            No GitLab instances yet. Projects on github.com work without one.
          </span>
        </SettingsCard>
      </Show>
      <Show when={snapshot() && !snapshot()?.encryptionAvailable}>
        <span style={{ 'font-size': '12px', color: theme.fgMuted }}>
          This system keyring is unavailable, so tokens are stored unencrypted in the app's data
          folder.
        </span>
      </Show>

      <Show
        when={editing() !== null}
        fallback={
          <button type="button" style={{ 'align-self': 'flex-start' }} onClick={startCreate}>
            Add GitLab instance
          </button>
        }
      >
        <SettingsCard>
          <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
            <span style={{ 'font-size': '12px', color: theme.fgMuted }}>Name</span>
            <input
              value={label()}
              onInput={(e) => setLabel(e.currentTarget.value)}
              placeholder="Company GitLab"
              style={settingsFieldStyle}
            />
          </label>
          <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
            <span style={{ 'font-size': '12px', color: theme.fgMuted }}>Instance URL</span>
            <input
              value={baseUrl()}
              onInput={(e) => setBaseUrl(e.currentTarget.value)}
              placeholder="https://gitlab.example.com"
              spellcheck={false}
              style={settingsFieldStyle}
            />
          </label>
          <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
            <span style={{ 'font-size': '12px', color: theme.fgMuted }}>Username (optional)</span>
            <input
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
              style={settingsFieldStyle}
            />
          </label>
          <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
            <span style={{ 'font-size': '12px', color: theme.fgMuted }}>
              Personal access token{instanceId() ? ' (blank keeps the stored one)' : ''}
            </span>
            <input
              type="password"
              value={token()}
              onInput={(e) => setToken(e.currentTarget.value)}
              autocomplete="new-password"
              spellcheck={false}
              style={settingsFieldStyle}
            />
            <span style={{ 'font-size': '11px', color: theme.fgSubtle }}>
              Needs the <code>api</code> or <code>read_api</code> scope. Stored with the OS keyring
              where available; it never leaves this machine.
            </span>
          </label>
          <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
            <span style={{ 'font-size': '12px', color: theme.fgMuted }}>
              CA bundle path (optional)
            </span>
            <input
              value={caPath()}
              onInput={(e) => setCaPath(e.currentTarget.value)}
              placeholder="/etc/ssl/certs/company-ca.pem"
              spellcheck={false}
              style={settingsFieldStyle}
            />
          </label>
          <Show when={formError()}>
            <span role="alert" style={{ 'font-size': '12px', color: theme.error }}>
              {formError()}
            </span>
          </Show>
          <Show when={testResult()}>
            <span role="status" style={{ 'font-size': '12px', color: theme.success }}>
              {testResult()}
            </span>
          </Show>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" disabled={busy()} onClick={() => void test()}>
              Test connection
            </button>
            <button type="button" disabled={busy()} onClick={() => void save()}>
              {busy() ? 'Saving…' : 'Save'}
            </button>
            <button type="button" disabled={busy()} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </SettingsCard>
      </Show>
    </SettingsSection>
  );
}
