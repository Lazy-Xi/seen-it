import * as path from 'path';
import * as vscode from 'vscode';
import { getFilterRules, isPathTrackable } from './config';
import { ReviewTracker } from './reviewTracker';
import { DirectoryNode, FileNode, FileReviewState, TreeNode } from './types';

export type ReviewFilter = 'unreviewed' | 'reviewed';

export class ReviewTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private tracker: ReviewTracker,
    private filter: ReviewFilter
  ) {
    this.tracker.onDidChangeReviewState(() => this._debouncedRefresh());
  }

  private _debouncedRefresh(): void {
    if (this._refreshTimer !== undefined) {
      clearTimeout(this._refreshTimer);
    }
    const delay = vscode.workspace.getConfiguration('seenIt').get<number>('debounceMs', 50);
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = undefined;
      this._onDidChangeTreeData.fire();
    }, delay);
  }

  refresh(): void {
    if (this._refreshTimer !== undefined) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = undefined;
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === 'directory') {
      return this._getDirectoryItem(element);
    }
    return this._getFileItem(element);
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this._buildTree();
    }
    if (element.kind === 'directory') {
      return element.children;
    }
    return [];
  }

  private _buildTree(): TreeNode[] {
    const allFiles = this.tracker.getAllFiles();
    const rules = getFilterRules();
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const filtered = allFiles.filter((f) => {
      // Hide approved files from both views
      if (f.approved) {
        return false;
      }
      // Filter by review state
      if (this.filter === 'unreviewed' ? f.reviewed : !f.reviewed) {
        return false;
      }
      // Filter by current exclude/include rules
      const uri = vscode.Uri.file(f.uri);
      const folder = workspaceFolders.find((ws) => uri.fsPath.startsWith(ws.uri.fsPath));
      if (!folder) {
        return false;
      }
      const relativePath = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
      return isPathTrackable(relativePath, rules);
    });
    if (filtered.length === 0) {
      return [];
    }
    return this._sortNodes(this._buildDirectoryTree(filtered));
  }

  private _buildDirectoryTree(files: FileReviewState[]): TreeNode[] {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const topGroups: Map<string, DirectoryNode> = new Map();

    for (const fileState of files) {
      const uri = vscode.Uri.file(fileState.uri);
      const folder = workspaceFolders.find((f) => uri.fsPath.startsWith(f.uri.fsPath));
      const folderPath = folder?.uri.fsPath ?? '';
      // Normalize separators to platform-native
      const relativePath = path.normalize(folder ? path.relative(folderPath, uri.fsPath) : uri.fsPath);
      const folderLabel = folder?.name ?? 'Unknown';

      let wsGroup = topGroups.get(folderLabel);
      if (!wsGroup) {
        wsGroup = {
          kind: 'directory',
          label: folderLabel,
          path: folderPath,
          relativePath: '',
          children: [],
        };
        topGroups.set(folderLabel, wsGroup);
      }

      const segments = relativePath.split(path.sep).filter((s) => s.length > 0);
      this._insertIntoTree(wsGroup, segments, uri, fileState);
    }

    if (topGroups.size === 1) {
      return topGroups.values().next().value!.children;
    }
    return Array.from(topGroups.values());
  }

  private _insertIntoTree(parent: DirectoryNode, segments: string[], uri: vscode.Uri, state: FileReviewState): void {
    if (segments.length === 0) {
      return;
    }

    if (segments.length === 1) {
      parent.children.push({
        kind: 'file',
        label: segments[0],
        uri,
        state,
        relativePath: segments[0],
      });
      return;
    }

    const dirName = segments[0];
    let childDir = parent.children.find((n) => n.kind === 'directory' && n.label === dirName) as
      | DirectoryNode
      | undefined;

    if (!childDir) {
      childDir = {
        kind: 'directory',
        label: dirName,
        path: path.join(parent.path, dirName),
        relativePath: path.join(parent.relativePath, dirName),
        children: [],
      };
      parent.children.push(childDir);
    }

    this._insertIntoTree(childDir, segments.slice(1), uri, state);
  }

  private _sortNodes(nodes: TreeNode[]): TreeNode[] {
    const dirs = nodes
      .filter((n): n is DirectoryNode => n.kind === 'directory')
      .sort((a, b) => a.label.localeCompare(b.label));
    const files = nodes.filter((n): n is FileNode => n.kind === 'file').sort((a, b) => a.label.localeCompare(b.label));

    for (const dir of dirs) {
      dir.children = this._sortNodes(dir.children);
    }

    return [...dirs, ...files];
  }

  private _getDirectoryItem(node: DirectoryNode): vscode.TreeItem {
    const unreviewedCount = this._countUnreviewed(node);
    const totalCount = this._countFiles(node);

    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    item.iconPath = vscode.ThemeIcon.Folder;
    item.description = `${totalCount} file(s)`;
    item.contextValue = 'directory';

    // Checkbox: checked if all children reviewed, unchecked otherwise
    if (totalCount > 0 && unreviewedCount === 0) {
      item.checkboxState = vscode.TreeItemCheckboxState.Checked;
    } else {
      item.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
    }

    return item;
  }

  private _getFileItem(node: FileNode): vscode.TreeItem {
    const isReviewed = node.state.reviewed;
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);

    item.checkboxState = isReviewed ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;

    item.resourceUri = node.uri;
    item.contextValue = isReviewed ? 'reviewedFile' : 'unreviewedFile';

    const modTime = new Date(node.state.lastModified);
    item.description = this._formatTime(modTime);

    const statusText = isReviewed ? '✅ Reviewed' : '⏳ Needs Review';
    const reviewedAtText = node.state.reviewedAt
      ? `\nReviewed: ${new Date(node.state.reviewedAt).toLocaleString()}`
      : '';
    item.tooltip = new vscode.MarkdownString(
      `**${node.label}**\n\nStatus: ${statusText}\nModified: ${modTime.toLocaleString()}${reviewedAtText}\n\nPath: \`${node.uri.fsPath}\``
    );

    item.command = { command: 'vscode.open', title: 'Open File', arguments: [node.uri] };
    return item;
  }

  private _countFiles(node: DirectoryNode): number {
    let count = 0;
    for (const child of node.children) {
      if (child.kind === 'file') count++;
      else count += this._countFiles(child);
    }
    return count;
  }

  private _countUnreviewed(node: DirectoryNode): number {
    let count = 0;
    for (const child of node.children) {
      if (child.kind === 'file') {
        if (!child.state.reviewed) count++;
      } else {
        count += this._countUnreviewed(child);
      }
    }
    return count;
  }

  private _formatTime(date: Date): string {
    const diff = Date.now() - date.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
}
