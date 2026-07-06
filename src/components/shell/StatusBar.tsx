import { Save } from 'lucide-react';

export function StatusBar({
  onSaveLayout,
  savedLayoutAt,
}: {
  onSaveLayout: () => void;
  savedLayoutAt: string | null;
}) {
  return (
    <footer className="flex h-7 items-center justify-between border-t bg-primary/15 px-3 text-[0.7rem] text-muted-foreground">
      <span>Ready</span>
      <div className="flex items-center gap-3">
        <span>{savedLayoutAt ? `Layout saved at ${savedLayoutAt}` : 'Layout changes are local'}</span>
        <button
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground hover:bg-primary/20"
          type="button"
          onClick={onSaveLayout}
        >
          <Save className="size-3" />
          Save
        </button>
      </div>
    </footer>
  );
}
