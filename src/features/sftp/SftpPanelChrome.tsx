import {
  Braces,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileText,
  FileType,
  FileVideo,
  Folder,
  Package,
  ScrollText,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { SftpEntry } from './sftpBridge';

export function SftpRestoredCard({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className="absolute left-1/2 top-1/2 grid w-[min(24rem,calc(100%-1rem))] min-w-0 -translate-x-1/2 -translate-y-1/2 gap-2 overflow-hidden rounded-md border bg-card/95 p-3 text-xs shadow-lg">
      <span className="font-medium text-foreground">SFTP session restored</span>
      <span className="whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere]">
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
      <span className="font-medium text-foreground">SFTP session disconnected</span>
      <span className="whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere]">
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
    return <TerminalSquare className="size-4 shrink-0 text-sky-300" />;
  }

  const { Icon, className } = getSftpFileIcon(entry.filename);

  return <Icon className={['size-4 shrink-0', className].join(' ')} />;
}

export function getSftpFileIcon(filename: string): { className: string; Icon: LucideIcon } {
  const normalizedName = filename.toLowerCase();
  const extension = normalizedName.split('.').filter(Boolean).pop() ?? '';

  if (archiveExtensions.has(extension)) {
    return { Icon: FileArchive, className: 'text-amber-300' };
  }

  if (imageExtensions.has(extension)) {
    return { Icon: FileImage, className: 'text-fuchsia-300' };
  }

  if (videoExtensions.has(extension)) {
    return { Icon: FileVideo, className: 'text-rose-300' };
  }

  if (audioExtensions.has(extension)) {
    return { Icon: FileAudio, className: 'text-violet-300' };
  }

  if (codeExtensions.has(extension)) {
    return { Icon: FileCode, className: 'text-cyan-300' };
  }

  if (jsonExtensions.has(extension)) {
    return { Icon: FileJson, className: 'text-lime-300' };
  }

  if (configExtensions.has(extension) || configFilenames.has(normalizedName)) {
    return { Icon: FileCog, className: 'text-teal-300' };
  }

  if (databaseExtensions.has(extension)) {
    return { Icon: Database, className: 'text-emerald-300' };
  }

  if (packageExtensions.has(extension) || packageFilenames.has(normalizedName)) {
    return { Icon: Package, className: 'text-orange-300' };
  }

  if (logExtensions.has(extension)) {
    return { Icon: ScrollText, className: 'text-foreground' };
  }

  if (documentExtensions.has(extension)) {
    return { Icon: FileText, className: 'text-blue-200' };
  }

  if (fontExtensions.has(extension)) {
    return { Icon: FileType, className: 'text-indigo-300' };
  }

  if (scriptFilenames.has(normalizedName)) {
    return { Icon: Braces, className: 'text-cyan-300' };
  }

  return { Icon: File, className: 'text-muted-foreground' };
}

const archiveExtensions = new Set([
  '7z',
  'bz2',
  'gz',
  'rar',
  'tar',
  'tgz',
  'xz',
  'zip',
]);
const imageExtensions = new Set(['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const videoExtensions = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm']);
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);
const codeExtensions = new Set([
  'c',
  'cpp',
  'cs',
  'css',
  'go',
  'h',
  'hpp',
  'html',
  'java',
  'js',
  'jsx',
  'kt',
  'lua',
  'php',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'svelte',
  'swift',
  'tsx',
  'ts',
  'vue',
]);
const jsonExtensions = new Set(['json', 'jsonc']);
const configExtensions = new Set(['conf', 'config', 'env', 'ini', 'properties', 'toml', 'yaml', 'yml']);
const databaseExtensions = new Set(['db', 'sqlite', 'sqlite3']);
const packageExtensions = new Set(['deb', 'jar', 'rpm', 'war']);
const logExtensions = new Set(['log', 'out']);
const documentExtensions = new Set(['csv', 'doc', 'docx', 'md', 'pdf', 'rtf', 'txt', 'xls', 'xlsx']);
const fontExtensions = new Set(['eot', 'otf', 'ttf', 'woff', 'woff2']);
const configFilenames = new Set([
  '.bash_profile',
  '.bashrc',
  '.env',
  '.gitconfig',
  '.npmrc',
  '.profile',
  'dockerfile',
  'makefile',
]);
const packageFilenames = new Set(['package-lock.json', 'package.json', 'pnpm-lock.yaml', 'yarn.lock']);
const scriptFilenames = new Set(['gradlew']);
