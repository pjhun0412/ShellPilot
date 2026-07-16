import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

interface SidebarActionMenuItem {
  disabled?: boolean;
  label: string;
  onSelect: () => void;
}

export function SidebarActionMenu({
  ariaLabel,
  disabled,
  icon,
  items,
  title,
}: {
  ariaLabel: string;
  disabled?: boolean;
  icon: ReactNode;
  items: SidebarActionMenuItem[];
  title: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <Button
        className="h-8 w-7 px-0"
        size="icon"
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={title}
      >
        {icon}
      </Button>
      {isOpen && (
        <div className="absolute right-0 top-9 z-20 min-w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
          {items.map((item) => (
            <button
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              disabled={item.disabled}
              key={item.label}
              type="button"
              onClick={() => {
                item.onSelect();
                setIsOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
