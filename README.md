# Seen It - File Review Tracker

[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/Lazy-Xi.seen-it.png?style=flat-square&color=blue&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=Lazy-Xi.seen-it)
[![Installs](https://vsmarketplacebadges.dev/installs-short/Lazy-Xi.seen-it.png?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=Lazy-Xi.seen-it)
[![Rating](https://vsmarketplacebadges.dev/rating-short/Lazy-Xi.seen-it.png?style=flat-square&color=orange)](https://marketplace.visualstudio.com/items?itemName=Lazy-Xi.seen-it)

> Track file changes and require review before proceeding.

**Seen It** is a VS Code extension that helps developers track which files in their workspace have changed and whether those changes have been reviewed. It provides a built-in code review checklist in the VS Code sidebar, ensuring no modified file goes unexamined before committing, opening a PR, or handing off work.

---

## Features

- **Automatic change detection** — Captures file modifications, creations, deletions, and renames in real time via multiple overlapping VS Code APIs, including in-memory dirty-buffer edits before save.
- **Dual sidebar tree views** — "To Review" and "Reviewed" lists with hierarchical directory structure and checkbox-based bulk operations.
- **Status bar indicator** — Shows `Seen It: N to review` when there are pending files; click to open the output log.
- **Bulk action commands** — Mark All as Reviewed, Approve All, and Approve Reviewed for quick workflow transitions.
- **Configurable file filtering** — Glob-based `exclude`/`include` rules with ~170 built-in defaults covering 20+ ecosystems (see [`src/builtin-excludes.json`](src/builtin-excludes.json)). Supports user-level and project-level settings.
- **Persistent state** — Review state survives VS Code restarts via `workspaceState`.
- **Zero runtime dependencies** — Relies only on the VS Code API. The `.vsix` package stays lightweight.

## Usage

1. Install the extension from a `.vsix` file or the marketplace.
2. Open a workspace folder — Seen It activates automatically and starts tracking files.
3. The sidebar shows two views under the **Seen It** panel:
   - **To Review** — files that have changed but haven't been reviewed yet.
   - **Reviewed** — files you've marked as reviewed.
4. Check/uncheck files (or entire directories) to mark them as reviewed.
5. Use the **Actions** panel at the bottom for bulk operations.
6. The status bar shows how many files are still pending review.

## Commands

| Command                         | Description                               |
| ------------------------------- | ----------------------------------------- |
| `Seen It: Mark as Reviewed`     | Mark selected file(s) as reviewed         |
| `Seen It: Mark as Unreviewed`   | Mark selected file(s) as unreviewed       |
| `Seen It: Mark All as Reviewed` | Mark every tracked file as reviewed       |
| `Seen It: Approve All`          | Clear all review state entirely           |
| `Seen It: Approve Reviewed`     | Remove only reviewed files from tracking  |
| `Seen It: Refresh`              | Manually refresh the file index           |
| `Seen It: Show Output Log`      | Open the diagnostic output channel        |
| `Seen It: Run Diagnostic`       | Dump tracked file inventory for debugging |

## Configuration

| Setting                     | Type                | Default  | Description                                                                                         |
| --------------------------- | ------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `seenIt.exclude`            | `string[]`          | `[]`     | Additional glob patterns to exclude from tracking. Merged with built-in defaults.                   |
| `seenIt.include`            | `string[]`          | `[]`     | Glob patterns to include despite being excluded. Overrides both built-in and user exclude patterns. |
| `seenIt.showStatusBar`      | `boolean`           | `true`   | Show the status bar indicator.                                                                      |
| `seenIt.statusBarAlignment` | `"left" \| "right"` | `"left"` | Alignment of the status bar item.                                                                   |
| `seenIt.statusBarPriority`  | `number`            | `100`    | Position priority of the status bar item.                                                           |
| `seenIt.debounceMs`         | `number`            | `50`     | Debounce delay (ms) before refreshing the tree after a state change.                                |
| `seenIt.confirmApproveAll`  | `boolean`           | `true`   | Show a confirmation dialog before executing "Approve All".                                          |

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Platform:** VS Code Extension API (`^1.120.0`)
- **Build:** esbuild (ESM, code splitting, minified)
- **Package manager:** pnpm

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Watch mode
pnpm run watch

# Type check
pnpm run lint

# Package .vsix
pnpm run package
```

## License

MIT
