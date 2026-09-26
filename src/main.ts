import Sortable from 'sortablejs';
import './style.css';
import { parseMarkdownList, parseTitle, toMarkdown, type ParsedItem } from './markdown';
import { STORAGE_KEY, expireTicked, load, newId, newList, save, ttlMs, type ExpireMode, type Item, type List, type State } from './store';

let state: State = load();
if (expireTicked(state, Date.now())) save(state);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const titleEl = $<HTMLInputElement>('title');
const activeEl = $<HTMLUListElement>('active');
const doneEl = $<HTMLUListElement>('done');
const addInput = $<HTMLInputElement>('add-input');
const emptyHint = $<HTMLParagraphElement>('empty-hint');
const doneSection = $<HTMLElement>('done-section');
const doneToggle = $<HTMLButtonElement>('done-toggle');
const doneCount = $<HTMLSpanElement>('done-count');
const importDialog = $<HTMLDialogElement>('import-dialog');
const importText = $<HTMLTextAreaElement>('import-text');
const importCount = $<HTMLSpanElement>('import-count');
const importConfirm = $<HTMLButtonElement>('import-confirm');
const toastEl = $<HTMLDivElement>('toast');
const toastMsg = $<HTMLSpanElement>('toast-msg');
const toastUndo = $<HTMLButtonElement>('toast-undo');
const importAsNew = $<HTMLInputElement>('import-as-new');
const menuBtn = $<HTMLButtonElement>('menu-btn');
const drawer = $<HTMLElement>('drawer');
const drawerBackdrop = $<HTMLDivElement>('drawer-backdrop');
const listsEl = $<HTMLUListElement>('lists');
const expiryBtn = $<HTMLButtonElement>('expiry-btn');
const expiryNote = $<HTMLSpanElement>('expiry-note');
const expiryDialog = $<HTMLDialogElement>('expiry-dialog');
const expireHours = $<HTMLInputElement>('expire-hours');

const GRIP =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
const AUTOSIZE_IN_CSS = CSS.supports('field-sizing', 'content');

/** Set while the lists are rebuilt, so focusout from removed textareas is ignored. */
let rendering = false;

// ---------- state helpers ----------

