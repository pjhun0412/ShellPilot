import { ArrowRight, ChevronDown, ChevronRight, Link2 } from 'lucide-react';
import { useState } from 'react';

import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { cn } from '@/lib/utils';

import type { ResolvedNoteLink } from './notesLinkUtils';
import type { NoteMention, NoteMeta } from './notesTypes';

export interface ResolvedNoteMention extends NoteMention {
  sourceNote?: NoteMeta;
}

export function NotesLinkPanel({
  backlinks,
  outgoingLinks,
  unlinkedMentions,
  onOpenLink,
  onOpenMention,
}: {
  backlinks: ResolvedNoteLink[];
  outgoingLinks: ResolvedNoteLink[];
  unlinkedMentions: ResolvedNoteMention[];
  onOpenLink: (link: ResolvedNoteLink) => void;
  onOpenMention: (mention: ResolvedNoteMention) => void;
}) {
  const totalCount = backlinks.length + outgoingLinks.length + unlinkedMentions.length;
  const [isExpanded, setIsExpanded] = useState(totalCount > 0);

  return (
    <div className="border-t border-border/70 bg-card/35 text-xs">
      <button
        className="flex h-8 w-full items-center gap-2 px-4 text-left text-muted-foreground transition hover:bg-muted/30 hover:text-foreground"
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
      >
        {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Link2 className="size-3.5 text-primary" />
        <span className="font-semibold uppercase tracking-wide">Links</span>
        <span className="rounded border border-border/70 px-1.5 py-0.5 text-[11px]">Backlinks {backlinks.length}</span>
        <span className="rounded border border-border/70 px-1.5 py-0.5 text-[11px]">Outgoing {outgoingLinks.length}</span>
        <span className="rounded border border-border/70 px-1.5 py-0.5 text-[11px]">Mentions {unlinkedMentions.length}</span>
      </button>

      {isExpanded && (
        <div className="grid max-h-44 grid-cols-3 gap-3 overflow-hidden px-4 pb-2">
          <NoteLinkSection
            emptyLabel="No backlinks"
            links={backlinks}
            title="Backlinks"
            onOpenLink={onOpenLink}
          />
          <NoteLinkSection
            emptyLabel="No outgoing links"
            links={outgoingLinks}
            title="Outgoing"
            onOpenLink={onOpenLink}
          />
          <NoteMentionSection
            emptyLabel="No unlinked mentions"
            mentions={unlinkedMentions}
            title="Mentions"
            onOpenMention={onOpenMention}
          />
        </div>
      )}
    </div>
  );
}

function NoteLinkSection({
  emptyLabel,
  links,
  title,
  onOpenLink,
}: {
  emptyLabel: string;
  links: ResolvedNoteLink[];
  title: string;
  onOpenLink: (link: ResolvedNoteLink) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <OverlayScrollArea className="notes-link-scroll space-y-1 pr-1" containerClassName="h-32">
        {links.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 px-2 py-1.5 text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          links.map((link, index) => (
            <button
              className={cn(
                'flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition',
                link.status === 'resolved' &&
                  'border-border/70 bg-background/70 hover:border-primary/50 hover:bg-primary/5',
                link.status === 'ambiguous' && 'cursor-default border-amber-400/30 bg-amber-400/5 text-amber-100',
                link.status === 'unresolved' && 'cursor-default border-border/50 bg-background/40 opacity-70',
              )}
              key={`${link.sourceId}-${link.target}-${link.lineNumber}-${index}`}
              type="button"
              disabled={link.status !== 'resolved'}
              title={createLinkTitle(link)}
              onClick={() => link.status === 'resolved' && onOpenLink(link)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">
                  {link.resolvedNote?.title ?? link.target}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {createLinkSubtitle(link)}
                </span>
              </span>
              {link.status === 'resolved' && <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />}
            </button>
          ))
        )}
      </OverlayScrollArea>
    </section>
  );
}

function createLinkSubtitle(link: ResolvedNoteLink) {
  const location = link.headingLineNumber
    ? ` · heading line ${link.headingLineNumber}`
    : link.lineNumber
      ? ` · line ${link.lineNumber}`
      : '';

  if (link.status === 'ambiguous') {
    return `${link.matchCount} matches. Use folder/note path.${location}`;
  }

  if (link.status === 'unresolved') {
    return `Unresolved link${location}`;
  }

  return `${link.resolvedNote?.path ?? link.target}${link.heading ? `#${link.heading}` : ''}${location}`;
}

function createLinkTitle(link: ResolvedNoteLink) {
  if (link.status === 'ambiguous') {
    return `Ambiguous link "${link.raw}". Use [[folder/note]] to disambiguate.`;
  }

  if (link.status === 'unresolved') {
    return `Unresolved link "${link.raw}"`;
  }

  const lineNumber = link.headingLineNumber ?? link.lineNumber;
  return `${link.resolvedNote?.path ?? link.target}${link.heading ? `#${link.heading}` : ''}${lineNumber ? `:${lineNumber}` : ''}`;
}

function NoteMentionSection({
  emptyLabel,
  mentions,
  title,
  onOpenMention,
}: {
  emptyLabel: string;
  mentions: ResolvedNoteMention[];
  title: string;
  onOpenMention: (mention: ResolvedNoteMention) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <OverlayScrollArea className="notes-link-scroll space-y-1 pr-1" containerClassName="h-32">
        {mentions.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 px-2 py-1.5 text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          mentions.map((mention, index) => (
            <button
              className="flex w-full min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2 py-1.5 text-left transition hover:border-primary/50 hover:bg-primary/5"
              key={`${mention.sourceId}-${mention.targetId}-${mention.lineNumber}-${index}`}
              type="button"
              title={`${mention.sourceNote?.path ?? 'Unknown'}:${mention.lineNumber}`}
              onClick={() => onOpenMention(mention)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">
                  {mention.sourceNote?.title ?? 'Unknown note'}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  line {mention.lineNumber} · {mention.snippet}
                </span>
              </span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))
        )}
      </OverlayScrollArea>
    </section>
  );
}
