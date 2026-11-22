import type { EventSink, LogEvent } from './logger';

const STORE = 'events';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/** Stores log events on the device in IndexedDB, which has room for far more than localStorage. */
export async function openIndexedDbSink(dbName = 'warchest-logs'): Promise<EventSink> {
  const open = indexedDB.open(dbName, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore(STORE, { autoIncrement: true });
  };
  const db = await request(open);

  return {
    async append(event: LogEvent) {
      await request(db.transaction(STORE, 'readwrite').objectStore(STORE).add(event));
    },
    async readAll() {
      return (await request(db.transaction(STORE).objectStore(STORE).getAll())) as LogEvent[];
    },
  };
}