const current = (): List => state.lists.find((l) => l.id === state.currentId) ?? state.lists[0];
const active = () => current().items.filter((i) => !i.done);
const completed = () => current().items.filter((i) => i.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
const find = (id: string | undefined) => current().items.find((i) => i.id === id);
const idOf = (el: EventTarget | null) => (el as HTMLElement | null)?.closest<HTMLElement>('.item')?.dataset.id;

let saveFailed = false;
function commit() {
  const first = active()[0];
  if (first) first.indent = 0;
  const ok = save(state);
  if (!ok && !saveFailed) toast('Could not save — browser storage is full or blocked');
  saveFailed = !ok;
}

function remove(item: Item) {
  current().items = current().items.filter((i) => i !== item);
}

function toggle(id: string, done: boolean) {
  const item = find(id);
  if (!item) return;
  if (done) {
    const now = Date.now();
    const act = active();
    item.done = true;
    item.doneAt = now;
    // Ticking a parent ticks its sub-items too.
    if (item.indent === 0) {
      for (let j = act.indexOf(item) + 1; j < act.length && act[j].indent === 1; j++) {
        act[j].done = true;
        act[j].doneAt = now;
      }
    }
  } else {
    item.done = false;
    item.doneAt = null;
    item.indent = 0;
    remove(item);
    current().items.push(item);
  }
  commit();
  render();
}

function move(item: Item, dir: -1 | 1) {
  const act = active();
  const other = act[act.indexOf(item) + dir];
  if (!other) return;
  const items = current().items;
  const a = items.indexOf(item);
  const b = items.indexOf(other);
  [items[a], items[b]] = [other, item];
  commit();
}

function insertParsed(parsed: ParsedItem[], afterId: string | null, title = '', takeSnapshot = true) {
  if (!parsed.length) return;
  if (takeSnapshot) snapshot();
  if (title && !current().title.trim()) current().title = title;
  const now = Date.now();
  const items: Item[] = parsed.map((p) => ({ id: newId(), text: p.text, done: p.done, doneAt: p.done ? now : null, indent: p.indent }));
  const list = current();
  const at = afterId ? list.items.findIndex((i) => i.id === afterId) + 1 : list.items.length;
  list.items.splice(at, 0, ...items);
  commit();
  render();
  toast(`Added ${items.length} item${items.length === 1 ? '' : 's'}`, true);
}

// ---------- lists ----------

const listName = (l: List) => l.title.trim() || 'Untitled list';

function switchTo(id: string) {
  if (!state.lists.some((l) => l.id === id)) return;
  state.currentId = id;
  commit();
  render();
}

function createList(title = ''): List {
  const list = newList(title);
  state.lists.push(list);
  state.currentId = list.id;
  commit();
  render();
  return list;
}

function deleteList(id: string) {
  const idx = state.lists.findIndex((l) => l.id === id);
  if (idx < 0) return;
  snapshot();
  const [gone] = state.lists.splice(idx, 1);
  if (state.lists.length === 0) state.lists.push(newList());
  if (state.currentId === id) state.currentId = state.lists[Math.min(idx, state.lists.length - 1)].id;
  commit();
  render();
  toast(`Deleted “${listName(gone)}”`, true);
}

function openDrawer() {
  drawer.classList.add('open');
  drawerBackdrop.classList.add('open');
  drawer.inert = false;
  menuBtn.setAttribute('aria-expanded', 'true');
  listsEl.querySelector<HTMLButtonElement>('.current .list-name')?.focus();
}

function closeDrawer(restoreFocus = true) {
  if (!drawer.classList.contains('open')) return;
  drawer.classList.remove('open');
  drawerBackdrop.classList.remove('open');
  drawer.inert = true;
  menuBtn.setAttribute('aria-expanded', 'false');
  if (restoreFocus) menuBtn.focus();
}

function renderDrawer() {
  listsEl.replaceChildren(
    ...state.lists.map((l) => {
      const li = document.createElement('li');
      li.className = 'list-row' + (l.id === state.currentId ? ' current' : '');
      li.dataset.id = l.id;
      li.innerHTML = `
        <button type="button" class="list-name"><span class="name"></span><span class="count"></span></button>
        <button type="button" class="list-del" title="Delete list" aria-label="Delete list">×</button>`;
      li.querySelector('.name')!.textContent = listName(l);
      const open = l.items.filter((i) => !i.done).length;
      li.querySelector('.count')!.textContent = open ? String(open) : '';
      if (l.id === state.currentId) li.querySelector('.list-name')!.setAttribute('aria-current', 'true');
      return li;
    }),
  );
}

// ---------- undo toast ----------

let undoSnapshot: string | null = null;
let toastTimer = 0;

function snapshot() {
  undoSnapshot = JSON.stringify(state);
}

function toast(msg: string, undoable = false) {
  toastMsg.textContent = msg;
  toastUndo.hidden = !undoable;
  if (!undoable) undoSnapshot = null;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('show');
    undoSnapshot = null;
  }, 6000);
}

toastUndo.addEventListener('click', () => {
  if (undoSnapshot) {
    state = JSON.parse(undoSnapshot) as State;
    undoSnapshot = null;
    expireTicked(state, Date.now());
    commit();
    render();
  }
  toastEl.classList.remove('show');
});

// ---------- rendering ----------

