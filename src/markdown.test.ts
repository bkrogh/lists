// Minimal localStorage stand-in for the Node test environment.
const mem = new Map<string, string>();
globalThis.localStorage ??= { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 } as Storage;

import { describe, expect, it } from 'vitest';
import { parseMarkdownList, parseTitle, toMarkdown } from './markdown';
import { expireTicked, load, sanitize, type Item } from './store';

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
  it('deletes ticked items older than 5 hours by default, across all lists', () => {
    const TTL_MS = 5 * 60 * 60 * 1000;
    const now = 10 * TTL_MS;
    const state = sanitize({
      lists: [
        {
          items: [
            { id: 'a', text: 'old', done: true, doneAt: now - TTL_MS },
            { id: 'b', text: 'recent', done: true, doneAt: now - TTL_MS + 1 },
            { id: 'c', text: 'open', done: false },
          ],
        },
        { items: [{ id: 'd', text: 'old too', done: true, doneAt: 0 }] },
      ],
    });
    expect(expireTicked(state, now)).toBe(true);
    expect(state.lists.map((l) => l.items.map((i) => i.id))).toEqual([['b', 'c'], []]);
    expect(expireTicked(state, now)).toBe(false);
  });

  it('unticks or deletes per list after each list\'s own expiry time', () => {
    const H = 60 * 60 * 1000;
    const now = 100 * H;
    const state = sanitize({
      lists: [
        {
          id: 'reset',
          expireMode: 'reset',
          expireHours: 1,
          items: [
            { id: 'a', text: 'expired', done: true, doneAt: now - H },
            { id: 'b', text: 'open', done: false },
            { id: 'c', text: 'recent', done: true, doneAt: now - H + 1 },
          ],
        },
        { id: 'del', expireHours: 0.5, items: [{ id: 'd', text: 'gone', done: true, doneAt: now - H / 2 }] },
      ],
    });
    expect(expireTicked(state, now)).toBe(true);
    const [reset, del] = state.lists;
    expect(reset.items.map((i) => [i.id, i.done, i.doneAt])).toEqual([
      ['a', false, null],
      ['b', false, null],
      ['c', true, now - H + 1],
    ]);
    expect(del.items).toEqual([]);
    expect(expireTicked(state, now)).toBe(false);
  });

  it('defaults bad expiry settings to delete after 5 hours', () => {
    const [l] = sanitize({ lists: [{ expireMode: 'nope', expireHours: -2 }] }).lists;
    expect(l).toMatchObject({ expireMode: 'delete', expireHours: 5 });
  });

  it('sanitizes bad data and always has a current list', () => {
    const empty = sanitize(null);
    expect(empty.lists).toHaveLength(1);
    expect(empty.currentId).toBe(empty.lists[0].id);

    const s = sanitize({ currentId: 'nope', lists: [{ id: 'L', title: 3, items: [null, { text: 'x', done: true }] }] }, 42);
    expect(s.currentId).toBe('L');
    expect(s.lists[0].title).toBe('');
    expect(s.lists[0].items).toHaveLength(1);
    expect(s.lists[0].items[0]).toMatchObject({ text: 'x', done: true, doneAt: 42, indent: 0 });
  });

  it('migrates the old single-list format', () => {
    localStorage.setItem('keep-list:v1', JSON.stringify({ title: 'Old', doneCollapsed: true, items: [{ id: 'i', text: 'Milk', done: false }] }));
    const s = load();
    expect(s.lists).toHaveLength(1);
    expect(s.lists[0]).toMatchObject({ title: 'Old', doneCollapsed: true, items: [{ id: 'i', text: 'Milk' }] });
    expect(s.currentId).toBe(s.lists[0].id);
  });
});
