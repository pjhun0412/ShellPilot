import type { ConnectionStatus } from '@/features/connections/connectionStatus';
import type { SftpSidebarExplorer, SftpSidebarPanelState } from '@/features/sftp/sftpSidebarState';
import type { WorkspacePanelType, WorkspaceTabItem } from '@/types/workspace';
export interface SftpBookmark {
  host?: string;
  id: string;
  path: string;
  title: string;
  username?: string;
}

export interface GroupedSftpExplorer {
  count: number;
  ordinalLabel: string;
  ordinal: number;
  ordinals: number[];
  panelId: string;
  primary: SftpSidebarExplorer;
  state?: SftpSidebarPanelState;
}

export interface WorkspaceTabGroup {
  id: string;
  label: string;
  status?: WorkspaceTabVisualStatus;
  tabs: WorkspaceTabTreeItem[];
}

export interface WorkspaceTabTreeItem {
  displayTitle?: string;
  status?: WorkspaceTabVisualStatus;
  tab: WorkspaceTabItem;
}

export type WorkspaceTabVisualStatus = ConnectionStatus | 'queued';

export function ConnectionStatusDot({
  className = '',
  status,
}: {
  className?: string;
  status?: WorkspaceTabVisualStatus;
}) {
  const normalizedStatus = status ?? 'restored';

  return (
    <span
      className={[
        'size-2 rounded-full',
        normalizedStatus === 'connected'
          ? 'bg-emerald-400'
          : normalizedStatus === 'connecting'
            ? 'bg-sky-400'
            : normalizedStatus === 'queued'
              ? 'bg-amber-400'
              : normalizedStatus === 'failed'
                ? 'bg-destructive'
                : normalizedStatus === 'closed'
                  ? 'bg-slate-700'
                  : 'bg-slate-600',
        className,
      ].join(' ')}
      title={formatConnectionStatusLabel(normalizedStatus)}
    />
  );
}

export const sftpBookmarksStorageKey = 'shellpilot:sftp-bookmarks';
export const sftpShowAllExplorersStorageKey = 'shellpilot:sftp-show-all-explorers';
export const openTabsCollapsedGroupsStorageKey = 'shellpilot:open-tabs-collapsed-groups';

export function loadSftpBookmarks(): SftpBookmark[] {
  return loadSftpPathCollection(sftpBookmarksStorageKey);
}

export function loadBooleanPreference(storageKey: string, fallback: boolean) {
  try {
    const storedValue = window.localStorage.getItem(storageKey);

    if (storedValue === null) {
      return fallback;
    }

    return storedValue === 'true';
  } catch {
    return fallback;
  }
}

export function saveBooleanPreference(storageKey: string, value: boolean) {
  window.localStorage.setItem(storageKey, String(value));
}

export function loadStringSetPreference(storageKey: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');

    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }

    return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set<string>();
  }
}

export function saveStringSetPreference(storageKey: string, value: Set<string>) {
  window.localStorage.setItem(storageKey, JSON.stringify(Array.from(value)));
}

function loadSftpPathCollection(storageKey: string): SftpBookmark[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isSftpBookmark);
  } catch {
    return [];
  }
}

function isSftpBookmark(value: unknown): value is SftpBookmark {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      'path' in value &&
      'title' in value &&
      typeof (value as SftpBookmark).id === 'string' &&
      typeof (value as SftpBookmark).path === 'string' &&
      typeof (value as SftpBookmark).title === 'string',
  );
}

export function formatSftpExplorerTarget(target: Pick<SftpBookmark, 'host' | 'title' | 'username'>) {
  return formatRemoteTargetLabel({
    host: target.host,
    title: target.title,
    username: target.username,
  });
}

export function getWorkspaceTabTitle(tab: WorkspaceTabItem, panelState?: SftpSidebarPanelState) {
  if (tab.type === 'sftp') {
    return getRemotePathTitle(panelState?.path ?? tab.title);
  }

  if (tab.type === 'terminal' && tab.session) {
    return tab.session.name;
  }

  return tab.title;
}

export function getWorkspaceTabPrimaryDetail(tab: WorkspaceTabItem, panelState?: SftpSidebarPanelState) {
  if (tab.type === 'sftp') {
    return formatRemotePath(panelState?.path ?? '');
  }

  if (tab.type === 'terminal') {
    return tab.session?.kind && tab.session.kind !== 'ssh' ? tab.session.kind : '';
  }

  return '';
}

function getWorkspaceTabGroupKey(tab: WorkspaceTabItem, panelState?: SftpSidebarPanelState) {
  const username = panelState?.username ?? tab.session?.username ?? '';
  const host = panelState?.host ?? tab.session?.host;

  if (host) {
    return {
      id: `server:${username}@${host}`,
      label: formatRemoteTargetLabel({
        host,
        title: panelState?.title ?? tab.session?.name,
        username,
      }),
    };
  }

  return {
    id: `workspace:${tab.type}`,
    label: tab.type === 'terminal' && !tab.session ? 'Local Terminal' : getWorkspaceTabTypeLabel(tab.type),
  };
}