function duration(ms: number): string {
  const mins = Math.ceil(Math.max(0, ms) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

const remaining = (doneAt: number | null, now: number) => duration((doneAt ?? now) + ttlMs(current()) - now);
const expiryVerb = () => (current().expireMode === 'reset' ? 'unticked' : 'deleted');

function itemEl(item: Item, now: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'item' + (item.indent ? ' indent' : '') + (item.done ? ' done' : '');
  li.dataset.id = item.id;
  li.innerHTML = `
    <span class="handle" title="Drag to move">${GRIP}</span>
    <input type="checkbox" class="check" aria-label="Done" />
    <textarea class="text" rows="1" aria-label="Item"></textarea>
    ${item.done ? `<span class="expiry" title="Time until this item is ${expiryVerb()}"></span>` : ''}
    <button type="button" class="del" title="Delete" aria-label="Delete">×</button>`;
  li.querySelector<HTMLInputElement>('.check')!.checked = item.done;
  li.querySelector('textarea')!.value = item.text;
  const expiry = li.querySelector('.expiry');
  if (expiry) expiry.textContent = remaining(item.doneAt, now);
  return li;
}

function fit(ta: HTMLTextAreaElement) {
  if (AUTOSIZE_IN_CSS) return;
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

function focusItem(id: string, caret: number) {
  const ta = document.querySelector<HTMLTextAreaElement>(`.item[data-id="${CSS.escape(id)}"] textarea`);
  if (!ta) return;
  ta.focus();
  const pos = caret < 0 ? ta.value.length : caret;
  ta.setSelectionRange(pos, pos);
}

function render(focus?: { id: string; caret: number }) {
  const focused = document.activeElement;
  if (!focus && focused instanceof HTMLTextAreaElement) {
    const id = idOf(focused);
    if (id) focus = { id, caret: focused.selectionStart };
  }

  const now = Date.now();
  const done = completed();
  rendering = true;
  if (document.activeElement !== titleEl) titleEl.value = current().title;
  activeEl.replaceChildren(...active().map((i) => itemEl(i, now)));
  doneEl.replaceChildren(...done.map((i) => itemEl(i, now)));
  rendering = false;

  emptyHint.hidden = current().items.length > 0;
  doneSection.hidden = done.length === 0;
  doneSection.classList.toggle('collapsed', current().doneCollapsed);
  doneToggle.setAttribute('aria-expanded', String(!current().doneCollapsed));
  doneCount.textContent = `${done.length} ticked item${done.length === 1 ? '' : 's'}`;
  document.title = current().title.trim() || 'Lists';
  const expiryText = `Ticked items are ${expiryVerb()} after ${duration(ttlMs(current()))}.`;
  expiryNote.textContent = expiryText;
  expiryBtn.title = expiryText;
  renderDrawer();

  document.querySelectorAll<HTMLTextAreaElement>('.item textarea').forEach(fit);
  if (focus) focusItem(focus.id, focus.caret);
}

function refreshExpiry() {
  const now = Date.now();
  doneEl.querySelectorAll<HTMLElement>('.item').forEach((li) => {
    const span = li.querySelector('.expiry');
    if (span) span.textContent = remaining(find(li.dataset.id)?.doneAt ?? null, now);
  });
}

function tick() {
  if (expireTicked(state, Date.now())) {
    commit();
    render();
  } else {
    refreshExpiry();
  }
}

// ---------- item events (delegated, shared by both lists) ----------

for (const list of [activeEl, doneEl]) {
  list.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.classList.contains('check')) toggle(idOf(t)!, t.checked);
  });

  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.del');
    const item = find(idOf(btn));
    if (!item) return;
    snapshot();
    remove(item);
    commit();
    render();
    toast('Item deleted', true);
  });

  list.addEventListener('input', (e) => {
    const ta = e.target;
    const item = find(idOf(ta));
    if (!(ta instanceof HTMLTextAreaElement) || !item) return;
    item.text = ta.value.replace(/\n/g, ' ');
    commit();
    fit(ta);
  });

  // Drop items left empty when focus moves away (without re-rendering, so the click that moved focus still lands).
  list.addEventListener('focusout', (e) => {
    if (rendering) return;
    const ta = e.target as HTMLElement;
    const item = find(idOf(ta));
    if (!(ta instanceof HTMLTextAreaElement) || !item || item.text.trim()) return;
    remove(item);
    commit();
    ta.closest('.item')?.remove();
    emptyHint.hidden = current().items.length > 0;
  });

  list.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const id = idOf(e.target);
    if (!id || !text.includes('\n')) return;
    e.preventDefault();
    insertParsed(parseMarkdownList(text), id);
  });
}

