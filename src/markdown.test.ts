import { describe, expect, it } from 'vitest';
import { parseMarkdownList, parseTitle, toMarkdown } from './markdown';
import { TTL_MS, purgeExpired, sanitize, type Item } from './store';

describe('parseMarkdownList', () => {
  it('parses bullets, numbers and task checkboxes', () => {
    expect(parseMarkdownList('- Milk\n* Eggs\n1. Bread\n2) Butter\n- [ ] Jam\n- [x] Tea')).toEqual([
      { text: 'Milk', done: false, indent: 0 },
      { text: 'Eggs', done: false, indent: 0 },
      { text: 'Bread', done: false, indent: 0 },
      { text: 'Butter', done: false, indent: 0 },
      { text: 'Jam', done: false, indent: 0 },
      { text: 'Tea', done: true, indent: 0 },
    ]);
  });

  it('turns ChatGPT-style sections into parents with sub-items and ignores prose', () => {
    const md = `Sure! Here's your shopping list:

# Weekly Shopping

### 🥦 Produce
- **Apples** (6)
- Spinach — *fresh*

**Dairy:**
1. Milk
2. \`Greek\` yoghurt

Let me know if you need anything else!`;
    expect(parseMarkdownList(md)).toEqual([
      { text: '🥦 Produce', done: false, indent: 0 },
      { text: 'Apples (6)', done: false, indent: 1 },
      { text: 'Spinach — fresh', done: false, indent: 1 },
      { text: 'Dairy', done: false, indent: 0 },
      { text: 'Milk', done: false, indent: 1 },
      { text: 'Greek yoghurt', done: false, indent: 1 },
    ]);
    expect(parseTitle(md)).toBe('Weekly Shopping');
  });

  it('flattens nested bullets to one level of indent', () => {
    expect(parseMarkdownList('- Trip\n  - Book [hotel](https://x.y)\n    - Pay deposit\n- Pack')).toEqual([
      { text: 'Trip', done: false, indent: 0 },
      { text: 'Book hotel', done: false, indent: 1 },
      { text: 'Pay deposit', done: false, indent: 1 },
      { text: 'Pack', done: false, indent: 0 },
    ]);
  });

  it('keeps snake_case words and falls back to plain lines', () => {
    expect(parseMarkdownList('fix some_var_name\ncall mum\n')).toEqual([
      { text: 'fix some_var_name', done: false, indent: 0 },
      { text: 'call mum', done: false, indent: 0 },
    ]);
  });
});

describe('toMarkdown', () => {
  it('round-trips through the parser', () => {
    const items: Item[] = [
      { id: '1', text: 'Parent', done: false, doneAt: null, indent: 0 },
      { id: '2', text: 'Child', done: false, doneAt: null, indent: 1 },
      { id: '3', text: 'Done', done: true, doneAt: 1, indent: 0 },
    ];
    const md = toMarkdown('List', items.slice(0, 2), items.slice(2));
    expect(md).toBe('# List\n\n- [ ] Parent\n  - [ ] Child\n- [x] Done\n');
    expect(parseMarkdownList(md).map((p) => [p.text, p.done, p.indent])).toEqual([
      ['Parent', false, 0],
      ['Child', false, 1],
      ['Done', true, 0],
    ]);
  });
});

describe('store', () => {
  it('purges ticked items older than 5 hours only', () => {
    const now = 10 * TTL_MS;
    const state = sanitize({
      items: [
        { id: 'a', text: 'old', done: true, doneAt: now - TTL_MS },
        { id: 'b', text: 'recent', done: true, doneAt: now - TTL_MS + 1 },
        { id: 'c', text: 'open', done: false },
      ],
    });
    expect(purgeExpired(state, now)).toBe(true);
    expect(state.items.map((i) => i.id)).toEqual(['b', 'c']);
    expect(purgeExpired(state, now)).toBe(false);
  });

  it('sanitizes bad data', () => {
    const s = sanitize({ title: 3, items: [null, { text: 'x', done: true }] }, 42);
    expect(s.title).toBe('');
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ text: 'x', done: true, doneAt: 42, indent: 0 });
  });
});