export function groupWorkspaceTabs(
  tabs: WorkspaceTabItem[],
  panelStates: Record<string, SftpSidebarPanelState>,
  connectionStates: Record<string, WorkspaceTabVisualStatus>,
): WorkspaceTabGroup[] {
  const groups = new Map<string, WorkspaceTabGroup>();
  const tabCountsByGroupAndType = new Map<string, number>();

  for (const tab of tabs) {
    const groupKey = getWorkspaceTabGroupKey(tab, panelStates[tab.id]);
    const status = getWorkspaceTabStatus(tab, panelStates[tab.id], connectionStates[tab.id]);
    const displayTitle = getWorkspaceTabTreeDisplayTitle(
      tab,
      groupKey.id,
      tabCountsByGroupAndType,
      panelStates[tab.id],
    );
    const currentGroup = groups.get(groupKey.id);
    const groupItem = { displayTitle, status, tab };

    if (currentGroup) {
      currentGroup.tabs.push(groupItem);
      currentGroup.status = summarizeConnectionStatus(currentGroup.tabs.map((item) => item.status));
      continue;
    }

    groups.set(groupKey.id, {
      id: groupKey.id,
      label: groupKey.label,
      status,
      tabs: [groupItem],
    });
  }

  return Array.from(groups.values());
}

export function getWorkspaceTabStatus(
  tab: WorkspaceTabItem,
  panelState?: SftpSidebarPanelState,
  connectionStatus?: WorkspaceTabVisualStatus,
) {
  if (connectionStatus) {
    return connectionStatus;
  }

  if (tab.type === 'sftp') {
    return panelState?.status ?? 'restored';
  }

  if (tab.type === 'terminal') {
    return 'restored';
  }

  if (tab.type === 'rdp') {
    return 'restored';
  }

  return 'idle';
}

function summarizeConnectionStatus(statuses: Array<WorkspaceTabVisualStatus | undefined>) {
  if (statuses.includes('connected')) {
    return 'connected';
  }

  if (statuses.includes('connecting')) {
    return 'connecting';
  }

  if (statuses.includes('queued')) {
    return 'queued';
  }

  if (statuses.includes('failed')) {
    return 'failed';
  }

  if (statuses.includes('restored')) {
    return 'restored';
  }

  if (statuses.includes('closed')) {
    return 'closed';
  }

  return 'idle';
}

function getWorkspaceTabTreeDisplayTitle(
  tab: WorkspaceTabItem,
  groupId: string,
  tabCountsByGroupAndType: Map<string, number>,
  panelState?: SftpSidebarPanelState,
) {
  if (tab.type !== 'terminal' && tab.type !== 'sftp') {
    return undefined;
  }

  const key = `${groupId}:${tab.type}:${getWorkspaceTabOrdinalKey(tab, panelState)}`;
  const tabCount = (tabCountsByGroupAndType.get(key) ?? 0) + 1;

  tabCountsByGroupAndType.set(key, tabCount);

  if (tab.type === 'sftp') {
    return `SFTP #${tabCount} · ${getRemotePathTitle(panelState?.path ?? tab.title)}`;
  }

  if (tab.session) {
    return tab.session.kind === 'ssh' ? `SSH #${tabCount}` : `${tab.session.kind.toUpperCase()} #${tabCount}`;
  }

  return `${getWorkspaceTabTitle(tab, panelState)} #${tabCount}`;
}

function getWorkspaceTabOrdinalKey(tab: WorkspaceTabItem, panelState?: SftpSidebarPanelState) {
  if (tab.type === 'sftp') {
    return getRemotePathTitle(panelState?.path ?? tab.title);
  }

  if (tab.type === 'terminal') {
    return tab.session?.id ?? getWorkspaceTabTitle(tab, panelState);
  }

  return tab.title;
}

function getWorkspaceTabTypeLabel(type: WorkspacePanelType) {
  if (type === 'terminal') {
    return 'Terminal';
  }

  if (type === 'sftp') {
    return 'SFTP';
  }

  if (type === 'rdp') {
    return 'RDP';
  }

  if (type === 'settings') {
    return 'Settings';
  }

  return 'AI';
}

export function formatRemoteTargetLabel({
  host,
  title,
  username,
}: {
  host?: string;
  title?: string;
  username?: string;
}) {
  const endpoint = host ? `${username ? `${username}@` : ''}${host}` : '';
  const alias = normalizeRemoteAlias(title);

  if (alias && endpoint && !isConnectionAlias(alias, endpoint, host)) {
    return `${alias} (${endpoint})`;
  }

  if (endpoint) {
    return endpoint;
  }

  return alias || 'Unknown host';
}