activeEl.addEventListener('keydown', (e) => {
  const ta = e.target;
  if (!(ta instanceof HTMLTextAreaElement) || e.isComposing) return;
  const item = find(idOf(ta));
  if (!item) return;
  const act = active();
  const i = act.indexOf(item);
  const { selectionStart: start, selectionEnd: end, value } = ta;

  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    toggle(item.id, true);
    const next = act[i + 1];
    if (next && !next.done) focusItem(next.id, -1);
  } else if (e.key === 'Enter') {
    // Split at the caret, like a text editor.
    e.preventDefault();
    item.text = value.slice(0, start);
    const created: Item = { id: newId(), text: value.slice(end), done: false, doneAt: null, indent: item.indent };
    const items = current().items;
    items.splice(items.indexOf(item) + 1, 0, created);
    commit();
    render({ id: created.id, caret: 0 });
  } else if (e.key === 'Backspace' && start === 0 && end === 0) {
    if (item.indent) {
      e.preventDefault();
      item.indent = 0;
      commit();
      render({ id: item.id, caret: 0 });
    } else if (i > 0) {
      // Merge into the previous item.
      e.preventDefault();
      const prev = act[i - 1];
      const caret = prev.text.length;
      prev.text += item.text;
      remove(item);
      commit();
      render({ id: prev.id, caret });
    }
  } else if (e.key === 'Tab' && !(e.shiftKey && item.indent === 0)) {
    e.preventDefault();
    item.indent = e.shiftKey || i === 0 ? 0 : 1;
    commit();
    render({ id: item.id, caret: start });
  } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    move(item, e.key === 'ArrowUp' ? -1 : 1);
    render({ id: item.id, caret: start });
  } else if (e.key === 'ArrowUp' && start === 0 && end === 0 && i > 0) {
    e.preventDefault();
    focusItem(act[i - 1].id, -1);
  } else if (e.key === 'ArrowDown' && start === value.length && end === value.length) {
    e.preventDefault();
    if (act[i + 1]) focusItem(act[i + 1].id, 0);
    else addInput.focus();
  }
});

doneEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target instanceof HTMLTextAreaElement) {
    e.preventDefault();
    e.target.blur();
  }
});

// ---------- drag and drop ----------

/** Rebuilds item order and done-state from the DOM after a drag. */
function syncFromDom() {
  const ids = (list: HTMLElement) => [...list.children].map((li) => (li as HTMLElement).dataset.id);
  const now = Date.now();
  const next: Item[] = [];
  for (const id of ids(activeEl)) {
    const item = find(id);
    if (!item) continue;
    if (item.done) Object.assign(item, { done: false, doneAt: null, indent: 0 });
    next.push(item);
  }
  for (const id of ids(doneEl)) {
    const item = find(id);
    if (!item) continue;
    if (!item.done) Object.assign(item, { done: true, doneAt: now });
    next.push(item);
  }
  current().items = next;
  commit();
  render();
}

const sortableOptions: Sortable.Options = {
  group: 'items',
  handle: '.handle',
  animation: 150,
  ghostClass: 'ghost',
  chosenClass: 'chosen',
  dragClass: 'dragging',
  onEnd: syncFromDom,
};
Sortable.create(activeEl, sortableOptions);
Sortable.create(doneEl, { ...sortableOptions, sort: false });

// ---------- header, add row, completed section ----------

titleEl.addEventListener('input', () => {
  current().title = titleEl.value;
  commit();
  renderDrawer();
  document.title = current().title.trim() || 'Lists';
});

function addFromInput() {
  const text = addInput.value.trim();
  if (!text) return;
  current().items.push({ id: newId(), text, done: false, doneAt: null, indent: 0 });
  addInput.value = '';
  commit();
  render();
}

