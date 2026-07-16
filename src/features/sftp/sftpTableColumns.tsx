import type { ColumnDef } from '@tanstack/react-table';

import { SftpEntryIcon } from './SftpPanelChrome';
import { formatBytes, formatModifiedAt } from './sftpPanelUtils';
import type { SftpEntry } from './sftpBridge';

export function getSftpColumnVisibility({
  isCompact,
  isNarrow,
  showPermissions,
}: {
  isCompact: boolean;
  isNarrow: boolean;
  showPermissions: boolean;
}) {
  return {
    kind: !isCompact,
    modifiedAt: !isNarrow,
    owner: !isCompact,
    permissions: showPermissions && !isCompact,
  };
}

export function createSftpColumns({
  isCompact,
  isNarrow,
  isTiny,
}: {
  isCompact: boolean;
  isNarrow: boolean;
  isTiny: boolean;
}): ColumnDef<SftpEntry>[] {
  return [
    {
      accessorKey: 'filename',
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2">
          <SftpEntryIcon entry={row.original} />
          <span className="grid min-w-0 gap-0.5">
            <span className="truncate font-semibold tracking-[-0.01em] text-foreground">{row.original.filename}</span>
            {isNarrow && (
              <span className="truncate font-mono text-[10px] font-normal text-muted-foreground">
                {row.original.kind}
                {row.original.modifiedAt ? ` · ${formatModifiedAt(row.original.modifiedAt)}` : ''}
              </span>
            )}
          </span>
        </span>
      ),
      header: 'Name',
      id: 'name',
      minSize: isTiny ? 132 : 180,
      size: 360,
    },
    {
      accessorKey: 'kind',
      cell: ({ row }) => (
        <span className="font-mono text-[11px] text-muted-foreground">{row.original.kind}</span>
      ),
      header: 'Type',
      id: 'kind',
      minSize: 72,
      size: 92,
    },
    {
      accessorKey: 'modifiedAt',
      cell: ({ row }) => (
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {formatModifiedAt(row.original.modifiedAt)}
        </span>
      ),
      header: 'Modified',
      id: 'modifiedAt',
      minSize: isCompact ? 120 : 136,
      size: isCompact ? 144 : 168,
      sortingFn: (left, right) =>
        (left.original.modifiedAt ?? 0) - (right.original.modifiedAt ?? 0),
    },
    {
      accessorKey: 'permissions',
      cell: ({ row }) => (
        <span className="block w-full text-right font-mono text-[11px] text-muted-foreground">
          {row.original.permissions ?? ''}
        </span>
      ),
      header: 'Perm',
      id: 'permissions',
      minSize: 72,
      size: 82,
    },
    {
      accessorKey: 'owner',
      cell: ({ row }) => (
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {row.original.owner ?? ''}
        </span>
      ),
      header: 'Owner',
      id: 'owner',
      minSize: 78,
      size: 96,
    },
    {
      accessorFn: (entry) => entry.size ?? 0,
      cell: ({ row }) => (
        <span className="block w-full text-right font-mono text-[11px] text-muted-foreground">
          {formatBytes(row.original.size)}
        </span>
      ),
      header: 'Size',
      id: 'size',
      minSize: isNarrow ? 78 : isCompact ? 88 : 112,
      size: isNarrow ? 86 : isCompact ? 104 : 144,
    },
  ];
}

export function getSftpTableGridTemplateColumns({
  isCompact,
  visibleColumns,
}: {
  isCompact: boolean;
  visibleColumns: Array<{
    columnDef: { minSize?: number };
    getSize: () => number;
    id: string;
  }>;
}) {
  const gridTemplateColumns = visibleColumns
    .map((column) => {
      if (column.id === 'name') {
        return `minmax(${column.columnDef.minSize ?? 180}px, 1fr)`;
      }

      return `${column.getSize()}px`;
    })
    .join(' ');

  return `${gridTemplateColumns} ${isCompact ? 8 : 18}px`;
}
