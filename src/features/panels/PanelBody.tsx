import { AiAssistantPanel } from '@/features/ai/AiAssistantPanel';
import { BoundAiPanel } from '@/features/ai/BoundAiPanel';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { SftpPanel } from '@/features/sftp/SftpPanel';
import { LocalPtyTerminal } from '@/features/terminal/LocalPtyTerminal';
import { SshTerminal } from '@/features/terminal/SshTerminal';
import {
  FilePanelPlaceholder,
  LocalTerminalPlaceholder,
  LogsPanelContent,
  PanelFocusFrame,
  RdpPlaceholder,
} from '@/features/panels/PanelSurfaces';
import type { WorkspacePanel } from '@/types/workspace';

export function PanelBody({
  isActive,
  onActivate,
  onOpenSftp,
  panel,
}: {
  isActive?: boolean;
  onActivate?: () => void;
  onOpenSftp?: (session: NonNullable<WorkspacePanel['session']>) => void;
  panel: WorkspacePanel;
}) {
  if (panel.type === 'terminal') {
    return (
      <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
        {panel.localPtyTarget ? (
          <LocalPtyTerminal panelId={panel.id} target={panel.localPtyTarget} />
        ) : panel.session?.kind === 'ssh' ? (
          <SshTerminal
            autoConnect={panel.autoConnect !== false}
            panelId={panel.id}
            session={panel.session}
            onOpenSftp={onOpenSftp}
          />
        ) : (
          <LocalTerminalPlaceholder />
        )}
      </PanelFocusFrame>
    );
  }

  if (panel.type === 'ai') {
    return (
      <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
        <AiPanelContent panel={panel} />
      </PanelFocusFrame>
    );
  }

  if (panel.type === 'rdp') {
    return (
      <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
        <RdpPlaceholder />
      </PanelFocusFrame>
    );
  }

  if (panel.type === 'settings') {
    return (
      <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
        <SettingsPanel />
      </PanelFocusFrame>
    );
  }

  if (panel.type === 'sftp' && panel.session) {
    return (
      <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
        <SftpPanel
          autoConnect={panel.autoConnect !== false}
          panelId={panel.id}
          session={panel.session}
        />
      </PanelFocusFrame>
    );
  }

  return (
    <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
      <FilePanelPlaceholder />
    </PanelFocusFrame>
  );
}

function AiPanelContent({ panel }: { panel: WorkspacePanel }) {
  if (panel.aiBinding) {
    return <BoundAiPanel binding={panel.aiBinding} session={panel.session} />;
  }

  return <AiAssistantPanel panelId={panel.id} />;
}

export function LogsPanel({
  isActive,
  onActivate,
}: {
  isActive?: boolean;
  onActivate?: () => void;
}) {
  return (
    <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
      <LogsPanelContent />
    </PanelFocusFrame>
  );
}
