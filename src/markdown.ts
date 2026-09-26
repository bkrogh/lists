import type { Item } from './store';

export interface ParsedItem {
  text: string;
  done: boolean;
  indent: 0 | 1;
}

const BULLET = /^(\s*)(?:[-*+•]|\d+[.)])\s+(?:\[([ xX])\]\s*)?(.*)$/;
const HEADING = /^\s*#{2,6}\s+(.*?)\s*#*\s*$/;
const H1 = /^\s*#\s+(.*?)\s*#*\s*$/;
const BOLD_LINE = /^\s*(\*\*|__)(.+?)\1\s*:?\s*$/;

/** Strips inline Markdown (bold, italics, code, links, strikethrough). */
export function cleanInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/:$/, '')
    .trim();
}

/**
 * Parses a Markdown list (as typically produced by ChatGPT) into flat items.
 * - Bullets, numbered items and task checkboxes become items; `[x]` items come in as done.
 * - `# Title` lines are skipped (see parseTitle); lower headings and bold-only lines ("**Produce:**") become parent items; bullets under them are indented.
 * - Nested bullets become sub-items. Prose lines are ignored.
 * - Text without any list syntax falls back to one item per line.
 */
export function parseMarkdownList(md: string): ParsedItem[] {
  const lines = md.replace(/\t/g, '    ').split(/\r?\n/);
  const out: (ParsedItem & { heading?: boolean })[] = [];
  let underHeading = false;
  let baseIndent: number | null = null;

  for (const line of lines) {
    if (!line.trim() || H1.test(line)) continue;

    const bullet = BULLET.exec(line);
    if (bullet) {
      const ws = bullet[1].length;
      if (baseIndent === null || ws < baseIndent) baseIndent = ws;
      const text = cleanInline(bullet[3]);
      if (!text) continue;
      const nested = ws > baseIndent;
      out.push({ text, done: bullet[2]?.toLowerCase() === 'x', indent: underHeading || nested ? 1 : 0 });
      continue;
    }

    const heading = HEADING.exec(line)?.[1] ?? BOLD_LINE.exec(line)?.[2];
    if (heading !== undefined) {
      const text = cleanInline(heading);
      if (!text) continue;
      out.push({ text, done: false, indent: 0, heading: true });
      underHeading = true;
      baseIndent = null;
    }
  }

  if (out.length === 0) {
    return lines
      .filter((line) => !H1.test(line))
      .map(cleanInline)
      .filter(Boolean)
      .map((text) => ({ text, done: false, indent: 0 }));
  }

  // Drop headings with nothing under them (e.g. a document title directly followed by a section heading).
  return out
    .filter((item, i) => !item.heading || out[i + 1]?.indent === 1)
    .map(({ text, done, indent }) => ({ text, done, indent }));
}

/** The first `# Title` in the text, if any. */
export function parseTitle(md: string): string {
  for (const line of md.split(/\r?\n/)) {
    const m = H1.exec(line);
    if (m) return cleanInline(m[1]);
  }
  return '';
}

/** Exports items in list order, so ticked sub-items stay under their parent. */
export function toMarkdown(title: string, items: Item[]): string {
  const line = (i: Item) => `${i.indent ? '  ' : ''}- [${i.done ? 'x' : ' '}] ${i.text}`;
  const parts = [];
  if (title.trim()) parts.push(`# ${title.trim()}`, '');
  parts.push(...items.map(line));
  return parts.join('\n') + '\n';
}
