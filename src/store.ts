export interface Item {
  id: string;
  text: string;
  done: boolean;
  /** Epoch ms when the item was ticked off; drives auto-delete. */
  doneAt: number | null;
  /** 0 = top level, 1 = sub-item (Keep only supports one level). */
  indent: 0 | 1;
}

export interface State {
  title: string;
  items: Item[];
  doneCollapsed: boolean;
}

export const STORAGE_KEY = 'keep-list:v1';
export const TTL_MS = 5 * 60 * 60 * 1000;

export function newId(): string {
  // randomUUID is only available in secure contexts (https / localhost).
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function emptyState(): State {
  return { title: '', items: [], doneCollapsed: false };
}

export function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch (err) {
    console.warn('Could not read saved list', err);
  }
  return emptyState();
}

export function save(state: State): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn('Could not save list', err);
    return false;
  }
}

/** Removes completed items older than TTL_MS. Returns true if anything was removed. */
export function purgeExpired(state: State, now: number): boolean {
  const before = state.items.length;
  state.items = state.items.filter((i) => !(i.done && i.doneAt !== null && now - i.doneAt >= TTL_MS));
  return state.items.length !== before;
}

export function sanitize(data: unknown, now = Date.now()): State {
  const d = (data ?? {}) as Partial<Record<keyof State, unknown>>;
  const items = Array.isArray(d.items) ? d.items : [];
  return {
    title: typeof d.title === 'string' ? d.title : '',
    doneCollapsed: d.doneCollapsed === true,
    items: items
      .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
      .map((i) => {
        const done = i.done === true;
        return {
          id: typeof i.id === 'string' ? i.id : newId(),
          text: typeof i.text === 'string' ? i.text : '',
          done,
          doneAt: done ? (typeof i.doneAt === 'number' ? i.doneAt : now) : null,
          indent: i.indent === 1 ? 1 : 0,
        };
      }),
  };
}
