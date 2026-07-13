const SPECIAL_KEYSYMS: Record<string, number> = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Escape: 0xff1b,
  Delete: 0xffff,
  Home: 0xff50,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  PageUp: 0xff55,
  PageDown: 0xff56,
  End: 0xff57,
  Insert: 0xff63,
  F1: 0xffbe,
  F2: 0xffbf,
  F3: 0xffc0,
  F4: 0xffc1,
  F5: 0xffc2,
  F6: 0xffc3,
  F7: 0xffc4,
  F8: 0xffc5,
  F9: 0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,
  CapsLock: 0xffe5,
  NumLock: 0xff7f,
  ScrollLock: 0xff14,
  Pause: 0xff13,
  PrintScreen: 0xff61,
  ContextMenu: 0xff67,
};

export function resolveVncKeysym(event: KeyboardEvent | React.KeyboardEvent): number | undefined {
  const modifierKeysym = resolveModifierKeysym(event);

  if (modifierKeysym != null) {
    return modifierKeysym;
  }

  if (event.key.length === 1) {
    const codePoint = event.key.codePointAt(0);

    if (codePoint === undefined) {
      return undefined;
    }

    // X11 keysyms for Unicode code points beyond Latin-1 are the code point
    // with bit 24 set, not the raw code point value.
    return codePoint > 0xff ? 0x01000000 | codePoint : codePoint;
  }

  return SPECIAL_KEYSYMS[event.key];
}

function resolveModifierKeysym(event: KeyboardEvent | React.KeyboardEvent) {
  const isRight = event.location === 2;

  if (event.key === 'Shift') {
    return isRight ? 0xffe2 : 0xffe1;
  }

  if (event.key === 'Control') {
    return isRight ? 0xffe4 : 0xffe3;
  }

  if (event.key === 'Alt') {
    return isRight ? 0xffea : 0xffe9;
  }

  if (event.key === 'Meta' || event.key === 'OS') {
    return isRight ? 0xffe8 : 0xffe7;
  }

  return undefined;
}
