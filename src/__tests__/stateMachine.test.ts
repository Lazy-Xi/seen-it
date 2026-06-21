import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { createTracker, tmpFile, uri, writeFile } from './helpers';

describe('State machine transitions', () => {
  // ── Basic explicit transitions ────────────────────────────────────

  it('toReview -> reviewed (markReviewed)', () => {
    writeFile('f.txt', 'v1');
    const tracker = createTracker();
    tracker.addFile(uri('f.txt'));
    tracker.updateReviewState(uri('f.txt'), 'v2', true);
    tracker.markReviewed(uri('f.txt'), 'v2');

    const s = tracker.getFileState(uri('f.txt'))!;
    expect(s.reviewed).toBe(true);
    expect(s.hasBeenReviewed).toBe(true);
  });

  it('reviewed -> toReview (content changes)', () => {
    writeFile('f.txt', 'v1');
    const tracker = createTracker();
    tracker.addFile(uri('f.txt'));
    tracker.markReviewed(uri('f.txt'), 'v1');

    tracker.updateReviewState(uri('f.txt'), 'v2', false);
    expect(tracker.getFileState(uri('f.txt'))!.reviewed).toBe(false);
  });

  it('approved -> toReview (content changes)', () => {
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

  // ── Untrack on revert (never-reviewed files) ──────────────────────

  it('never-reviewed revert to original -> untracked', () => {
    writeFile('f.txt', 'original');
    const tracker = createTracker();
    tracker.addFile(uri('f.txt'));

    tracker.updateReviewState(uri('f.txt'), 'modified', true);
    expect(tracker.getFileState(uri('f.txt'))).toBeDefined();

    tracker.updateReviewState(uri('f.txt'), 'original', false);
    expect(tracker.getFileState(uri('f.txt'))).toBeUndefined();
  });

  it('dirty edit then undo (content reverts to disk) -> untracked', () => {
    writeFile('f.txt', 'original');
    const tracker = createTracker();

    // Simulate dirty handler: file not in map, content differs from disk
    tracker.updateReviewState(uri('f.txt'), 'modified', true);
    expect(tracker.getFileState(uri('f.txt'))).toBeDefined();

    // Simulate dirty handler on undo: file now in map, content matches disk
    tracker.updateReviewState(uri('f.txt'), 'original', true);
    expect(tracker.getFileState(uri('f.txt'))).toBeUndefined();
  });

  it('untracked -> toReview (dirty edit) -> undo -> untracked', () => {
    writeFile('f.txt', 'v1');
    const tracker = createTracker();

    // Dirty handler adds file (untracked -> toReview)
    tracker.updateReviewState(uri('f.txt'), 'v2', true);
    expect(tracker.getFileState(uri('f.txt'))).toBeDefined();

    // Dirty handler fires with reverted content (undo)
    tracker.updateReviewState(uri('f.txt'), 'v1', true);
    expect(tracker.getFileState(uri('f.txt'))).toBeUndefined();
  });

  // ── Re-track after untrack ────────────────────────────────────────

  it('file watcher with stale disk content — dirty handler re-tracks', () => {
    writeFile('f.txt', 'v1');
    const tracker = createTracker();

    // Dirty handler adds file (untracked -> toReview)
    tracker.updateReviewState(uri('f.txt'), 'v2', true);
    expect(tracker.getFileState(uri('f.txt'))).toBeDefined();

    // File watcher fires with stale disk content — may untrack (transient)
    tracker.updateReviewState(uri('f.txt'));

    // Dirty handler fires with actual content — re-tracks if needed
    tracker.updateReviewState(uri('f.txt'), 'v2', true);
    expect(tracker.getFileState(uri('f.txt'))).toBeDefined();

    // Dirty handler fires with reverted content (undo) — should untrack
    tracker.updateReviewState(uri('f.txt'), 'v1', true);
    expect(tracker.getFileState(uri('f.txt'))).toBeUndefined();
  });

  // ── Auto-reviewed on revert (previously reviewed files) ───────────

  it('reviewed -> edit -> undo -> back to reviewed', () => {
    writeFile('f.txt', 'v1');
    const tracker = createTracker();
    tracker.addFile(uri('f.txt'));
    tracker.markReviewed(uri('f.txt'), 'v1');
    expect(tracker.getFileState(uri('f.txt'))!.reviewed).toBe(true);

    // Edit: reviewed -> toReview
    tracker.updateReviewState(uri('f.txt'), 'v2', true);
    expect(tracker.getFileState(uri('f.txt'))!.reviewed).toBe(false);

    // Undo: toReview -> reviewed (content matches reviewedContentHash)
    tracker.updateReviewState(uri('f.txt'), 'v1', true);
    expect(tracker.getFileState(uri('f.txt'))!.reviewed).toBe(true);
  });

  // ── markUnreviewed: explicit unmark should prevent auto-restore ───

  it('reviewed -> markUnreviewed -> edit -> revert -> stays in toReview', () => {
    writeFile('f.txt', 'v1');
    const tracker = createTracker();
    tracker.addFile(uri('f.txt'));
    tracker.markReviewed(uri('f.txt'), 'v1');
    expect(tracker.getFileState(uri('f.txt'))!.reviewed).toBe(true);

    // User explicitly unchecks
    tracker.markUnreviewed(uri('f.txt'));
    expect(tracker.getFileState(uri('f.txt'))!.reviewed).toBe(false);

    // Edit
    tracker.updateReviewState(uri('f.txt'), 'v2', true);
    expect(tracker.getFileState(uri('f.txt'))!.reviewed).toBe(false);

    // Revert to original reviewed content — should NOT auto-restore reviewed
    tracker.updateReviewState(uri('f.txt'), 'v1', true);
    expect(tracker.getFileState(uri('f.txt'))!.reviewed).toBe(false);
  });

  it('markUnreviewed -> markReviewed -> edit -> revert -> back to reviewed', () => {
    writeFile('f.txt', 'v1');
    const tracker = createTracker();
    tracker.addFile(uri('f.txt'));
    tracker.markReviewed(uri('f.txt'), 'v1');

    // Explicit unmark
    tracker.markUnreviewed(uri('f.txt'));
    expect(tracker.getFileState(uri('f.txt'))!.reviewed).toBe(false);

    // Re-mark reviewed
    tracker.markReviewed(uri('f.txt'), 'v1');
    expect(tracker.getFileState(uri('f.txt'))!.reviewed).toBe(true);
    expect(tracker.getFileState(uri('f.txt'))!.hasBeenReviewed).toBe(true);

    // Edit -> revert -> should restore reviewed (user re-marked)
    tracker.updateReviewState(uri('f.txt'), 'v2', true);
    expect(tracker.getFileState(uri('f.txt'))!.reviewed).toBe(false);

    tracker.updateReviewState(uri('f.txt'), 'v1', true);
    expect(tracker.getFileState(uri('f.txt'))!.reviewed).toBe(true);
  });

  it('save handler: direct disk write + revert -> untracked (with baseline hash)', () => {
    writeFile('f.txt', 'v1');
    const tracker = createTracker();

    // Pre-cache baseline hash (simulates extension startup)
    const key = path.normalize(tmpFile('f.txt'));
    // FNV-1a hash of "v1"
    let h = 0x811c9dc5;
    for (const ch of 'v1') {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193);
    }
    const baselineHash = h >>> 0;

    // Save handler tracks file with baseline hash (original content "v1")
    tracker.addFile(uri('f.txt'), baselineHash);
    expect(tracker.getFileState(uri('f.txt'))).toBeDefined();
    expect(tracker.getFileState(uri('f.txt'))!.originalContentHash).toBe(baselineHash);

    // Save handler sees changed content
    writeFile('f.txt', 'v2');
    tracker.updateReviewState(uri('f.txt'));
    expect(tracker.getFileState(uri('f.txt'))).toBeDefined();

    // Save handler sees reverted content -> untracked
    writeFile('f.txt', 'v1');
    tracker.updateReviewState(uri('f.txt'));
    expect(tracker.getFileState(uri('f.txt'))).toBeUndefined();
  });
});
