import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnSizingState,
  type SortingState,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import type { SftpEntry } from './sftpBridge';
import {
  createSftpColumns,
  getSftpColumnVisibility,
  getSftpTableGridTemplateColumns,
} from './sftpTableColumns';
import { useSftpScrollRestoration } from './useSftpScrollRestoration';

export function useSftpExplorerTable({
  entries,
  panelWidth,
  path,
  showHiddenEntries,
  showPermissions,
}: {
  entries: SftpEntry[];
  panelWidth: number;
  path: string;
  showHiddenEntries: boolean;
  showPermissions: boolean;
}) {
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [sorting, setSorting] = useState<SortingState>([{ desc: false, id: 'name' }]);
  const visibleEntries = useMemo(
    () => entries.filter((entry) => showHiddenEntries || !entry.filename.startsWith('.')),
    [entries, showHiddenEntries],
  );
  const isMeasured = panelWidth > 0;
  const isCompact = isMeasured && panelWidth < 900;
  const isNarrow = isMeasured && panelWidth < 640;
  const isTiny = isMeasured && panelWidth < 380;
  const columnVisibility = useMemo(
    () => getSftpColumnVisibility({ isCompact, isNarrow, showPermissions }),
    [isCompact, isNarrow, showPermissions],
  );
  const columns = useMemo(
    () => createSftpColumns({ isCompact, isNarrow, isTiny }),
    [isCompact, isNarrow, isTiny],
  );
  const table = useReactTable({
    columnResizeMode: 'onChange',
    columns,
    data: visibleEntries,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onColumnSizingChange: setColumnSizing,
    onSortingChange: setSorting,
    state: {
      columnSizing,
      columnVisibility,
      sorting,
    },
  });
  const visibleColumns = table.getVisibleLeafColumns();
  const tableGridTemplateColumns = getSftpTableGridTemplateColumns({
    isCompact,
    visibleColumns,
  });
  const tableRows = table.getRowModel().rows;
  const tableEntries = tableRows.map((row) => row.original);
  const tableContentVersion = useMemo(() => {
    const firstPath = tableEntries[0]?.path ?? '';
    const lastPath = tableEntries[tableEntries.length - 1]?.path ?? '';

    return `${tableEntries.length}:${firstPath}:${lastPath}`;
  }, [tableEntries]);
  const {
    saveScrollPosition,
    scrollViewportRef,
  } = useSftpScrollRestoration({
    contentVersion: tableContentVersion,
    path,
  });

  return {
    isCompact,
    isNarrow,
    isTiny,
    saveScrollPosition,
    scrollViewportRef,
    table,
    tableEntries,
    tableGridTemplateColumns,
    visibleEntries,
  };
}
