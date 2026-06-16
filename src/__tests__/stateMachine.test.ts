import { describe, expect, it } from 'vitest';
import { createTracker, uri, writeFile } from './helpers';

describe('State machine transitions', () => {
  it('toReview → reviewed (markReviewed)', () => {
    writeFile('f.txt', 'v1');
    const tracker = createTracker();
    tracker.addFile(uri('f.txt'));
    tracker.updateReviewState(uri('f.txt'), 'v2', true);
    tracker.markReviewed(uri('f.txt'), 'v2');

    const s = tracker.getFileState(uri('f.txt'))!;
    expect(s.reviewed).toBe(true);
    expect(s.hasBeenReviewed).toBe(true);
  });

  it('reviewed → toReview (content changes)', () => {
    writeFile('f.txt', 'v1');
    const tracker = createTracker();
    tracker.addFile(uri('f.txt'));
    tracker.markReviewed(uri('f.txt'), 'v1');

    tracker.updateReviewState(uri('f.txt'), 'v2', false);
    expect(tracker.getFileState(uri('f.txt'))!.reviewed).toBe(false);
  });

  it('approved → toReview (content changes)', () => {
    writeFile('f.txt', 'v1');
    const tracker = createTracker();
    tracker.addFile(uri('f.txt'));
    tracker.markReviewed(uri('f.txt'), 'v1');
    tracker.approveReviewed();
    expect(tracker.getFileState(uri('f.txt'))!.approved).toBe(true);

    tracker.updateReviewState(uri('f.txt'), 'v2', false);
    const s = tracker.getFileState(uri('f.txt'))!;
    expect(s.approved).toBe(false);
    expect(s.reviewed).toBe(false);
  });

  it('never-reviewed revert to original → untracked', () => {
    writeFile('f.txt', 'original');
    const tracker = createTracker();
    tracker.addFile(uri('f.txt'));

    tracker.updateReviewState(uri('f.txt'), 'modified', true);
    expect(tracker.getFileState(uri('f.txt'))).toBeDefined();

    tracker.updateReviewState(uri('f.txt'), 'original', false);
    expect(tracker.getFileState(uri('f.txt'))).toBeUndefined();
  });
});