addInput.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    addFromInput();
  } else if (e.key === 'ArrowUp' && !addInput.value) {
    const last = active().at(-1);
    if (last) {
      e.preventDefault();
      focusItem(last.id, -1);
    }
  }
});
addInput.addEventListener('blur', addFromInput);
addInput.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (!text.includes('\n')) return;
  e.preventDefault();
  insertParsed(parseMarkdownList(text), null, parseTitle(text));
});

doneToggle.addEventListener('click', () => {
  current().doneCollapsed = !current().doneCollapsed;
  commit();
  render();
});

$<HTMLButtonElement>('clear-done').addEventListener('click', () => {
  snapshot();
  current().items = active();
  commit();
  render();
  toast('Ticked items deleted', true);
});

// ---------- ticked item timer ----------

expiryBtn.addEventListener('click', () => {
  const list = current();
  expiryDialog.querySelector<HTMLInputElement>(`input[name="expire-mode"][value="${list.expireMode}"]`)!.checked = true;
  expireHours.value = String(list.expireHours);
  expiryDialog.showModal();
});

expiryDialog.addEventListener('close', () => {
  if (expiryDialog.returnValue === 'save') {
    const list = current();
    const mode = expiryDialog.querySelector<HTMLInputElement>('input[name="expire-mode"]:checked')?.value as ExpireMode;
    list.expireMode = mode === 'reset' ? 'reset' : 'delete';
    const hours = expireHours.valueAsNumber;
    if (hours > 0) list.expireHours = hours;
    expireTicked(state, Date.now());
    commit();
    render();
  }
  expiryDialog.returnValue = '';
});

// ---------- import / export ----------

$<HTMLButtonElement>('import-btn').addEventListener('click', () => {
  importText.value = '';
  importAsNew.checked = current().items.length > 0;
  updateImportCount();
  importDialog.showModal();
  importText.focus();
});

function updateImportCount() {
  const n = importText.value.trim() ? parseMarkdownList(importText.value).length : 0;
  importCount.textContent = n ? `${n} item${n === 1 ? '' : 's'} found` : '';
  importConfirm.disabled = n === 0;
}
importText.addEventListener('input', updateImportCount);

importDialog.addEventListener('close', () => {
  if (importDialog.returnValue === 'import') {
    const md = importText.value;
    snapshot();
    if (importAsNew.checked) createList();
    insertParsed(parseMarkdownList(md), null, parseTitle(md), false);
  }
  importDialog.returnValue = '';
});

$<HTMLButtonElement>('export-btn').addEventListener('click', async () => {
  const md = toMarkdown(current().title, active(), completed());
  try {
    await navigator.clipboard.writeText(md);
    toast('Copied as Markdown');
  } catch {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `${current().title.trim() || 'list'}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Downloaded as Markdown');
  }
});

// ---------- lists menu ----------

drawer.inert = true;
menuBtn.addEventListener('click', openDrawer);
drawerBackdrop.addEventListener('click', () => closeDrawer());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
});

listsEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const id = target.closest<HTMLElement>('.list-row')?.dataset.id;
  if (!id) return;
  if (target.closest('.list-del')) {
    deleteList(id);
  } else {
    switchTo(id);
    closeDrawer(false);
    addInput.focus();
  }
});

$<HTMLButtonElement>('new-list').addEventListener('click', () => {
  createList();
  closeDrawer(false);
  titleEl.focus();
});

Sortable.create(listsEl, {
  animation: 150,
  delay: 200,
  delayOnTouchOnly: true,
  ghostClass: 'ghost',
  onEnd: () => {
    const order = [...listsEl.children].map((li) => (li as HTMLElement).dataset.id);
    state.lists.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    commit();
  },
});

// ---------- lifecycle ----------

// Keep multiple open tabs in sync.
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  const viewing = state.currentId;
  state = load();
  if (state.lists.some((l) => l.id === viewing)) state.currentId = viewing;
  render();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tick();
});
setInterval(tick, 30_000);

render();
