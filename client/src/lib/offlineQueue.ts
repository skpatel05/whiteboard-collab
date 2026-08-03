export interface QueuedUpdate {
  id: number;
  boardId: string;
  update: string;
  baseVersion: number;
  clientId: number;
  queuedAt: number;
}

const DB_NAME = "whiteboard-offline";
const STORE = "updates";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Buffer an outbound Yjs update locally so it survives offline. */
export async function enqueueUpdate(payload: Omit<QueuedUpdate, "id" | "queuedAt">): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add({ ...payload, queuedAt: Date.now() } as QueuedUpdate);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Replay buffered updates through `send` (attempts the network). Returns the
 * number of updates that failed and remain queued.
 */
export async function drainUpdates(send: (q: QueuedUpdate) => Promise<void>): Promise<number> {
  const db = await openDb();
  const all: QueuedUpdate[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedUpdate[]);
    req.onerror = () => reject(req.error);
  });
  let remaining = 0;
  for (const q of all) {
    try {
      await send(q);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(q.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      remaining += 1;
    }
  }
  return remaining;
}

export async function queuedCount(): Promise<number> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}
