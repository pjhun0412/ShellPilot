export function TitleBar() {
  return (
    <header className="flex h-10 items-center justify-between border-b bg-card/90 px-3 text-sm">
      <div className="flex items-center gap-2">
        <div className="grid size-6 place-items-center rounded border border-primary/40 bg-primary/10 text-[0.65rem] font-black text-primary">
          SP
        </div>
        <strong>ShellPilot</strong>
      </div>
      <div className="text-xs text-muted-foreground">Remote Workspace Preview</div>
    </header>
  );
}
