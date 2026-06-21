import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getFilterRules, isPathTrackable } from './config';
import { log } from './extension';
import type { ReviewTracker } from './reviewTracker';
import type { FileReviewState } from './types';

// ── File Index ──────────────────────────────────────────────────────

/**
 * In-memory index of all workspace files.
 * Built once on activation via a full directory walk, then kept in sync
 * incrementally through FileSystemWatcher events.
 *
 * Purpose: avoid repeated `readdirSync` walks when config changes —
 * the config handler can iterate this set instead of hitting the disk.
 */
export class FileIndex {
  private _files: Set<string> = new Set();
  private _disposables: vscode.Disposable[] = [];

  /**
   * Initial full scan + FileSystemWatcher setup.
   * Must be called once during activation.
   * Returns a Promise that resolves when the initial scan is complete.
   */
  async init(context: vscode.ExtensionContext): Promise<void> {
    this._watch(context);
    await this._scanAll();
  }

  /** All indexed file paths (absolute, normalized). */
  get files(): IterableIterator<string> {
    return this._files.values();
  }

  /** Number of indexed files. */
  get size(): number {
    return this._files.size;
  }

  private async _scanAll(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      await this._walk(folder.uri.fsPath);
    }
  }

  /**
   * Recursively walk a directory, adding files to the index.
   * Does NOT apply user exclude/include rules — the index is a complete
   * path cache so that config changes can find files in previously-excluded
   * directories (e.g. .vscode). Filtering is done at tracking time.
   *
   * Only skips directories that are never useful for review tracking
   * (.git, node_modules) to keep the scan fast on large projects.
   * Uses async I/O to avoid blocking the event loop.
   */
  private static readonly SKIP_DIRS = new Set(['.git', 'node_modules']);

  private async _walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (FileIndex.SKIP_DIRS.has(entry.name)) {
          continue;
        }
        await this._walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        this._files.add(path.join(dir, entry.name));
      }
    }
  }

  /** Incremental sync via FileSystemWatcher. */
  private _watch(context: vscode.ExtensionContext): void {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');

    watcher.onDidCreate((uri) => {
      fs.promises.stat(uri.fsPath).then(
        (stat) => {
          if (stat.isFile()) {
            this._files.add(uri.fsPath);
          }
        },
        () => {
          /* deleted between event and stat */
        }
      );
    });

    watcher.onDidDelete((uri) => {
      this._files.delete(uri.fsPath);
    });

    const renameListener = vscode.workspace.onDidRenameFiles((e) => {
      for (const { oldUri, newUri } of e.files) {
        this._files.delete(oldUri.fsPath);
        fs.promises.stat(newUri.fsPath).then(
          (stat) => {
            if (stat.isFile()) {
              this._files.add(newUri.fsPath);
            }
          },
          () => {
            /* deleted between event and stat */
          }
        );
      }
    });

    this._disposables.push(watcher, renameListener);
    context.subscriptions.push({ dispose: () => this.dispose() });
  }

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}

// ── File System Watcher ─────────────────────────────────────────────

/**
 * Set up comprehensive file system watching.
 * Uses multiple strategies to catch all file changes.
 */
