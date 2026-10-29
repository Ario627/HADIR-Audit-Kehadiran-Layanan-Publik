import { decodeEntry, encodeEntry, trimEntries, type OutboxEntry } from './outbox';

const DB_NAME = 'hadir.outbox';
const DB_VERSION = 1;
const STORE = 'ops';
const CLOSE_DELAY_MS = 30_000;

let memory: Map<string, string> | null = null;
let pendingClose: ReturnType<typeof setTimeout> | null = null;
let handle: Promise<IDBDatabase | null> | null = null;

function memoryStore(): Map<string, string> {
  memory ??= new Map<string, string>();
  return memory;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function decodeAll(raws: readonly string[], now: number): OutboxEntry[] {
  const entries: OutboxEntry[] = [];
  for (const raw of raws) {
    const entry = decodeEntry(raw, now);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onabort = () => {
      reject(tx.error);
    };
    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

function scheduleClose(): void {
  if (pendingClose !== null) {
    clearTimeout(pendingClose);
  }
  pendingClose = setTimeout(() => {
    const current = handle;
    handle = null;
    pendingClose = null;
    void current?.then((db) => {
      db?.close();
    });
  }, CLOSE_DELAY_MS);
}

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) {
    return Promise.resolve(null);
  }
  handle ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error);
    };
    request.onblocked = () => {
      reject(new Error('outbox_blocked'));
    };
  }).catch(() => null);
  scheduleClose();
  return handle;
}

export async function readOutbox(now: number = Date.now()): Promise<OutboxEntry[]> {
  const db = await openDb();
  if (db === null) {
    return decodeAll([...memoryStore().values()], now);
  }
  try {
    const tx = db.transaction(STORE, 'readonly');
    const rows = await requestToPromise(tx.objectStore(STORE).getAll());
    await transactionDone(tx);
    const raws: string[] = [];
    for (const row of rows) {
      if (typeof row === 'string') {
        raws.push(row);
      }
    }
    return decodeAll(raws, now);
  } catch {
    return decodeAll([...memoryStore().values()], now);
  }
}

export async function writeOutbox(entries: readonly OutboxEntry[]): Promise<void> {
  const trimmed = trimEntries(entries);
  const store = memoryStore();
  store.clear();
  for (const entry of trimmed) {
    store.set(entry.id, encodeEntry(entry));
  }
  const db = await openDb();
  if (db === null) {
    return;
  }
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const objectStore = tx.objectStore(STORE);
    objectStore.clear();
    for (const entry of trimmed) {
      objectStore.put(encodeEntry(entry));
    }
    await transactionDone(tx);
  } catch {
    return;
  }
}