import type { ReactNode } from 'react';

import {
  COMMANDER_HEADER_CLASS_NAME,
  getGridTemplateColumns,
  type CommanderPaneVariant,
  type CommanderSortKey,
  type CommanderSortState,
} from './sftpCommanderUtils';

export function CommanderHeader({
  onMouseDown,
  onSortChange,
  sort,
  variant,
}: {
  onMouseDown: () => void;
  onSortChange: (sort: CommanderSortState) => void;
  sort: CommanderSortState;
  variant: CommanderPaneVariant;
}) {
  const gridTemplateColumns = getGridTemplateColumns(variant);
  const handleSortClick = (key: CommanderSortKey) => {
    onSortChange(sort.key === key ? { key, desc: !sort.desc } : { key, desc: false });
  };

  return (
    <div
      className={COMMANDER_HEADER_CLASS_NAME}
      style={{ gridTemplateColumns }}
      onMouseDown={onMouseDown}
    >
      <CommanderHeaderCell
        isActive={sort.key === 'name'}
        onClick={() => handleSortClick('name')}
      >
        <>
          <span className="truncate">Name</span>
          {sort.key === 'name' && <CommanderSortIndicator desc={sort.desc} />}
        </>
      </CommanderHeaderCell>
      <CommanderHeaderCell
        isActive={sort.key === 'modifiedAt'}
        onClick={() => handleSortClick('modifiedAt')}
      >
        <>
          <span className="truncate">Modified</span>
          {sort.key === 'modifiedAt' && <CommanderSortIndicator desc={sort.desc} />}
        </>
      </CommanderHeaderCell>
      <CommanderHeaderCell
        align="right"
        isActive={sort.key === 'size'}
        onClick={() => handleSortClick('size')}
      >
        <>
          <span className="truncate">Size</span>
          {sort.key === 'size' && <CommanderSortIndicator desc={sort.desc} />}
        </>
      </CommanderHeaderCell>
      <span aria-hidden="true" />
    </div>
  );
}

function CommanderSortIndicator({ desc }: { desc: boolean }) {
  return <span className="font-mono text-[10px] text-primary">{desc ? '↓' : '↑'}</span>;
}

function CommanderHeaderCell({
  align = 'left',
  children,
  isActive = false,
  onClick,
}: {
  align?: 'left' | 'right';
  children: ReactNode;
  isActive?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="relative min-w-0 pr-2">
      <button
        className={[
          'flex h-6 w-full min-w-0 items-center gap-1 rounded px-1 text-left text-foreground hover:bg-slate-800/80 hover:text-foreground',
          align === 'right' ? 'justify-end text-right' : 'justify-start',
          isActive ? 'text-primary' : '',
        ].join(' ')}
        type="button"
        onClick={onClick}
      >
        {children}
      </button>
      <span className="absolute right-0 top-0 h-full w-2 border-r border-border/50" aria-hidden="true" />
    </div>
  );
}
