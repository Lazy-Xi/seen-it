import * as vscode from 'vscode';

/**
 * Review state for a single file.
 */
export interface FileReviewState {
  /** vscode.Uri.toString() — canonical key */
  uri: string;
  /** Whether the file has been reviewed since last modification */
  reviewed: boolean;
  /** Timestamp of last detected modification */
  lastModified: number;
  /** Timestamp when user marked as reviewed (undefined if not yet reviewed) */
  reviewedAt?: number;
}

/**
 * Tree node types used by ReviewTreeProvider.
 */
export type TreeNode = DirectoryNode | FileNode;

export interface DirectoryNode {
  kind: 'directory';
  label: string;
  path: string;
  children: TreeNode[];
  /** Relative path from workspace root */
  relativePath: string;
}

export interface FileNode {
  kind: 'file';
  label: string;
  uri: vscode.Uri;
  state: FileReviewState;
  /** Relative path from workspace root */
  relativePath: string;
}

