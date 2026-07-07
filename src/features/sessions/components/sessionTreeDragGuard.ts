export function enableSessionDragGuard() {
  document.body.classList.add('shellpilot-session-dragging');
  window.addEventListener('pointerup', disableSessionDragGuard, { once: true });
  window.addEventListener('pointercancel', disableSessionDragGuard, { once: true });
}

export function disableSessionDragGuard() {
  document.body.classList.remove('shellpilot-session-dragging');
}
