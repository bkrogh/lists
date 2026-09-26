export interface Item {
  id: string;
  text: string;
  done: boolean;
  /** Epoch ms when the item was ticked off; drives auto-delete. */
  doneAt: number | null;
  /** 0 = top level, 1 = sub-item (Keep only supports one level). */
  indent: 0 | 1;
}

/** What happens to a ticked item once the list's expiry time has passed. */
export type ExpireMode = 'delete' | 'reset';

export interface List {
  id: string;
  title: string;
  items: Item[];
  doneCollapsed: boolean;
  expireMode: ExpireMode;
  /** Hours after ticking before expireMode kicks in. */
  expireHours: number;
}

export interface State {
  lists: List[];
  currentId: string;
}

export const STORAGE_KEY = 'keep-lists:v2';
/** Single-list format from before multiple lists; migrated on first load and left in place as a backup. */
const LEGACY_KEY = 'keep-list:v1';
export const DEFAULT_EXPIRE_HOURS = 5;
const HOUR_MS = 60 * 60 * 1000;

export const ttlMs = (list: List) => list.expireHours * HOUR_MS;

export function newId(): string {
  // randomUUID is only available in secure contexts (https / localhost).
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function newList(title = ''): List {
  return { id: newId(), title, items: [], doneCollapsed: false, expireMode: 'delete', expireHours: DEFAULT_EXPIRE_HOURS };
}

export function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitize(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return sanitize({ lists: [JSON.parse(legacy)] });
  } catch (err) {
    console.warn('Could not read saved lists', err);
  }
  return sanitize({});
}

export function save(state: State): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn('Could not save lists', err);
    return false;
  }
}

/**
 * Deletes or unticks (per each list's expireMode) ticked items older than the list's expiry time.
 * Unticked items reappear where they were in the list. Returns true if anything changed.
 */
export function expireTicked(state: State, now: number): boolean {
  let changed = false;
  for (const list of state.lists) {
    const ttl = ttlMs(list);
    const expired = (i: Item) => i.done && i.doneAt !== null && now - i.doneAt >= ttl;
    if (!list.items.some(expired)) continue;
    changed = true;
    if (list.expireMode === 'delete') {
      list.items = list.items.filter((i) => !expired(i));
    } else {
      for (const i of list.items.filter(expired)) Object.assign(i, { done: false, doneAt: null });
    }
  }
  return changed;
}

type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => typeof v === 'object' && v !== null;

function sanitizeItem(i: Loose, now: number): Item {
  const done = i.done === true;
  return {
    id: typeof i.id === 'string' ? i.id : newId(),
    text: typeof i.text === 'string' ? i.text : '',
    done,
    doneAt: done ? (typeof i.doneAt === 'number' ? i.doneAt : now) : null,
    indent: i.indent === 1 ? 1 : 0,
  };
}

function sanitizeList(l: Loose, now: number): List {
  return {
    id: typeof l.id === 'string' ? l.id : newId(),
    title: typeof l.title === 'string' ? l.title : '',
    doneCollapsed: l.doneCollapsed === true,
    expireMode: l.expireMode === 'reset' ? 'reset' : 'delete',
    expireHours: typeof l.expireHours === 'number' && l.expireHours > 0 ? l.expireHours : DEFAULT_EXPIRE_HOURS,
    items: (Array.isArray(l.items) ? l.items : []).filter(isObject).map((i) => sanitizeItem(i, now)),
  };
}

/** Always returns at least one list, with currentId pointing at an existing list. */
export function sanitize(data: unknown, now = Date.now()): State {
  const d = isObject(data) ? data : {};
  const lists = (Array.isArray(d.lists) ? d.lists : []).filter(isObject).map((l) => sanitizeList(l, now));
  if (lists.length === 0) lists.push(newList());
  const currentId = lists.some((l) => l.id === d.currentId) ? (d.currentId as string) : lists[0].id;
  return { lists, currentId };
}

// ---------- tree ----------
// A list's items array is the tree: an indented item belongs to the nearest top-level item above it.
// Ticked items stay where they are in the array, so unticking puts them back under their parent.

function parentIndex(items: Item[], idx: number): number {
  if (items[idx].indent === 0) return -1;
  for (let j = idx - 1; j >= 0; j--) if (items[j].indent === 0) return j;
  return -1;
}

function childIndexes(items: Item[], idx: number): number[] {
  const out = [];
  if (items[idx].indent === 0) for (let j = idx + 1; j < items.length && items[j].indent === 1; j++) out.push(j);
  return out;
}

/**
 * Ticks or unticks an item. Ticking a parent ticks its open sub-items; unticking a parent unticks its sub-items,
 * and unticking a sub-item unticks its parent so it has somewhere to go.
 */
export function setDone(list: List, item: Item, done: boolean, now: number) {
  const items = list.items;
  const idx = items.indexOf(item);
  if (idx < 0) return;
  const set = (i: Item) => {
    if (i.done === done) return;
    i.done = done;
    i.doneAt = done ? now : null;
  };
  set(item);
  for (const j of childIndexes(items, idx)) set(items[j]);
  if (!done) {
    const p = parentIndex(items, idx);
    if (p >= 0) set(items[p]);
  }
}

/**
 * The ticked items as shown in the ticked section: each ticked parent followed by its ticked sub-items, most recently
 * ticked group first. Ticked sub-items whose parent is still open are shown on their own, unindented.
 */
export function tickedView(list: List): { item: Item; indent: 0 | 1 }[] {
  const groups: { item: Item; indent: 0 | 1 }[][] = [];
  const items = list.items;
  items.forEach((item, idx) => {
    if (!item.done) return;
    const p = parentIndex(items, idx);
    if (p >= 0 && items[p].done) return; // listed with its parent
    groups.push([{ item, indent: 0 }, ...childIndexes(items, idx).filter((j) => items[j].done).map((j) => ({ item: items[j], indent: 1 as const }))]);
  });
  const latest = (g: { item: Item }[]) => Math.max(...g.map((e) => e.item.doneAt ?? 0));
  return groups.sort((a, b) => latest(b) - latest(a)).flat();
}
