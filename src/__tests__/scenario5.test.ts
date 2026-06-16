import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { createTracker, tmpFile, uri, writeFile } from './helpers';

describe('Scenario 5: removeFile + restoreFile (atomic save)', () => {
  it('removeFile returns entry, restoreFile restores it', () => {
    writeFile('atomic.txt', 'content');
    const tracker = createTracker();

    tracker.addFile(uri('atomic.txt'));
    const stateBefore = tracker.getFileState(uri('atomic.txt'))!;

    const removed = tracker.removeFile(uri('atomic.txt'));
    expect(removed).toBeDefined();
    expect(removed!.uri).toBe(path.normalize(tmpFile('atomic.txt')));
    expect(tracker.getFileState(uri('atomic.txt'))).toBeUndefined();

    tracker.restoreFile(removed!);
    const restored = tracker.getFileState(uri('atomic.txt'));
    expect(restored).toBeDefined();
    expect(restored!.reviewed).toBe(stateBefore.reviewed);
  });

  it('restoreFile does not overwrite existing entry', () => {
    writeFile('atomic.txt', 'content');
    const tracker = createTracker();

    tracker.addFile(uri('atomic.txt'));
    const original = tracker.getFileState(uri('atomic.txt'))!;
    const fakeEntry = { ...original, reviewed: true, uri: path.normalize(tmpFile('atomic.txt')) };

    tracker.restoreFile(fakeEntry);
    expect(tracker.getFileState(uri('atomic.txt'))!.reviewed).toBe(false);
  });

  it('batch remove + restore', () => {
    writeFile('a.txt', 'aaa');
    writeFile('b.txt', 'bbb');
    writeFile('c.txt', 'ccc');
    const tracker = createTracker();

    tracker.addFile(uri('a.txt'));
    tracker.addFile(uri('b.txt'));
    tracker.addFile(uri('c.txt'));
    expect(tracker.getAllFiles()).toHaveLength(3);

    const removedA = tracker.removeFile(uri('a.txt'));
    const removedB = tracker.removeFile(uri('b.txt'));
    const removedC = tracker.removeFile(uri('c.txt'));
    expect(tracker.getAllFiles()).toHaveLength(0);

    tracker.restoreFile(removedA!);
    tracker.restoreFile(removedB!);
    tracker.restoreFile(removedC!);
    expect(tracker.getAllFiles()).toHaveLength(3);
  });
});
