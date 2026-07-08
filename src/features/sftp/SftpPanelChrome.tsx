import { File, FileSymlink, Folder } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { SftpEntry } from './sftpBridge';

export function SftpRestoredCard({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className="absolute left-1/2 top-1/2 grid w-[min(24rem,calc(100%-1rem))] min-w-0 -translate-x-1/2 -translate-y-1/2 gap-2 overflow-hidden rounded-md border bg-card/95 p-3 text-xs shadow-lg">
      <span className="font-medium text-slate-100">SFTP session restored</span>
      <span className="whitespace-pre-wrap break-words text-slate-300 [overflow-wrap:anywhere]">
        Remote file listing was not restored. Reconnect to open a new SFTP session.
      </span>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" type="button" onClick={onReconnect}>
          Reconnect
        </Button>
      </div>
    </div>
  );
}

export function SftpClosedCard({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className="absolute left-1/2 top-1/2 grid w-[min(24rem,calc(100%-1rem))] min-w-0 -translate-x-1/2 -translate-y-1/2 gap-2 overflow-hidden rounded-md border bg-card/95 p-3 text-xs shadow-lg">
      <span className="font-medium text-slate-100">SFTP session disconnected</span>
      <span className="whitespace-pre-wrap break-words text-slate-300 [overflow-wrap:anywhere]">
        Remote file listing was cleared. Reconnect to browse this server again.
      </span>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" type="button" onClick={onReconnect}>
          Reconnect
        </Button>
      </div>
    </div>
  );
}

export function SftpEntryIcon({ entry }: { entry: SftpEntry }) {
  if (entry.isDirectory) {
    return <Folder className="size-4 shrink-0 text-primary" />;
  }

  if (entry.kind === 'symlink') {
    return <FileSymlink className="size-4 shrink-0 text-slate-400" />;
  }

  return <File className="size-4 shrink-0 text-slate-400" />;
}
