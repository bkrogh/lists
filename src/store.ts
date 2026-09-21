export interface Item {
  id: string;
  text: string;
  done: boolean;
  /** Epoch ms when the item was ticked off; drives auto-delete. */
  doneAt: number | null;
  /** 0 = top level, 1 = sub-item (Keep only supports one level). */
  indent: 0 | 1;
}

export interface List {
  id: string;
  title: string;
  items: Item[];
  doneCollapsed: boolean;
}

export interface State {
  lists: List[];
  currentId: string;
}

export const STORAGE_KEY = 'keep-lists:v2';
/** Single-list format from before multiple lists; migrated on first load and left in place as a backup. */
const LEGACY_KEY = 'keep-list:v1';
export const TTL_MS = 5 * 60 * 60 * 1000;

export function newId(): string {
  // randomUUID is only available in secure contexts (https / localhost).
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function newList(title = ''): List {
  return { id: newId(), title, items: [], doneCollapsed: false };
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

/** Removes completed items older than TTL_MS from every list. Returns true if anything was removed. */
export function purgeExpired(state: State, now: number): boolean {
  let changed = false;
  for (const list of state.lists) {
    const before = list.items.length;
    list.items = list.items.filter((i) => !(i.done && i.doneAt !== null && now - i.doneAt >= TTL_MS));
    changed ||= list.items.length !== before;
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