function normalizeRemoteAlias(title?: string) {
  return title?.replace(/^SFTP\s+-\s+/i, '').trim() ?? '';
}

function isConnectionAlias(alias: string, endpoint: string, host?: string) {
  const normalizedAlias = alias.toLowerCase();

  return normalizedAlias === endpoint.toLowerCase() || normalizedAlias === host?.toLowerCase();
}

export function getRemotePathTitle(path: string) {
  if (!path || path === '.' || path === 'Home') {
    return 'Home';
  }

  const normalizedPath = path.replace(/\\/g, '/').replace(/\/+$/g, '');
  const lastSegment = normalizedPath.split('/').filter(Boolean).pop();

  return lastSegment || '/';
}

export function formatRemotePath(path: string) {
  if (!path || path === '.') {
    return 'Home';
  }

  return path;
}

export function formatTransferSummary(summary: {
  canceled: number;
  completed: number;
  failed: number;
  running: number;
  total: number;
}) {
  if (summary.failed > 0) {
    return `${summary.failed} failed`;
  }

  if (summary.running > 0) {
    return `${summary.running} running`;
  }

  if (summary.total === 0) {
    return 'idle';
  }

  if (summary.canceled > 0) {
    return `${summary.canceled} stopped`;
  }

  return `${summary.completed} done`;
}

export function formatConnectionStatusLabel(status: WorkspaceTabVisualStatus) {
  if (status === 'connected') {
    return 'Connected';
  }

  if (status === 'connecting') {
    return 'Connecting';
  }

  if (status === 'queued') {
    return 'Reconnect queued';
  }

  if (status === 'failed') {
    return 'Failed';
  }

  if (status === 'closed') {
    return 'Disconnected';
  }

  if (status === 'idle') {
    return 'Idle';
  }

  return 'Restored';
}

export function groupSftpExplorers(
  explorers: SftpSidebarExplorer[],
  panelStates: Record<string, SftpSidebarPanelState>,
): GroupedSftpExplorer[] {
  const grouped = new Map<string, GroupedSftpExplorer>();
  const ordinalsByPanelId = new Map<string, number>();

  explorers.forEach((explorer, index) => {
    ordinalsByPanelId.set(explorer.panelId, index + 1);
  });

  for (const explorer of explorers) {
    const state = panelStates[explorer.panelId];
    const ordinal = ordinalsByPanelId.get(explorer.panelId) ?? grouped.size + 1;
    const groupKey = [
      explorer.host ?? explorer.title,
      explorer.username ?? '',
      state?.path ?? '',
    ].join('\u0000');
    const current = grouped.get(groupKey);

    if (current) {
      current.count += 1;
      current.ordinals.push(ordinal);
      if (state?.status === 'connected' && current.state?.status !== 'connected') {
        current.panelId = explorer.panelId;
        current.primary = explorer;
        current.state = state;
      }
      current.ordinal = Math.min(...current.ordinals);
      current.ordinalLabel = createSftpOrdinalLabel(current.ordinals);
      continue;
    }

    grouped.set(groupKey, {
      count: 1,
      ordinal,
      ordinalLabel: createSftpOrdinalLabel([ordinal]),
      ordinals: [ordinal],
      panelId: explorer.panelId,
      primary: explorer,
      state,
    });
  }

  return Array.from(grouped.values());
}

function createSftpOrdinalLabel(ordinals: number[]) {
  const sortedOrdinals = [...ordinals].sort((left, right) => left - right);

  if (sortedOrdinals.length <= 1) {
    return `SFTP #${sortedOrdinals[0] ?? 1}`;
  }

  const first = sortedOrdinals[0];
  const last = sortedOrdinals[sortedOrdinals.length - 1];
  const isContiguous = last - first + 1 === sortedOrdinals.length;

  return isContiguous
    ? `SFTP #${first}-#${last}`
    : `SFTP ${formatOrdinalRanges(sortedOrdinals)}`;
}

function formatOrdinalRanges(sortedOrdinals: number[]) {
  const ranges: string[] = [];
  let rangeStart = sortedOrdinals[0];
  let previous = sortedOrdinals[0];

  for (const ordinal of sortedOrdinals.slice(1)) {
    if (ordinal === previous + 1) {
      previous = ordinal;
      continue;
    }

    ranges.push(formatOrdinalRange(rangeStart, previous));
    rangeStart = ordinal;
    previous = ordinal;
  }

  ranges.push(formatOrdinalRange(rangeStart, previous));

  return ranges.join(', ');
}

function formatOrdinalRange(start: number, end: number) {
  return start === end ? `#${start}` : `#${start}-#${end}`;
}