export function setupFileSystemWatcher(
  tracker: ReviewTracker,
  context: vscode.ExtensionContext,
  baselineHashes?: Map<string, number>
): void {
  log('[FileWatcher] Setting up file system watchers...');

  // Track recently deleted files to distinguish atomic saves from genuine deletes.
  // Atomic save = delete + create in quick succession.
  const recentlyDeleted = new Map<string, { entry: FileReviewState; timer: ReturnType<typeof setTimeout> }>();

  context.subscriptions.push({
    dispose() {
      for (const d of recentlyDeleted.values()) {
        clearTimeout(d.timer);
      }
      recentlyDeleted.clear();
    },
  });

  // ── FileSystemWatcher: handles saves, external changes, AI agent edits ──
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');

  watcher.onDidChange((uri) => {
    if (!isTrackableFile(uri) || tracker.isRecentlyUntracked(uri)) {
      return;
    }
    const state = tracker.getFileState(uri);
    if (state) {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      const content = doc && doc.isDirty ? doc.getText() : undefined;
      tracker.updateReviewState(uri, content);
    } else {
      const key = path.normalize(uri.fsPath);
      const baselineHash = baselineHashes?.get(key);
      tracker.addFile(uri, baselineHash);
    }
  });

  watcher.onDidCreate((uri) => {
    if (!isTrackableFile(uri) || tracker.isRecentlyUntracked(uri)) {
      return;
    }
    const key = path.normalize(uri.fsPath);
    const deleted = recentlyDeleted.get(key);

    if (deleted) {
      clearTimeout(deleted.timer);
      recentlyDeleted.delete(key);
      log(`[FileWatcher] Atomic save restored: ${uri.fsPath}`);
      tracker.restoreFile(deleted.entry);
    } else {
      tracker.addFile(uri);
    }
  });

  watcher.onDidDelete((uri) => {
    const entry = tracker.removeFile(uri);
    const key = path.normalize(uri.fsPath);

    if (entry) {
      const timer = setTimeout(() => {
        recentlyDeleted.delete(key);
      }, 2000);
      recentlyDeleted.set(key, { entry, timer });
    }
  });

  // ── VS Code file operation events ──────────────────────────────────
  const createListener = vscode.workspace.onDidCreateFiles((e) => {
    for (const uri of e.files) {
      if (!isTrackableFile(uri) || tracker.isRecentlyUntracked(uri)) {
        continue;
      }
      const key = path.normalize(uri.fsPath);
      const deleted = recentlyDeleted.get(key);

      if (deleted) {
        clearTimeout(deleted.timer);
        recentlyDeleted.delete(key);
        log(`[FileWatcher] Atomic save restored (bulk): ${uri.fsPath}`);
        tracker.restoreFile(deleted.entry);
      } else {
        tracker.addFile(uri);
      }
    }
  });

  const deleteListener = vscode.workspace.onDidDeleteFiles((e) => {
    for (const uri of e.files) {
      if (!isTrackableFile(uri)) {
        continue;
      }
      const entry = tracker.removeFile(uri);
      const key = path.normalize(uri.fsPath);

      if (entry) {
        const timer = setTimeout(() => {
          recentlyDeleted.delete(key);
        }, 2000);
        recentlyDeleted.set(key, { entry, timer });
      }
    }
  });

  const renameListener = vscode.workspace.onDidRenameFiles((e) => {
    for (const { oldUri, newUri } of e.files) {
      log(`[FileWatcher] onDidRenameFiles: ${oldUri.fsPath} -> ${newUri.fsPath}`);
      tracker.removeFile(oldUri);
      if (isTrackableFile(newUri)) {
        tracker.addFile(newUri);
      }
    }
  });

  // ── Strategy 4: In-memory text changes (before save) ───────────────
  const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
    if (isTrackableFile(e.document.uri)) {
      tracker.updateReviewState(e.document.uri, e.document.getText(), true);
    }
  });

  context.subscriptions.push(watcher, createListener, deleteListener, renameListener, changeListener);
  log('[FileWatcher] All watchers registered.');
}

/**
 * Check if a URI should be tracked for review.
 * Must be a file (not a directory) inside a workspace folder.
 */
export function isTrackableFile(uri: vscode.Uri): boolean {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return false;
  }

  // Reject directories — FileSystemWatcher fires for both files and dirs
  try {
    const stat = fs.statSync(uri.fsPath);
    if (!stat.isFile()) {
      return false;
    }
  } catch {
    // File doesn't exist (e.g. deleted) — not trackable
    return false;
  }

  const relativePath = uri.fsPath.substring(workspaceFolder.uri.fsPath.length + 1);
  const rules = getFilterRules();
  return isPathTrackable(relativePath, rules);
}
