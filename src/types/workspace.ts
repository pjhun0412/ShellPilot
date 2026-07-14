export type SessionKind = 'ftp' | 'local' | 'ssh' | 'sftp' | 'rdp' | 'vnc' | 'docker' | 'wsl';

export type SessionStatus = 'online' | 'offline' | 'unknown' | 'connecting' | 'ready';

export type CredentialKind = 'password' | 'key' | 'token' | 'certificate';

export interface CredentialRef {
  id: string;
  kind: CredentialKind;
  label?: string;
}

export type AuthMethod = 'password' | 'key' | 'agent' | 'interactive' | 'os-credential';

export interface SessionItem {
  id: string;
  name: string;
  kind: SessionKind;
  status: SessionStatus;
  authMethod?: AuthMethod;
  credentialRef?: CredentialRef;
  favorite?: boolean;
  host?: string;
  port?: number;
  username?: string;
  groupId?: string;
  tags?: string[];
  lastUsedAt?: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface SessionGroup {
  id: string;
  name: string;
  sessions: SessionItem[];
}

export interface WorkspaceLocalPtyTarget {
  args?: string[];
  command: string;
  cwd?: string;
}

export type WorkspacePanelType = 'terminal' | 'sftp' | 'ai' | 'rdp' | 'vnc' | 'settings';

export interface AiPanelBinding {
  boundPanelId: string;
  boundPanelOrdinal?: number;
  boundPanelShortId?: string;
  boundPanelTitle: string;
  boundPanelType: WorkspacePanelType;
  contextLabel?: string;
  sessionHost?: string;
  sessionName?: string;
  sessionUsername?: string;
}

export interface WorkspacePanel {
  aiBinding?: AiPanelBinding;
  autoConnect?: boolean;
  id: string;
  localPtyTarget?: WorkspaceLocalPtyTarget;
  session?: SessionItem;
  title: string;
  type: WorkspacePanelType;
}

export interface WorkspaceTabItem {
  aiBinding?: AiPanelBinding;
  id: string;
  localPtyTarget?: WorkspaceLocalPtyTarget;
  session?: SessionItem;
  title: string;
  type: WorkspacePanelType;
}

export type ActivityId = 'sessions' | 'tabs' | 'files' | 'ai';
