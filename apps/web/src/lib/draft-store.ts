import { decodeDraft, encodeDraft, type DraftInput, type ReportDraft } from './draft';

const DB_NAME = 'hadir.draft';
const DB_VERSION = 1;
const STORE = 'drafts';
const KEY = 'active';
const CLOSE_DELAY_MS = 30_000;

let memory: string | null | undefined;
let pendingClose: ReturnType<typeof setTimeout> | null = null;
let handle: Promise<IDBDatabase | null> | null = null;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
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
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error);
    };
    request.onblocked = () => {
      reject(new Error('draft_blocked'));
    };
  }).catch(() => null);
  scheduleClose();
  return handle;
}

export async function readDraft(
  draftId: string,
  now: number = Date.now(),
): Promise<ReportDraft | null> {
  const db = await openDb();
  if (db === null) {
    return decodeDraft(memory ?? null, draftId, now);
  }
  try {
    const tx = db.transaction(STORE, 'readonly');
    const row = await requestToPromise(tx.objectStore(STORE).get(KEY));
    await transactionDone(tx);
    return decodeDraft(typeof row === 'string' ? row : null, draftId, now);
  } catch {
    return decodeDraft(memory ?? null, draftId, now);
  }
}

export async function writeDraft(input: DraftInput, now: number = Date.now()): Promise<void> {
  const encoded = encodeDraft(input, now);
  if (encoded === null) {
    return;
  }
  memory = encoded;
  const db = await openDb();
  if (db === null) {
    return;
  }
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(encoded, KEY);
    await transactionDone(tx);
  } catch {
    return;
  }
}

export async function clearDraft(): Promise<boolean> {
  const hadMemory = memory !== null;
  memory = null;
  const db = await openDb();
  if (db === null) {
    return hadMemory;
  }
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const existing = await requestToPromise(store.get(KEY));
    store.delete(KEY);
    await transactionDone(tx);
    return typeof existing === 'string' || hadMemory;
  } catch {
    return hadMemory;
  }
}