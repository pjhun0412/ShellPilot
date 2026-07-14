import type { IDecoration, Terminal } from '@xterm/xterm';

import { loadPreferences, type DiagnosticHighlightRule } from '@/features/settings/appPreferences';

interface DiagnosticRule {
  backgroundColor?: string;
  foregroundColor?: string;
  id: string;
  pattern: RegExp;
  underline: boolean;
}

const WRITE_SCAN_THROTTLE_MS = 80;

export function attachTerminalDiagnosticsHighlighter(terminal: Terminal) {
  const preferences = loadPreferences().terminal;

  if (!preferences.diagnosticsHighlight) {
    return { dispose() {} };
  }

  const diagnosticRules = compileDiagnosticRules(preferences.diagnosticRules);

  if (diagnosticRules.length === 0) {
    return { dispose() {} };
  }

  const decorations = new Set<IDecoration>();
  let lastVisibleSignature = '';
  let scanFrame: number | undefined;
  let scanTimer: number | undefined;
  let lastScanAt = 0;

  const clearDecorations = () => {
    for (const decoration of Array.from(decorations)) {
      decoration.dispose();
    }

    decorations.clear();
  };

  const scanVisibleRows = () => {
    const buffer = terminal.buffer.active;

    if (buffer.type !== 'normal') {
      clearDecorations();
      lastVisibleSignature = '';
      return;
    }

    const startRow = Math.max(buffer.viewportY, 0);
    const endRow = Math.min(buffer.viewportY + terminal.rows, buffer.length);
    const visibleSignature = createVisibleSignature(terminal, startRow, endRow);

    if (visibleSignature === lastVisibleSignature) {
      return;
    }

    lastVisibleSignature = visibleSignature;
    clearDecorations();

    const cursorAbsoluteRow = buffer.baseY + buffer.cursorY;

    for (let row = startRow; row < endRow; row += 1) {
      const line = buffer.getLine(row);

      if (!line) {
        continue;
      }

      const text = line.translateToString(true);

      if (!text) {
        continue;
      }

      const columnMap = buildColumnMap(line);

      for (const rule of diagnosticRules) {
        rule.pattern.lastIndex = 0;

        for (const match of text.matchAll(rule.pattern)) {
          const matchText = match[0];
          const stringIndex = match.index ?? -1;

          if (stringIndex < 0 || !matchText) {
            continue;
          }

          const range = stringRangeToCellRange(columnMap, stringIndex, stringIndex + matchText.length);

          if (!range) {
            continue;
          }

          const marker = terminal.registerMarker(row - cursorAbsoluteRow);

          if (!marker) {
            continue;
          }

          const decoration = terminal.registerDecoration({
            backgroundColor: rule.backgroundColor,
            foregroundColor: rule.foregroundColor,
            height: 1,
            layer: 'top',
            marker,
            width: range.width,
            x: range.x,
          });

          if (!decoration) {
            marker.dispose();
            continue;
          }

          decorations.add(decoration);
          if (rule.underline) {
            decoration.onRender((element) => {
              element.style.borderBottom = `1px solid ${rule.foregroundColor ?? '#e2e8f0'}`;
              element.style.boxSizing = 'border-box';
            });
          }
          decoration.onDispose(() => {
            decorations.delete(decoration);
          });
        }
      }
    }
  };

  const runScheduledScan = () => {
    scanFrame = undefined;
    lastScanAt = performance.now();
    scanVisibleRows();
  };

  const requestScanFrame = () => {
    if (scanFrame !== undefined) {
      return;
    }

    scanFrame = window.requestAnimationFrame(runScheduledScan);
  };

  const scheduleScan = ({ throttle = true }: { throttle?: boolean } = {}) => {
    if (scanFrame !== undefined || scanTimer !== undefined) {
      return;
    }

    if (!throttle) {
      requestScanFrame();
      return;
    }

    const elapsed = performance.now() - lastScanAt;
    const delay = Math.max(WRITE_SCAN_THROTTLE_MS - elapsed, 0);

    if (delay === 0) {
      requestScanFrame();
      return;
    }

    scanTimer = window.setTimeout(() => {
      scanTimer = undefined;
      requestScanFrame();
    }, delay);
  };

  const parsedDisposable = terminal.onWriteParsed(() => scheduleScan());
  const renderDisposable = terminal.onRender(() => scheduleScan());
  const scrollDisposable = terminal.onScroll(() => scheduleScan({ throttle: false }));
  const resizeDisposable = terminal.onResize(() => {
    clearDecorations();
    lastVisibleSignature = '';
    scheduleScan({ throttle: false });
  });

  scheduleScan({ throttle: false });

  return {
    dispose() {
      if (scanFrame !== undefined) {
        window.cancelAnimationFrame(scanFrame);
      }

      if (scanTimer !== undefined) {
        window.clearTimeout(scanTimer);
      }

      parsedDisposable.dispose();
      renderDisposable.dispose();
      scrollDisposable.dispose();
      resizeDisposable.dispose();
      clearDecorations();
    },
  };
}

function createVisibleSignature(terminal: Terminal, startRow: number, endRow: number) {
  const buffer = terminal.buffer.active;
  const rows: string[] = [`${buffer.viewportY}:${terminal.cols}:${terminal.rows}`];

  for (let row = startRow; row < endRow; row += 1) {
    rows.push(buffer.getLine(row)?.translateToString(true) ?? '');
  }

  return rows.join('\n');
}

function compileDiagnosticRules(rules: DiagnosticHighlightRule[]): DiagnosticRule[] {
  return rules.flatMap((rule) => {
    if (!rule.enabled) {
      return [];
    }

    try {
      return [
        {
          backgroundColor: rule.style.background ? rule.backgroundColor : undefined,
          foregroundColor: rule.style.foreground ? rule.foregroundColor : undefined,
          id: rule.id,
          pattern: new RegExp(rule.pattern, 'gi'),
          underline: rule.style.underline,
        },
      ];
    } catch {
      return [];
    }
  });
}

interface ColumnMapEntry {
  column: number;
  stringEnd: number;
  stringStart: number;
  width: number;
}

function buildColumnMap(line: NonNullable<ReturnType<Terminal['buffer']['active']['getLine']>>) {
  const map: ColumnMapEntry[] = [];
  let stringIndex = 0;

  for (let column = 0; column < line.length; column += 1) {
    const cell = line.getCell(column);
    const chars = cell?.getChars() ?? '';

    if (!chars) {
      continue;
    }

    const width = Math.max(cell?.getWidth() ?? 1, 1);

    map.push({
      column,
      stringEnd: stringIndex + chars.length,
      stringStart: stringIndex,
      width,
    });
    stringIndex += chars.length;
  }

  return map;
}

function stringRangeToCellRange(map: ColumnMapEntry[], stringStart: number, stringEnd: number) {
  const first = map.find((entry) => stringStart >= entry.stringStart && stringStart < entry.stringEnd);
  const last = [...map]
    .reverse()
    .find((entry) => stringEnd - 1 >= entry.stringStart && stringEnd - 1 < entry.stringEnd);

  if (!first || !last) {
    return undefined;
  }

  return {
    width: Math.max(last.column + last.width - first.column, 1),
    x: first.column,
  };
}
