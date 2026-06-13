import * as vscode from 'vscode';

/**
 * Review state for a single file.
 * Tracks content hashes for change detection.
 * Uses dual-baseline design for undo detection.
 *
 * State machine:
 *   untracked  →  toReview   (on save, content differs from baseline)
 *   toReview   →  reviewed   (user marks reviewed / content matches baseline)
 *   toReview   →  untracked  (content reverts to baseline, for files never reviewed)
 *   reviewed   →  toReview   (content changes from reviewed baseline)
 *   reviewed   →  approved   (user approves)
 *   approved   →  toReview   (content changes from approved baseline)
 *   approved   →  reviewed   (user marks reviewed)
 *
 * Encoded as:
 *   toReview  = { reviewed: false, approved: false }
 *   reviewed  = { reviewed: true,  approved: false }
 *   approved  = { reviewed: true,  approved: true  }
 */
export interface FileReviewState {
  uri: string;
  reviewed: boolean;
  lastModified: number;
  reviewedAt?: number;
  /** Content hash when file was marked reviewed (updated on save/review) */
  reviewedContentHash?: number;
  /** Content hash at original tracking time (immutable baseline for revert detection) */
  originalContentHash?: number;
  /** Whether the file has been approved (hidden from tree views) */
  approved?: boolean;
  /** Whether the file has ever been explicitly marked as reviewed by the user */
  hasBeenReviewed?: boolean;
}

export type TreeNode = DirectoryNode | FileNode;

export interface DirectoryNode {
  kind: 'directory';
  label: string;
  path: string;
  children: TreeNode[];
  relativePath: string;
}

export interface FileNode {
  kind: 'file';
  label: string;
  uri: vscode.Uri;
  state: FileReviewState;
  relativePath: string;
}
