import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FileReviewState } from './types';
import { log } from './extension';

const STORAGE_KEY = 'seenIt.fileReviews';

function normalizeKey(uri: vscode.Uri): string {
  return path.normalize(uri.fsPath);
}

function hashContent(content: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function readContentHash(filePath: string): number | undefined {
  try {
    return hashContent(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

export class ReviewTracker {
  private _files: Map<string, FileReviewState> = new Map();
  private _onDidChangeReviewState = new vscode.EventEmitter<void>();
  public readonly onDidChangeReviewState = this._onDidChangeReviewState.event;

  constructor(private context: vscode.ExtensionContext) {
    this._restore();
  }

  // ── State machine ───────────────────────────────────────────────────

  /**
   * State transition for a tracked file, or add a new file if allowNew.
   *
   * Dual-baseline design:
   *  - originalContentHash: immutable, set at tracking time. Used to detect
   *    "reverted all the way back" for files that were never reviewed.
   *  - reviewedContentHash: updated on save (for revert detection). Used to detect
   *    "reverted to last saved state".
   *  - hasBeenReviewed: set only on explicit user review.
   */
  updateReviewState(uri: vscode.Uri, documentContent?: string, allowNew = false): void {
    const key = normalizeKey(uri);
    const existing = this._files.get(key);
    const contentLength = documentContent?.length ?? 0;

    log(`[ReviewTracker] updateReviewState: ${key}`);
    log(`  - allowNew=${allowNew} | existing=${!!existing} | contentLength=${contentLength}`);

    if (existing) {
      const currentHash = documentContent !== undefined ? hashContent(documentContent) : readContentHash(key);
      log(`  - currentHash=${currentHash} | reviewedContentHash=${existing.reviewedContentHash} | originalContentHash=${existing.originalContentHash}`);
      log(`  - state: reviewed=${existing.reviewed} | approved=${existing.approved} | hasBeenReviewed=${existing.hasBeenReviewed}`);

      if (this._transition(key, existing, currentHash, !allowNew)) {
        log(`  - State CHANGED → persisting and firing event`);
        this._persist();
        this._onDidChangeReviewState.fire();
      } else {
        log(`  - State UNCHANGED`);
      }
    } else if (allowNew) {
      const diskHash = readContentHash(key);
      if (diskHash === undefined) {
        log(`  - Disk read failed, skipping`);
        return;
      }
      const contentHash = documentContent !== undefined ? hashContent(documentContent) : diskHash;
      log(`  - New file: diskHash=${diskHash} | contentHash=${contentHash}`);

      if (contentHash === diskHash) {
        log(`  - Content matches disk, not tracking`);
        return;
      }
      log(`  - Adding to tracking as toReview`);
      this._files.set(key, {
        uri: key,
        reviewed: false,
        lastModified: Date.now(),
        reviewedContentHash: diskHash,
        originalContentHash: diskHash,
      });
      this._persist();
      this._onDidChangeReviewState.fire();
    }
  }

  /**
   * Add a new file to tracking (untracked → toReview).
   * Used by file creation events (onDidCreateFiles, rename).
   */
  addFile(uri: vscode.Uri): void {
    const key = normalizeKey(uri);
    if (this._files.has(key)) {
      log(`[ReviewTracker] addFile: ${key} | already tracked, skipping`);
      return;
    }

    const currentHash = readContentHash(key);
    if (currentHash === undefined) {
      log(`[ReviewTracker] addFile: ${key} | disk read failed, skipping`);
      return;
    }

    log(`[ReviewTracker] addFile: ${key} | hash=${currentHash} → adding as toReview`);
    this._files.set(key, {
      uri: key,
      reviewed: false,
      lastModified: Date.now(),
      reviewedContentHash: currentHash,
      originalContentHash: currentHash,
    });
    this._persist();
    this._onDidChangeReviewState.fire();
  }

  /**
   * Core state transition. Returns true if state changed.
   *
   * @param key Normalized file key
   * @param entry The file state entry (mutated in place)
   * @param currentHash Current content hash
   * @param isSave true from save handler, false from dirty handler
   */
  private _transition(key: string, entry: FileReviewState, currentHash: number | undefined, isSave: boolean): boolean {
    if (currentHash === undefined) {
      log(`[ReviewTracker] _transition: ${key} | currentHash=undefined → false`);
      return false;
    }

    const isApproved = entry.approved === true;
    const isReviewed = entry.reviewed === true && !isApproved;
    const matchesReviewed = currentHash === entry.reviewedContentHash;
    const matchesOriginal = entry.originalContentHash !== undefined && currentHash === entry.originalContentHash;

    log(`[ReviewTracker] _transition: ${key}`);
    log(`  - isSave=${isSave} | isApproved=${isApproved} | isReviewed=${isReviewed}`);
    log(`  - currentHash=${currentHash} | matchesReviewed=${matchesReviewed} | matchesOriginal=${matchesOriginal}`);

    // ── approved ──────────────────────────────────────────────────────
    if (isApproved) {
      if (matchesReviewed) {
        log(`  - [approved] matchesReviewed → false (no change)`);
        return false;
      }
      if (matchesOriginal) {
        log(`  - [approved] matchesOriginal → update reviewedContentHash, stay approved`);
        entry.reviewedContentHash = currentHash;
        return true;
      }
      log(`  - [approved] !matches → toReview (approved=false, reviewed=false)`);
      entry.approved = false;
      entry.reviewed = false;
      entry.lastModified = Date.now();
      entry.reviewedAt = undefined;
      return true;
    }

    // ── reviewed ──────────────────────────────────────────────────────
    if (isReviewed) {
      if (matchesReviewed) {
        log(`  - [reviewed] matchesReviewed → false (no change)`);
        return false;
      }
      log(`  - [reviewed] !matchesReviewed → toReview (reviewed=false)`);
      entry.reviewed = false;
      entry.lastModified = Date.now();
      entry.reviewedAt = undefined;
      return true;
    }

    // ── toReview ──────────────────────────────────────────────────────
    log(`  - [toReview] Checking transitions...`);

    if (matchesReviewed) {
      if (matchesOriginal && !entry.hasBeenReviewed) {
        log(`  - [toReview] matchesReviewed + matchesOriginal + !hasBeenReviewed → untracked`);
        this._files.delete(key);
        return true;
      }
      if (!isSave) {
        log(`  - [toReview] matchesReviewed + !isSave → reviewed`);
        entry.reviewed = true;
        entry.reviewedAt = Date.now();
        return true;
      }
      log(`  - [toReview] matchesReviewed + isSave → stay in toReview`);
      entry.lastModified = Date.now();
      return true;
    }

    if (matchesOriginal) {
      if (entry.hasBeenReviewed) {
        log(`  - [toReview] matchesOriginal + hasBeenReviewed → no change`);
        return false;
      }
      log(`  - [toReview] matchesOriginal + !hasBeenReviewed → untracked (delete)`);
      this._files.delete(key);
      return true;
    }

    if (isSave) {
      log(`  - [toReview] !matches + isSave → update lastModified`);
      entry.lastModified = Date.now();
      return true;
    }

    log(`  - [toReview] !matches + !isSave → update lastModified only (false)`);
    entry.lastModified = Date.now();
    return false;
  }

  // ── Public API ──────────────────────────────────────────────────────

  markReviewed(uri: vscode.Uri, documentContent?: string): void {
    const key = normalizeKey(uri);
    const entry = this._files.get(key);
    if (entry) {
      entry.reviewed = true;
      entry.approved = false;
      entry.reviewedAt = Date.now();
      entry.hasBeenReviewed = true;
      const contentHash = documentContent !== undefined ? hashContent(documentContent) : readContentHash(key);
      entry.reviewedContentHash = contentHash ?? entry.reviewedContentHash;
      this._persist();
      this._onDidChangeReviewState.fire();
    }
  }

  markUnreviewed(uri: vscode.Uri): void {
    const key = normalizeKey(uri);
    const entry = this._files.get(key);
    if (entry) {
      entry.reviewed = false;
      entry.approved = false;
      entry.reviewedAt = undefined;
      this._persist();
      this._onDidChangeReviewState.fire();
    }
  }

  markAllReviewed(): void {
    const now = Date.now();
    const openDocs = new Map(vscode.workspace.textDocuments.map((d) => [d.uri.toString(), d]));
    for (const [key, entry] of this._files) {
      if (entry.approved) {
        continue;
      }
      entry.reviewed = true;
      entry.reviewedAt = now;
      entry.hasBeenReviewed = true;
      const doc = openDocs.get(vscode.Uri.file(key).toString());
      const contentHash = doc ? hashContent(doc.getText()) : readContentHash(key);
      entry.reviewedContentHash = contentHash ?? entry.reviewedContentHash;
    }
    this._persist();
    this._onDidChangeReviewState.fire();
  }

  approveReviewed(): void {
    for (const entry of this._files.values()) {
      if (entry.reviewed && !entry.approved) {
        entry.approved = true;
        entry.hasBeenReviewed = false;
      }
    }
    this._persist();
    this._onDidChangeReviewState.fire();
  }

  resetAll(): void {
    this._files.clear();
    this._persist();
    this._onDidChangeReviewState.fire();
  }

  removeFile(uri: vscode.Uri): FileReviewState | undefined {
    const key = normalizeKey(uri);
    const entry = this._files.get(key);
    log(`[ReviewTracker] removeFile: ${key} | wasTracked=${!!entry}`);

    if (entry && this._files.delete(key)) {
      this._persist();
      this._onDidChangeReviewState.fire();
      return entry;
    }
    return undefined;
  }

  restoreFile(entry: FileReviewState): void {
    const key = entry.uri; // uri field stores the normalized key
    log(`[ReviewTracker] restoreFile: ${key} | alreadyExists=${this._files.has(key)}`);

    if (this._files.has(key)) {
      return;
    }
    this._files.set(key, entry);
    this._persist();
    this._onDidChangeReviewState.fire();
  }

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

  getAllFiles(): FileReviewState[] {
    return Array.from(this._files.values());
  }

  getUnreviewedFiles(): FileReviewState[] {
    return this.getAllFiles().filter((f) => !f.reviewed && !f.approved);
  }

  getUnreviewedCount(): number {
    return this.getUnreviewedFiles().length;
  }

  getFileState(uri: vscode.Uri): FileReviewState | undefined {
    return this._files.get(normalizeKey(uri));
  }

  // ── Persistence ─────────────────────────────────────────────────────

  private _restore(): void {
    const stored = this.context.workspaceState.get<Record<string, FileReviewState>>(STORAGE_KEY);
    if (stored) {
      for (const [key, value] of Object.entries(stored)) {
        value.hasBeenReviewed = false;
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
