export function getCloseTabShortcutLabel() {
  return isMacPlatform() ? '⌘+W' : 'Ctrl+W';
}

export function isCloseTabShortcut(event: KeyboardEvent) {
  if (event.key.toLowerCase() !== 'w' || event.altKey || event.shiftKey || event.repeat) {
    return false;
  }

  if (isMacPlatform()) {
    return event.metaKey && !event.ctrlKey;
  }

  return event.ctrlKey && !event.metaKey;
}

export function shouldIgnoreWorkspaceShortcut(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;

  if (target?.closest('.xterm')) {
    return false;
  }

  return Boolean(
    target?.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"], .session-input',
    ),
  );
}

function isMacPlatform() {
  return /mac|iphone|ipad|ipod/i.test(navigator.platform);
}
