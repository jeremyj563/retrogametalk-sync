import type { ChdConversionMode, ChdJobSnapshot } from '../types';
import { readJsonSafely } from './http';

export interface PrepareChdJobParams {
  itemId: number;
  fileId: number;
  targetId: string;
  mode: ChdConversionMode;
  name: string;
  signal?: AbortSignal;
  onProgress?: (snapshot: ChdJobSnapshot) => void;
}

function createAbortError(): DOMException {
  return new DOMException('Installation canceled by user.', 'AbortError');
}

async function cancelChdJobOnServer(jobId: string): Promise<void> {
  try {
    await fetch(`/api/chd-jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      headers: { 'X-Requested-With': 'rgt-sync' },
    });
  } catch {
    // Best-effort server-side cancellation
  }
}

async function pollChdJobUntilDone(
  jobId: string,
  signal: AbortSignal | undefined,
  onProgress?: (snapshot: ChdJobSnapshot) => void,
): Promise<ChdJobSnapshot> {
  while (true) {
    if (signal?.aborted) {
      void cancelChdJobOnServer(jobId);
      throw createAbortError();
    }
    const res = await fetch(`/api/chd-jobs/${encodeURIComponent(jobId)}`, { signal });
    const parsed = await readJsonSafely<{ job?: ChdJobSnapshot; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.job) {
      throw new Error(parsed.errorMessage || `CHD status check failed (HTTP ${res.status})`);
    }
    const snap = parsed.data.job;
    onProgress?.(snap);
    if (snap.status === 'done') return snap;
    if (snap.status === 'canceled') throw createAbortError();
    if (snap.status === 'error') {
      throw new Error(snap.error || 'CHD conversion failed on server.');
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, 650);
      const onAbort = () => {
        clearTimeout(timer);
        void cancelChdJobOnServer(jobId);
        reject(createAbortError());
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}

/**
 * Trigger an on-export `.chd` conversion job on the server and subscribe to live SSE progress
 * until ready for streaming. Aborting `signal` immediately cancels `chdman` server-side.
 */
export async function prepareAndWaitForChdJob(
  params: PrepareChdJobParams,
): Promise<ChdJobSnapshot> {
  if (params.signal?.aborted) {
    throw createAbortError();
  }

  const res = await fetch(`/api/items/${params.itemId}/prepare-chd`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'rgt-sync',
    },
    body: JSON.stringify({
      fileId: params.fileId,
      targetId: params.targetId,
      mode: params.mode,
      name: params.name,
    }),
    signal: params.signal,
  });

  const parsed = await readJsonSafely<{ job?: ChdJobSnapshot; error?: string }>(res);
  if (!parsed.ok || !parsed.data?.job) {
    throw new Error(parsed.errorMessage || `Failed to start CHD conversion (HTTP ${res.status})`);
  }

  const initialJob = parsed.data.job;
  params.onProgress?.(initialJob);

  if (initialJob.status === 'done') {
    return initialJob;
  }
  if (initialJob.status === 'canceled') {
    throw createAbortError();
  }
  if (initialJob.status === 'error') {
    throw new Error(initialJob.error || 'CHD conversion failed on server.');
  }

  const jobId = initialJob.jobId;

  if (typeof EventSource === 'undefined') {
    return pollChdJobUntilDone(jobId, params.signal, params.onProgress);
  }

  return new Promise<ChdJobSnapshot>((resolve, reject) => {
    let settled = false;
    const es = new EventSource(`/api/chd-jobs/${encodeURIComponent(jobId)}/events`);

    const cleanup = () => {
      try {
        es.close();
      } catch {
        // ignore
      }
      params.signal?.removeEventListener('abort', onAbort);
    };

    const finishResolve = (snap: ChdJobSnapshot) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(snap);
    };

    const finishReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      void cancelChdJobOnServer(jobId);
      finishReject(createAbortError());
    };

    if (params.signal) {
      if (params.signal.aborted) {
        onAbort();
        return;
      }
      params.signal.addEventListener('abort', onAbort, { once: true });
    }

    const handleSnapshotPayload = (rawData: string) => {
      try {
        const snap = JSON.parse(rawData) as ChdJobSnapshot;
        params.onProgress?.(snap);
        if (snap.status === 'done') {
          finishResolve(snap);
        } else if (snap.status === 'canceled') {
          finishReject(createAbortError());
        } else if (snap.status === 'error') {
          finishReject(new Error(snap.error || 'CHD conversion failed on server.'));
        }
      } catch {
        // ignore malformed event chunk
      }
    };

    es.addEventListener('progress', (ev) => {
      handleSnapshotPayload((ev as MessageEvent).data);
    });
    es.addEventListener('done', (ev) => {
      handleSnapshotPayload((ev as MessageEvent).data);
    });
    es.addEventListener('error', (ev) => {
      const msgEvent = ev as MessageEvent;
      if (typeof msgEvent.data === 'string' && msgEvent.data.trim()) {
        handleSnapshotPayload(msgEvent.data);
        return;
      }
      // EventSource connection interrupted — fall back seamlessly to JSON polling
      if (!settled) {
        settled = true;
        cleanup();
        void pollChdJobUntilDone(jobId, params.signal, params.onProgress).then(resolve, reject);
      }
    });
  });
}
