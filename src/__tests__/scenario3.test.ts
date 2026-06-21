import { describe, expect, it } from 'vitest';
import { createTracker, storedState, uri, writeFile } from './helpers';

describe('Scenario 3: hasBeenReviewed persisted across restarts', () => {
  it('revert to original after review -> stays tracked', () => {
    writeFile('revert.txt', 'original content');
    const tracker = createTracker();

    tracker.addFile(uri('revert.txt'));
    tracker.updateReviewState(uri('revert.txt'), 'modified content', true);
    tracker.markReviewed(uri('revert.txt'), 'modified content');
    expect(tracker.getFileState(uri('revert.txt'))!.hasBeenReviewed).toBe(true);

    tracker.updateReviewState(uri('revert.txt'), 'original content', false);
    expect(tracker.getFileState(uri('revert.txt'))).toBeDefined();
  });

  it('restart preserves hasBeenReviewed -> revert does not untrack', () => {
    writeFile('revert.txt', 'original content');
    const tracker1 = createTracker();

    tracker1.addFile(uri('revert.txt'));
    tracker1.updateReviewState(uri('revert.txt'), 'modified content', true);
    tracker1.markReviewed(uri('revert.txt'), 'modified content');

    const tracker2 = createTracker(storedState);
    expect(tracker2.getFileState(uri('revert.txt'))!.hasBeenReviewed).toBe(true);

    tracker2.updateReviewState(uri('revert.txt'), 'original content', false);
    expect(tracker2.getFileState(uri('revert.txt'))).toBeDefined();
  });

  it('regression: hasBeenReviewed persisted in storage', () => {
    writeFile('revert.txt', 'original content');
    const tracker = createTracker();

    tracker.addFile(uri('revert.txt'));
    tracker.updateReviewState(uri('revert.txt'), 'modified content', true);
    tracker.markReviewed(uri('revert.txt'), 'modified content');

    const persisted = JSON.parse(JSON.stringify(storedState));
    const fileReviews = persisted['seenIt.fileReviews'];
    const entry = Object.values(fileReviews)[0] as any;
    expect(entry.hasBeenReviewed).toBe(true);
  });
});
