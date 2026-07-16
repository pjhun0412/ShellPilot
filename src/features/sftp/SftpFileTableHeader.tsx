import { flexRender, type Table } from '@tanstack/react-table';

import type { SftpEntry } from './sftpBridge';

export function SftpFileTableHeader({
  table,
  tableGridTemplateColumns,
}: {
  table: Table<SftpEntry>;
  tableGridTemplateColumns: string;
}) {
  return (
    <>
      {table.getHeaderGroups().map((headerGroup) => (
        <div
          className="grid shrink-0 items-center gap-x-2 border-b border-border/70 bg-slate-950/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-200"
          key={headerGroup.id}
          style={{ gridTemplateColumns: tableGridTemplateColumns }}
        >
          {headerGroup.headers.map((header) => (
            <div className="relative min-w-0 pr-2" key={header.id}>
              <button
                className={[
                  'flex h-6 w-full min-w-0 items-center gap-1 rounded px-1 text-left text-slate-200 hover:bg-slate-800/80 hover:text-slate-50',
                  header.column.id === 'size' ? 'justify-end text-right' : 'justify-start',
                  header.column.getIsSorted() ? 'text-primary' : '',
                ].join(' ')}
                type="button"
                onClick={header.column.getToggleSortingHandler()}
              >
                <span className="truncate">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </span>
                {header.column.getIsSorted() && (
                  <span className="font-mono text-[10px] text-primary">
                    {header.column.getIsSorted() === 'asc' ? '▲' : '▼'}
                  </span>
                )}
              </button>
              <span
                className={[
                  'absolute right-0 top-0 h-full w-2 cursor-col-resize border-r hover:border-primary/80',
                  header.column.getIsResizing() ? 'border-primary' : 'border-border/50',
                ].join(' ')}
                role="separator"
                aria-orientation="vertical"
                onDoubleClick={() => header.column.resetSize()}
                onMouseDown={header.getResizeHandler()}
                onTouchStart={header.getResizeHandler()}
              />
            </div>
          ))}
          <span aria-hidden="true" />
        </div>
      ))}
    </>
  );
}
