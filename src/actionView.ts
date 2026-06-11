import * as vscode from 'vscode';

/**
 * WebviewView with action buttons. Placed below the Reviewed TreeView.
 */
export class ActionView implements vscode.WebviewViewProvider {
  public static readonly viewType = 'seenItActions';

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'refresh':
          vscode.commands.executeCommand('seenIt.refresh');
          break;
        case 'markAll':
          vscode.commands.executeCommand('seenIt.markAllReviewed');
          break;
        case 'approveAll':
          vscode.commands.executeCommand('seenIt.approveAll');
          break;
        case 'approveReviewed':
          vscode.commands.executeCommand('seenIt.approveReviewed');
          break;
      }
    });
  }

  private _getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    html, body {
      margin:0; padding:0;
      overflow:hidden;
    }
    body {
      font-family:var(--vscode-font-family);
      font-size:12px;
      padding:6px 8px;
      display:flex; flex-direction:column; gap:4px;
    }
    .btn {
      display:flex; align-items:center; justify-content:center; gap:5px;
      width:100%; padding:5px 0;
      color:var(--vscode-button-foreground);
      background:var(--vscode-button-background);
      border:none; border-radius:2px; cursor:pointer;
      font-family:var(--vscode-font-family); font-size:12px;
    }
    .btn:hover { background:var(--vscode-button-hoverBackground); }
    .btn:active { opacity:0.8; }
    .btn.secondary {
      color:var(--vscode-secondaryButton-foreground, var(--vscode-button-foreground));
      background:var(--vscode-secondaryButton-background, var(--vscode-button-background));
    }
    .btn.secondary:hover {
      background:var(--vscode-secondaryButton-hoverBackground, var(--vscode-button-hoverBackground));
    }
  </style>
</head>
<body>
  <button class="btn secondary" onclick="refresh()">Refresh</button>
  <button class="btn secondary" onclick="markAll()">Mark All as Reviewed</button>
  <button class="btn" onclick="approveAll()">Approve All</button>
  <button class="btn" onclick="approveReviewed()">Approve Reviewed</button>
  <script>
    const vscode = acquireVsCodeApi();
    function refresh()       { vscode.postMessage({command:'refresh'}); }
    function markAll()       { vscode.postMessage({command:'markAll'}); }
    function approveAll()    { vscode.postMessage({command:'approveAll'}); }
    function approveReviewed() { vscode.postMessage({command:'approveReviewed'}); }
  </script>
</body>
</html>`;
  }
}
