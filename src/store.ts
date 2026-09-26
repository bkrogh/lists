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
