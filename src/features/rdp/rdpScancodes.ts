export interface ScanCode {
  code: number;
  extended: boolean;
}

// PS/2 Set 1 "make" scancodes for the keys we expect an RDP session to need.
// Values with `extended: true` require the 0xE0 prefix on real PS/2 hardware,
// which IronRDP's fast-path keyboard event represents as a flag bit instead.
const SCAN_CODES: Record<string, ScanCode> = {
  Backquote: { code: 0x29, extended: false },
  Minus: { code: 0x0c, extended: false },
  Equal: { code: 0x0d, extended: false },
  Backspace: { code: 0x0e, extended: false },
  Tab: { code: 0x0f, extended: false },
  BracketLeft: { code: 0x1a, extended: false },
  BracketRight: { code: 0x1b, extended: false },
  Backslash: { code: 0x2b, extended: false },
  CapsLock: { code: 0x3a, extended: false },
  Semicolon: { code: 0x27, extended: false },
  Quote: { code: 0x28, extended: false },
  Enter: { code: 0x1c, extended: false },
  ShiftLeft: { code: 0x2a, extended: false },
  Comma: { code: 0x33, extended: false },
  Period: { code: 0x34, extended: false },
  Slash: { code: 0x35, extended: false },
  ShiftRight: { code: 0x36, extended: false },
  ControlLeft: { code: 0x1d, extended: false },
  AltLeft: { code: 0x38, extended: false },
  Space: { code: 0x39, extended: false },
  AltRight: { code: 0x38, extended: true },
  ControlRight: { code: 0x1d, extended: true },
  MetaLeft: { code: 0x5b, extended: true },
  MetaRight: { code: 0x5c, extended: true },
  Escape: { code: 0x01, extended: false },
  NumLock: { code: 0x45, extended: true },
  Insert: { code: 0x52, extended: true },
  Delete: { code: 0x53, extended: true },
  Home: { code: 0x47, extended: true },
  End: { code: 0x4f, extended: true },
  PageUp: { code: 0x49, extended: true },
  PageDown: { code: 0x51, extended: true },
  ArrowUp: { code: 0x48, extended: true },
  ArrowLeft: { code: 0x4b, extended: true },
  ArrowRight: { code: 0x4d, extended: true },
  ArrowDown: { code: 0x50, extended: true },
  F1: { code: 0x3b, extended: false },
  F2: { code: 0x3c, extended: false },
  F3: { code: 0x3d, extended: false },
  F4: { code: 0x3e, extended: false },
  F5: { code: 0x3f, extended: false },
  F6: { code: 0x40, extended: false },
  F7: { code: 0x41, extended: false },
  F8: { code: 0x42, extended: false },
  F9: { code: 0x43, extended: false },
  F10: { code: 0x44, extended: false },
  F11: { code: 0x57, extended: false },
  F12: { code: 0x58, extended: false },
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LETTER_CODES = [0x1e, 0x30, 0x2e, 0x20, 0x12, 0x21, 0x22, 0x23, 0x17, 0x24, 0x25, 0x26, 0x32, 0x31, 0x18, 0x19, 0x10, 0x13, 0x1f, 0x14, 0x16, 0x2f, 0x11, 0x2d, 0x15, 0x2c];

LETTERS.split('').forEach((letter, index) => {
  SCAN_CODES[`Key${letter}`] = { code: LETTER_CODES[index], extended: false };
});

const DIGIT_CODES = [0x0b, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a];

for (let digit = 0; digit <= 9; digit += 1) {
  SCAN_CODES[`Digit${digit}`] = { code: DIGIT_CODES[digit], extended: false };
}

export function resolveScanCode(jsCode: string): ScanCode | undefined {
  return SCAN_CODES[jsCode];
}
