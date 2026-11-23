import type { SdDirectoryHandle } from './sdCardFs';

export type HandlePermissionMode = 'read' | 'readwrite';
export type HandlePermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

export interface StoredDeviceHandleRecord {
  deviceId: string;
  volumeName: string;
  profileName: string;
  handle: SdDirectoryHandle;
  lastMountedAt: string;
}

const DB_NAME = 'rgt_device_handles_v1';
const DB_VERSION = 1;
const STORE_NAME = 'device_handles';

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openHandleDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDbAvailable()) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'deviceId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function checkHandlePermission(
  handle: SdDirectoryHandle | null | undefined,
  mode: HandlePermissionMode = 'readwrite',
): Promise<HandlePermissionState> {
  if (!handle) return 'unsupported';
  if (typeof handle.queryPermission !== 'function') {
    return 'unsupported';
  }
  try {
    const state = await handle.queryPermission({ mode });
    if (state === 'granted' || state === 'prompt' || state === 'denied') {
      return state;
    }
    return 'unsupported';
  } catch {
    return 'denied';
  }
}

export async function requestHandlePermission(
  handle: SdDirectoryHandle | null | undefined,
  mode: HandlePermissionMode = 'readwrite',
): Promise<HandlePermissionState> {
  if (!handle) return 'unsupported';
  if (typeof handle.requestPermission !== 'function') {
    return checkHandlePermission(handle, mode);
  }
  try {
    const state = await handle.requestPermission({ mode });
    if (state === 'granted' || state === 'prompt' || state === 'denied') {
      return state;
    }
    return 'denied';
  } catch {
    return 'denied';
  }
}

export async function saveStoredDeviceHandle(record: StoredDeviceHandleRecord): Promise<boolean> {
  const db = await openHandleDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
      tx.onabort = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

export async function listStoredDeviceHandles(): Promise<StoredDeviceHandleRecord[]> {
  const db = await openHandleDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const raw = Array.isArray(req.result) ? (req.result as StoredDeviceHandleRecord[]) : [];
        const valid = raw
          .filter(
            (r) =>
              r &&
              typeof r.deviceId === 'string' &&
              r.deviceId.trim().length > 0 &&
              r.handle &&
              r.handle.kind === 'directory',
          )
          .sort((a, b) => (b.lastMountedAt || '').localeCompare(a.lastMountedAt || ''));
        db.close();
        resolve(valid);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  });
}

export async function getStoredDeviceHandle(
  deviceId: string,
): Promise<StoredDeviceHandleRecord | null> {
  if (!deviceId.trim()) return null;
  const db = await openHandleDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(deviceId);
      req.onsuccess = () => {
        const res = req.result as StoredDeviceHandleRecord | undefined;
        db.close();
        resolve(res && res.handle ? res : null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function getMostRecentStoredDeviceHandle(): Promise<StoredDeviceHandleRecord | null> {
  const all = await listStoredDeviceHandles();
  return all[0] || null;
}

export async function updateStoredDeviceHandleName(
  deviceId: string,
  profileName: string,
): Promise<boolean> {
  const existing = await getStoredDeviceHandle(deviceId);
  if (!existing) return false;
  return saveStoredDeviceHandle({
    ...existing,
    profileName: profileName.trim() || existing.volumeName,
  });
}

export async function removeStoredDeviceHandle(deviceId: string): Promise<boolean> {
  if (!deviceId.trim()) return false;
  const db = await openHandleDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(deviceId);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}
