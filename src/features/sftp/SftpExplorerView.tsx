import { SftpFileTable, type SftpFileTableProps } from './SftpFileTable';

export function SftpExplorerView({
  showLoadingOverlay,
  ...fileTableProps
}: SftpFileTableProps & {
  showLoadingOverlay: boolean;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <SftpFileTable {...fileTableProps} />
      {showLoadingOverlay && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 border-b border-primary/20 bg-slate-950/80 px-3 py-1 text-[11px] font-medium text-primary">
          Loading SFTP directory...
        </div>
      )}
    </div>
  );
}
