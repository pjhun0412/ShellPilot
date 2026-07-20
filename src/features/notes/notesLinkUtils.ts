import type { NoteHeading, NoteLink, NoteMeta } from './notesTypes';

const wikiLinkPreviewPrefix = '#shellpilot-note=';

export interface ResolvedNoteLink extends NoteLink {
  headingLineNumber?: number;
  matchCount: number;
  resolvedNote?: NoteMeta;
  status: 'ambiguous' | 'resolved' | 'unresolved';
}

export function createWikiLinkPreviewSource(content: string) {
  return content.replace(/\[\[([^\]\n]+)\]\]/g, (_match, raw: string) => {
    const parsed = parseWikiLink(raw);

    if (!parsed) {
      return _match;
    }

    const href = parsed.heading ? `${parsed.target}#${parsed.heading}` : parsed.target;

    return `[${parsed.label}](${wikiLinkPreviewPrefix}${encodeURIComponent(href)})`;
  });
}

export function parseWikiLink(raw: string) {
  const trimmed = raw.trim();

  if (!trimmed) {
    return undefined;
  }

  const [targetPart, aliasPart] = trimmed.split('|');
  const { heading, target } = splitNoteLinkTarget(targetPart);

  if (!target) {
    return undefined;
  }

  return {
    heading,
    label: aliasPart?.trim() || targetPart.trim(),
    target,
  };
}

export function readWikiLinkPreviewTarget(url: string) {
  if (!url.startsWith(wikiLinkPreviewPrefix)) {
    return undefined;
  }

  return decodeURIComponent(url.slice(wikiLinkPreviewPrefix.length));
}

export function resolveNoteLinkTarget(target: string, notes: NoteMeta[]) {
  return resolveNoteLinkTargetState(target, notes).note;
}

export function resolveNoteLinkTargetState(target: string, notes: NoteMeta[]) {
  const normalizedTarget = normalizeNoteLinkTarget(target).toLowerCase();
  const pathMatches = notes.filter((note) => note.path.toLowerCase() === normalizedTarget);

  if (pathMatches.length === 1) {
    return {
      matchCount: 1,
      note: pathMatches[0],
      status: 'resolved' as const,
    };
  }

  if (pathMatches.length > 1) {
    return {
      matchCount: pathMatches.length,
      note: undefined,
      status: 'ambiguous' as const,
    };
  }

  const titleMatches = notes.filter((note) => note.title.toLowerCase() === normalizedTarget);

  if (titleMatches.length === 1) {
    return {
      matchCount: 1,
      note: titleMatches[0],
      status: 'resolved' as const,
    };
  }

  if (titleMatches.length > 1) {
    return {
      matchCount: titleMatches.length,
      note: undefined,
      status: 'ambiguous' as const,
    };
  }

  return {
    matchCount: 0,
    note: undefined,
    status: 'unresolved' as const,
  };
}

export function resolveNoteLinks(links: NoteLink[], notes: NoteMeta[], headings: NoteHeading[] = []) {
  return links.map((link) => {
    const resolved = resolveNoteLinkTargetState(link.target, notes);
    const headingLineNumber =
      resolved.note && link.heading ? findHeadingLineNumber(resolved.note.id, link.heading, headings) : undefined;

    return {
      ...link,
      headingLineNumber,
      matchCount: resolved.matchCount,
      resolvedNote: resolved.note,
      status: resolved.status,
    };
  });
}

export function normalizeNoteLinkTarget(target: string) {
  return splitNoteLinkTarget(target).target;
}

export function splitNoteLinkTarget(target: string) {
  const targetPart = target.split('|')[0];
  const [pathPart, headingPart] = targetPart.split('#');

  return {
    heading: headingPart?.trim() || undefined,
    target: pathPart
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/'),
  };
}

export function normalizeHeadingSlug(heading: string) {
  return heading
    .trim()
    .toLowerCase()
    .split('')
    .map((character) => (/[\p{Letter}\p{Number}_-]/u.test(character) ? character : '-'))
    .join('')
    .split('-')
    .filter(Boolean)
    .join('-');
}

export function findHeadingLineNumber(noteId: string, heading: string, headings: NoteHeading[]) {
  const normalizedHeading = heading.trim().toLowerCase();
  const slug = normalizeHeadingSlug(heading);
  const match = headings.find(
    (entry) =>
      entry.sourceId === noteId &&
      (entry.title.trim().toLowerCase() === normalizedHeading || entry.slug === slug),
  );

  return match?.lineNumber;
}
