import * as vscode from 'vscode';
import type { TreeNode } from './types';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // ── 1. Status bar ───────────────────────────────────────────────────
  const config = vscode.workspace.getConfiguration('seenIt');
  const alignment =
    config.get<string>('statusBarAlignment', 'left') === 'right'
      ? vscode.StatusBarAlignment.Right
      : vscode.StatusBarAlignment.Left;
  const priority = config.get<number>('statusBarPriority', 100);
  const statusBarItem = vscode.window.createStatusBarItem(alignment, priority);
  statusBarItem.command = 'seenIt.showOutput';
  if (config.get<boolean>('showStatusBar', true)) {
    statusBarItem.show();
  }
  context.subscriptions.push(statusBarItem);

  const outputChannel = vscode.window.createOutputChannel('Seen It');
  context.subscriptions.push(outputChannel);

  const log = (msg: string) => {
    outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
  };

  // ── 2. Core state manager ───────────────────────────────────────────
  const { ReviewTracker } = await import('./reviewTracker');
  const tracker = new ReviewTracker(context);

  // ── 3. FileSystemWatcher + FileIndex ─────────────────────────────────
  const { setupFileSystemWatcher, FileIndex } = await import('./fileWatcher');
  setupFileSystemWatcher(tracker, context);

  const fileIndex = new FileIndex();

  // ── 4. TreeViews: Unreviewed + Reviewed ─────────────────────────────
  const { ReviewTreeProvider } = await import('./reviewTreeProvider');
  const unreviewedProvider = new ReviewTreeProvider(tracker, 'unreviewed');
  const reviewedProvider = new ReviewTreeProvider(tracker, 'reviewed');

  const unreviewedView = vscode.window.createTreeView('seenItUnreviewed', {
    treeDataProvider: unreviewedProvider,
    manageCheckboxStateManually: true,
  });

  const reviewedView = vscode.window.createTreeView('seenItReviewed', {
    treeDataProvider: reviewedProvider,
    manageCheckboxStateManually: true,
  });

  // Show VS Code native loading animation while FileIndex scans
  vscode.window
    .withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Seen It — Scanning workspace files…' },
      () => fileIndex.init(context)
    )
    .then(() => {
      unreviewedProvider.refresh();
      reviewedProvider.refresh();
    });

  const collectFileUris = (node: TreeNode): vscode.Uri[] => {
    if (node.kind === 'file') {
      return [node.uri];
    }
    return node.children.flatMap(collectFileUris);
  };

  const handleCheckbox = (e: vscode.TreeCheckboxChangeEvent<TreeNode>) => {
    for (const [item, newState] of e.items) {
      const node = item as TreeNode;
      const uris = collectFileUris(node);
      for (const uri of uris) {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (newState === vscode.TreeItemCheckboxState.Checked) {
          tracker.markReviewed(uri, doc?.getText());
        } else {
          tracker.markUnreviewed(uri);
        }
      }
    }
  };

  unreviewedView.onDidChangeCheckboxState(handleCheckbox);
  reviewedView.onDidChangeCheckboxState(handleCheckbox);

  // ── 5. Action buttons webview (below Reviewed) ──────────────────────
  const { ActionView } = await import('./actionView');
  const actionView = new ActionView();
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ActionView.viewType, actionView));

  // ── 6. Badge + status bar ───────────────────────────────────────────
  const updateUI = () => {
    const count = tracker.getUnreviewedCount();
    unreviewedView.badge =
      count > 0 ? { value: count, tooltip: `${count} file${count === 1 ? '' : 's'} to review` } : undefined;

    statusBarItem.text = count > 0 ? `$(eye) Seen It: ${count} to review` : `$(eye-closed) Seen It`;
    statusBarItem.tooltip = count > 0 ? `${count} file${count === 1 ? '' : 's'} need review` : 'All files reviewed';
  };
  tracker.onDidChangeReviewState(updateUI);
  updateUI();

  // ── 7. Commands ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('seenIt.markReviewed', (uri?: vscode.Uri) => {
      if (uri) {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        tracker.markReviewed(uri, doc?.getText());
      }
    }),

    vscode.commands.registerCommand('seenIt.markUnreviewed', (uri?: vscode.Uri) => {
      if (uri) {
        tracker.markUnreviewed(uri);
      }
    }),

    vscode.commands.registerCommand('seenIt.markAllReviewed', () => {
      tracker.markAllReviewed();
    }),

    vscode.commands.registerCommand('seenIt.approveAll', async () => {
      const shouldConfirm = vscode.workspace.getConfiguration('seenIt').get<boolean>('confirmApproveAll', true);
      if (shouldConfirm) {
        const confirm = await vscode.window.showWarningMessage(
          'Approve all and clear review state? This cannot be undone.',
          { modal: true },
          'Approve All'
        );
        if (confirm !== 'Approve All') {
          return;
        }
      }
      tracker.resetAll();
    }),

    vscode.commands.registerCommand('seenIt.approveReviewed', () => {
      tracker.approveReviewed();
    }),

    vscode.commands.registerCommand('seenIt.refresh', () => {
      unreviewedProvider.refresh();
      reviewedProvider.refresh();
    }),

    vscode.commands.registerCommand('seenIt.showOutput', () => {
      outputChannel.show();
    }),

    vscode.commands.registerCommand('seenIt.diagnostic', () => {
      const files = tracker.getAllFiles();
      log(`── Diagnostic ──`);
      log(`Tracked files: ${files.length}`);
      log(`Unreviewed: ${tracker.getUnreviewedCount()}`);
      for (const f of files) {
        log(`  ${f.reviewed ? '✅' : '⏳'} ${f.uri}`);
      }
      log(`Workspace folders: ${(vscode.workspace.workspaceFolders ?? []).length}`);
      log(`─────────────────`);
      outputChannel.show();
    })
  );

  // ── 8. Config change → diff old/new rules, apply delta ─────────────────
  const nodePath = await import('path');
  const { getFilterRules, isPathTrackable } = await import('./config');

  let prevRules = getFilterRules();

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('seenIt')) {
      return;
    }

    const newRules = getFilterRules();

    // Skip if exclude/include rules didn't actually change
    const rulesChanged =
      newRules.exclude.length !== prevRules.exclude.length ||
      newRules.include.length !== prevRules.include.length ||
      newRules.exclude.some((v, i) => v !== prevRules.exclude[i]) ||
      newRules.include.some((v, i) => v !== prevRules.include[i]);

    if (!rulesChanged) {
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

    // 1. Remove tracked files that no longer pass the new rules
    const isStillTrackable = (uri: vscode.Uri): boolean => {
      for (const folder of workspaceFolders) {
        if (uri.fsPath.startsWith(folder.uri.fsPath)) {
          const relativePath = nodePath.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
          return isPathTrackable(relativePath, newRules);
        }
      }
      return false;
    };
    const removed = tracker.reevaluate(isStillTrackable);
    if (removed > 0) {
      log(`Config changed — removed ${removed} newly-excluded file(s).`);
    }

    // 2. Add files that became trackable under the new rules.
    //    Uses the in-memory FileIndex instead of walking the disk.
    let added = 0;
    for (const fullPath of fileIndex.files) {
      let relativePath: string | null = null;
      for (const folder of workspaceFolders) {
        if (fullPath.startsWith(folder.uri.fsPath)) {
          relativePath = fullPath.substring(folder.uri.fsPath.length + 1).replace(/\\/g, '/');
          break;
        }
      }
      if (relativePath === null) {
        continue;
      }

      const nowTrackable = isPathTrackable(relativePath, newRules);
      const wasTrackable = isPathTrackable(relativePath, prevRules);
      if (nowTrackable && !wasTrackable) {
        tracker.addFile(vscode.Uri.file(fullPath));
        added++;
      }
    }
    if (added > 0) {
      log(`Config changed — added ${added} newly-trackable file(s).`);
    }

    prevRules = newRules;
  });
  context.subscriptions.push(configListener);

  // ── 9. Dispose ──────────────────────────────────────────────────────
  context.subscriptions.push(unreviewedView, reviewedView);
}

export function deactivate(): void {}
