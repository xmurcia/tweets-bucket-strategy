import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { HeroReplaySnapshotIdentity, HeroReplayStoredSnapshot, PolymarketEvent } from './src/types.ts';

export const HERO_REPLAY_HISTORY_DIR = path.join(process.cwd(), 'tmp', 'hero-replay');
export const HERO_REPLAY_MIN_CAPTURE_INTERVAL_MS = 60 * 1000;

const historyWriteQueues = new Map<string, Promise<void>>();

function sanitizePathSegment(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'event';
}

function compareSnapshots(a: HeroReplayStoredSnapshot, b: HeroReplayStoredSnapshot): number {
  if (a.capturedAtMs !== b.capturedAtMs) {
    return a.capturedAtMs - b.capturedAtMs;
  }

  if (a.capturedAt !== b.capturedAt) {
    return a.capturedAt.localeCompare(b.capturedAt);
  }

  return 0;
}

function buildSnapshotIdentity(event: PolymarketEvent): HeroReplaySnapshotIdentity {
  return {
    eventId: event.id,
    eventSlug: event.slug,
    eventTitle: event.title,
    eventEndDate: event.endDate,
    trackingId: event.trackingId,
  };
}

function buildHistoryFileName(identity: Pick<HeroReplaySnapshotIdentity, 'eventId' | 'eventSlug'>): string {
  const slugSegment = sanitizePathSegment(identity.eventSlug);
  const eventIdSegment = sanitizePathSegment(identity.eventId);
  return `${slugSegment}--${eventIdSegment}.json`;
}

function getHistoryFilePath(identity: Pick<HeroReplaySnapshotIdentity, 'eventId' | 'eventSlug'>): string {
  return path.join(HERO_REPLAY_HISTORY_DIR, buildHistoryFileName(identity));
}

function normalizeSnapshots(value: unknown, filePath: string): HeroReplayStoredSnapshot[] {
  if (!Array.isArray(value)) {
    throw new Error(`Hero replay history at ${filePath} must be a JSON array`);
  }

  return [...value].sort(compareSnapshots) as HeroReplayStoredSnapshot[];
}

async function writeSnapshotsAtomically(filePath: string, snapshots: HeroReplayStoredSnapshot[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });

  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFilePath, `${JSON.stringify(snapshots, null, 2)}\n`, 'utf8');
  await rename(tempFilePath, filePath);
}

async function queueHistoryWrite<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const currentQueue = historyWriteQueues.get(filePath) ?? Promise.resolve();

  let result!: T;
  const nextQueue = currentQueue
    .catch(() => undefined)
    .then(async () => {
      result = await operation();
    });

  historyWriteQueues.set(filePath, nextQueue);

  try {
    await nextQueue;
    return result;
  } finally {
    if (historyWriteQueues.get(filePath) === nextQueue) {
      historyWriteQueues.delete(filePath);
    }
  }
}

export function createHeroReplayStoredSnapshot(event: PolymarketEvent, capturedAtInput: Date | number | string = Date.now()): HeroReplayStoredSnapshot {
  const capturedAtDate = new Date(capturedAtInput);
  const capturedAtMs = capturedAtDate.getTime();

  if (!Number.isFinite(capturedAtMs)) {
    throw new Error('Hero replay snapshot requires a valid capture timestamp');
  }

  return {
    ...buildSnapshotIdentity(event),
    capturedAt: capturedAtDate.toISOString(),
    capturedAtMs,
    event,
  };
}

export async function readHeroReplaySnapshots(identity: Pick<HeroReplaySnapshotIdentity, 'eventId' | 'eventSlug'>): Promise<HeroReplayStoredSnapshot[]> {
  const filePath = getHistoryFilePath(identity);

  try {
    const fileContents = await readFile(filePath, 'utf8');
    return normalizeSnapshots(JSON.parse(fileContents), filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

export async function appendHeroReplaySnapshot(event: PolymarketEvent, capturedAtInput: Date | number | string = Date.now()): Promise<HeroReplayStoredSnapshot> {
  const snapshot = createHeroReplayStoredSnapshot(event, capturedAtInput);
  const filePath = getHistoryFilePath(snapshot);

  return queueHistoryWrite(filePath, async () => {
    const existingSnapshots = await readHeroReplaySnapshots(snapshot);
    const nextSnapshots = [...existingSnapshots, snapshot].sort(compareSnapshots);

    await writeSnapshotsAtomically(filePath, nextSnapshots);

    return snapshot;
  });
}

export async function captureHeroReplaySnapshot(
  event: PolymarketEvent,
  options: {
    capturedAtInput?: Date | number | string;
    minCaptureIntervalMs?: number;
  } = {}
): Promise<{ snapshot: HeroReplayStoredSnapshot; didAppend: boolean }> {
  const {
    capturedAtInput = Date.now(),
    minCaptureIntervalMs = HERO_REPLAY_MIN_CAPTURE_INTERVAL_MS,
  } = options;
  const snapshot = createHeroReplayStoredSnapshot(event, capturedAtInput);
  const filePath = getHistoryFilePath(snapshot);

  return queueHistoryWrite(filePath, async () => {
    const existingSnapshots = await readHeroReplaySnapshots(snapshot);
    const latestSnapshot = existingSnapshots.at(-1);

    if (
      latestSnapshot &&
      snapshot.capturedAtMs - latestSnapshot.capturedAtMs < minCaptureIntervalMs
    ) {
      return {
        snapshot: latestSnapshot,
        didAppend: false,
      };
    }

    const nextSnapshots = [...existingSnapshots, snapshot].sort(compareSnapshots);

    await writeSnapshotsAtomically(filePath, nextSnapshots);

    return {
      snapshot,
      didAppend: true,
    };
  });
}

export function getHeroReplayHistoryPath(identity: Pick<HeroReplaySnapshotIdentity, 'eventId' | 'eventSlug'>): string {
  return getHistoryFilePath(identity);
}
