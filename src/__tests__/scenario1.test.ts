import { describe, expect, it } from 'vitest';
import { createTracker, uri, writeFile } from './helpers';

describe('Scenario 1: untracked file modified → should start tracking', () => {
  it('addFile on untracked file → tracked', () => {
    writeFile('new.txt', 'hello world');
    const tracker = createTracker();

    expect(tracker.getFileState(uri('new.txt'))).toBeUndefined();
    tracker.addFile(uri('new.txt'));

    const after = tracker.getFileState(uri('new.txt'));
    expect(after).toBeDefined();
    expect(after!.reviewed).toBe(false);
    expect(after!.approved).toBeFalsy();
  });

  it('updateReviewState(allowNew=false) on untracked → NOT tracked', () => {
    writeFile('new.txt', 'hello world');
    const tracker = createTracker();

    tracker.updateReviewState(uri('new.txt'));

    expect(tracker.getFileState(uri('new.txt'))).toBeUndefined();
  });

  it('updateReviewState(allowNew=true, dirty content) → tracked', () => {
    writeFile('new.txt', 'hello world');
    const tracker = createTracker();

    tracker.updateReviewState(uri('new.txt'), 'hello world modified', true);

    const state = tracker.getFileState(uri('new.txt'));
    expect(state).toBeDefined();
    expect(state!.reviewed).toBe(false);
  });
});
