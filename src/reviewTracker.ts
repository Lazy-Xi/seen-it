import * as vscode from 'vscode';
import * as path from 'path';
import { FileReviewState } from './types';

const STORAGE_KEY = 'seenIt.fileReviews';

/**
 * Normalize a URI to a consistent string key.
 * Uses fsPath to avoid encoding mismatches (e.g. Windows drive letter casing).
 */
function normalizeKey(uri: vscode.Uri): string {
  return path.normalize(uri.fsPath);
}

/**
 * Core state manager for file review tracking.
 * Maintains an in-memory map and persists to workspaceState.
 */
export class ReviewTracker {
  private _files: Map<string, FileReviewState> = new Map();
  private _onDidChangeReviewState = new vscode.EventEmitter<void>();
  public readonly onDidChangeReviewState = this._onDidChangeReviewState.event;

  constructor(private context: vscode.ExtensionContext) {
    this._restore();
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Mark a file as needing review.
   * If already tracked and unreviewed, only updates timestamp (no event).
   * If already tracked and reviewed, resets to unreviewed.
   * @param forceNotify Always fire the change event even if state is unchanged.
   */
  markNeedsReview(uri: vscode.Uri, forceNotify = false): void {
    const key = normalizeKey(uri);
    const existing = this._files.get(key);

    if (existing) {
      if (!existing.reviewed) {
        existing.lastModified = Date.now();
        if (forceNotify) {
          this._persist();
          this._onDidChangeReviewState.fire();
        }
        return;
      }
      // Was reviewed, now modified again — reset to unreviewed
      existing.reviewed = false;
      existing.lastModified = Date.now();
      existing.reviewedAt = undefined;
    } else {
      // New file
      this._files.set(key, {
        uri: key,
        reviewed: false,
        lastModified: Date.now(),
      });
    }

    this._persist();
    this._onDidChangeReviewState.fire();
  }

  /**
   * Mark a file as reviewed.
   */
  markReviewed(uri: vscode.Uri): void {
    const key = normalizeKey(uri);
    const existing = this._files.get(key);

    if (existing) {
      existing.reviewed = true;
      existing.reviewedAt = Date.now();
      this._persist();
      this._onDidChangeReviewState.fire();
    }
  }

  /**
   * Mark a file as unreviewed (revert review).
   */
  markUnreviewed(uri: vscode.Uri): void {
    const key = normalizeKey(uri);
    const existing = this._files.get(key);

    if (existing) {
      existing.reviewed = false;
      existing.reviewedAt = undefined;
      this._persist();
      this._onDidChangeReviewState.fire();
    }
  }

  /**
   * Mark all tracked files as reviewed.
   */
  markAllReviewed(): void {
    const now = Date.now();
    for (const state of this._files.values()) {
      state.reviewed = true;
      state.reviewedAt = now;
    }
    this._persist();
    this._onDidChangeReviewState.fire();
  }

  /**
   * Clear all review state.
   */
  resetAll(): void {
    this._files.clear();
    this._persist();
    this._onDidChangeReviewState.fire();
  }

  /**
   * Remove all reviewed files from tracking.
   * Keeps unreviewed files intact.
   */
  approveReviewed(): void {
    for (const [key, state] of this._files) {
      if (state.reviewed) {
        this._files.delete(key);
      }
    }
    this._persist();
    this._onDidChangeReviewState.fire();
  }

  /**
   * Remove a file from tracking (e.g., when deleted).
   */
  removeFile(uri: vscode.Uri): void {
    const key = normalizeKey(uri);
    if (this._files.delete(key)) {
      this._persist();
      this._onDidChangeReviewState.fire();
    }
  }

  /**
   * Re-evaluate all tracked files against a predicate.
   * Removes files that no longer pass (e.g. after config change).
   * @returns number of files removed
   */
  reevaluate(predicate: (uri: vscode.Uri) => boolean): number {
    let removed = 0;
    for (const [key] of this._files) {
      if (!predicate(vscode.Uri.file(key))) {
        this._files.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      this._persist();
      this._onDidChangeReviewState.fire();
    }
    return removed;
  }

  /**
   * Get all tracked file states.
   */
  getAllFiles(): FileReviewState[] {
    return Array.from(this._files.values());
  }

  /**
   * Get only unreviewed files.
   */
  getUnreviewedFiles(): FileReviewState[] {
    return this.getAllFiles().filter((f) => !f.reviewed);
  }

  /**
   * Get count of unreviewed files.
   */
  getUnreviewedCount(): number {
    return this.getUnreviewedFiles().length;
  }

  /**
   * Get review state for a specific file.
   * Uses fsPath for lookup to avoid URI encoding mismatches across platforms.
   */
  getFileState(uri: vscode.Uri): FileReviewState | undefined {
    return this._files.get(normalizeKey(uri));
  }

  /**
   * Fire the change event without modifying any state.
   * Used to notify listeners after batch removals that don't go through
   * markReviewed/markNeedsReview.
   */
  forceNotify(): void {
    this._onDidChangeReviewState.fire();
  }

  // ── Private ─────────────────────────────────────────────────────────

  private _restore(): void {
    const stored = this.context.workspaceState.get<Record<string, FileReviewState>>(STORAGE_KEY);
    if (stored) {
      for (const [key, value] of Object.entries(stored)) {
        this._files.set(key, value);
      }
    }
  }

  private _persist(): void {
    const obj: Record<string, FileReviewState> = {};
    for (const [key, value] of this._files) {
      obj[key] = value;
    }
    this.context.workspaceState.update(STORAGE_KEY, obj);
  }
}
