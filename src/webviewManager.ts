/**
 * Manages webview panels for displaying SQL results
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface Column {
  name: string;
  type: string;
}

type MessageHandler = (message: any) => void;

export class WebviewManager {
  private panels: Map<string, vscode.WebviewPanel> = new Map();
  private onMessageCallback?: MessageHandler;

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Set a callback to handle messages from the webview
   */
  setMessageHandler(handler: MessageHandler) {
    this.onMessageCallback = handler;
  }

  /**
   * Get or create a webview panel for a file
   */
  getOrCreatePanel(fileUri: string, fileName: string): vscode.WebviewPanel {
    // Check if panel already exists
    let panel = this.panels.get(fileUri);

    if (panel) {
      panel.reveal(vscode.ViewColumn.Two);
      return panel;
    }

    // Create new panel
    panel = vscode.window.createWebviewPanel(
      'sqlResults',
      `SQL Results: ${fileName}`,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'dist'))
        ]
      }
    );

    // Set HTML content
    panel.webview.html = this.getWebviewContent(panel.webview);

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(
      (message) => {
        if (this.onMessageCallback) {
          this.onMessageCallback(message);
        }
      },
      null,
      this.context.subscriptions
    );

    // Handle panel disposal
    panel.onDidDispose(() => {
      this.panels.delete(fileUri);
    }, null, this.context.subscriptions);

    // Store panel
    this.panels.set(fileUri, panel);

    return panel;
  }

  /**
   * Send CONNECTION_STARTED message
   */
  sendConnectionStarted(fileUri: string) {
    const panel = this.panels.get(fileUri);
    if (panel) {
      panel.webview.postMessage({
        type: 'CONNECTION_STARTED',
        payload: {}
      });
    }
  }

  /**
   * Send CONNECTION_SUCCESS message
   */
  sendConnectionSuccess(fileUri: string, message?: string) {
    const panel = this.panels.get(fileUri);
    if (panel) {
      panel.webview.postMessage({
        type: 'CONNECTION_SUCCESS',
        payload: { message }
      });
    }
  }

  /**
   * Send CONNECTION_ERROR message
   */
  sendConnectionError(fileUri: string, message: string) {
    const panel = this.panels.get(fileUri);
    if (panel) {
      panel.webview.postMessage({
        type: 'CONNECTION_ERROR',
        payload: { message }
      });
    }
  }

  /**
   * Send RUN_STARTED message
   */
  sendRunStarted(
    fileUri: string,
    runId: string,
    sql: string,
    title: string
  ) {
    const panel = this.panels.get(fileUri);
    if (panel) {
      panel.webview.postMessage({
        type: 'RUN_STARTED',
        payload: {
          runId,
          sql,
          title,
          startedAt: Date.now()
        }
      });
    }
  }

  /**
   * Send RESULT_SET_PENDING message (creates a tab in pending state)
   */
  sendResultSetPending(
    fileUri: string,
    runId: string,
    resultSetId: string,
    title: string,
    statementIndex: number,
    sql?: string
  ) {
    const panel = this.panels.get(fileUri);
    if (panel) {
      panel.webview.postMessage({
        type: 'RESULT_SET_PENDING',
        payload: {
          runId,
          resultSetId,
          title,
          statementIndex,
          sql
        }
      });
    }
  }

  /**
   * Send RESULT_SET_STARTED message (changes status from pending to running)
   */
  sendResultSetStarted(
    fileUri: string,
    runId: string,
    resultSetId: string,
    title: string,
    statementIndex: number,
    sql?: string
  ) {
    const panel = this.panels.get(fileUri);
    if (panel) {
      panel.webview.postMessage({
        type: 'RESULT_SET_STARTED',
        payload: {
          runId,
          resultSetId,
          title,
          statementIndex,
          sql
        }
      });
    }
  }

  /**
   * Send RESULT_SET_SCHEMA message
   */
  sendResultSetSchema(
    fileUri: string,
    runId: string,
    resultSetId: string,
    columns: Column[]
  ) {
    const panel = this.panels.get(fileUri);
    console.log("[DEBUG] WebviewManager.sendResultSetSchema:", {
      fileUri,
      runId,
      resultSetId,
      columnsLength: columns.length,
      columns,
      panelExists: !!panel
    });
    if (panel) {
      panel.webview.postMessage({
        type: 'RESULT_SET_SCHEMA',
        payload: {
          runId,
          resultSetId,
          columns
        }
      });
    }
  }

  /**
   * Send RESULT_SET_ROWS message
   */
  sendResultSetRows(
    fileUri: string,
    runId: string,
    resultSetId: string,
    rows: any[],
    append: boolean = false
  ) {
    const panel = this.panels.get(fileUri);
    console.log("[DEBUG] WebviewManager.sendResultSetRows:", {
      fileUri,
      runId,
      resultSetId,
      rowsLength: rows.length,
      firstRow: rows[0],
      append,
      panelExists: !!panel
    });
    if (panel) {
      panel.webview.postMessage({
        type: 'RESULT_SET_ROWS',
        payload: {
          runId,
          resultSetId,
          rows,
          append
        }
      });
    }
  }

  /**
   * Send RESULT_SET_COMPLETE message
   */
  sendResultSetComplete(
    fileUri: string,
    runId: string,
    resultSetId: string,
    rowCount: number,
    executionTimeMs: number
  ) {
    const panel = this.panels.get(fileUri);
    if (panel) {
      panel.webview.postMessage({
        type: 'RESULT_SET_COMPLETE',
        payload: {
          runId,
          resultSetId,
          rowCount,
          executionTimeMs
        }
      });
    }
  }

  /**
   * Send RESULT_SET_ERROR message
   */
  sendResultSetError(
    fileUri: string,
    runId: string,
    resultSetId: string,
    message: string
  ) {
    const panel = this.panels.get(fileUri);
    if (panel) {
      panel.webview.postMessage({
        type: 'RESULT_SET_ERROR',
        payload: {
          runId,
          resultSetId,
          message
        }
      });
    }
  }

  /**
   * Send RUN_COMPLETE message
   */
  sendRunComplete(fileUri: string, runId: string) {
    const panel = this.panels.get(fileUri);
    if (panel) {
      panel.webview.postMessage({
        type: 'RUN_COMPLETE',
        payload: { runId }
      });
    }
  }

  /**
   * Send RUN_ERROR message
   */
  sendRunError(fileUri: string, runId: string, message: string) {
    const panel = this.panels.get(fileUri);
    if (panel) {
      panel.webview.postMessage({
        type: 'RUN_ERROR',
        payload: {
          runId,
          message
        }
      });
    }
  }

  /**
   * Send RUN_CANCELLED message
   */
  sendRunCancelled(fileUri: string, runId: string) {
    const panel = this.panels.get(fileUri);
    if (panel) {
      panel.webview.postMessage({
        type: 'RUN_CANCELLED',
        payload: { runId }
      });
    }
  }

  /**
   * Send RESULT_SET_CANCELLED message
   */
  sendResultSetCancelled(
    fileUri: string,
    runId: string,
    resultSetId: string
  ) {
    const panel = this.panels.get(fileUri);
    if (panel) {
      panel.webview.postMessage({
        type: 'RESULT_SET_CANCELLED',
        payload: {
          runId,
          resultSetId
        }
      });
    }
  }

  /**
   * Generate HTML content for the webview
   */
  private getWebviewContent(webview: vscode.Webview): string {
    const distPath = path.join(this.context.extensionPath, 'webview', 'dist');

    // Check if built files exist
    const jsPath = path.join(distPath, 'webview.js');
    const cssPath = path.join(distPath, 'webview.css');

    if (!fs.existsSync(jsPath)) {
      return this.getErrorHtml('Webview not built. Run: cd webview && npm install && npm run build');
    }

    const scriptUri = webview.asWebviewUri(vscode.Uri.file(jsPath));
    const styleUri = webview.asWebviewUri(vscode.Uri.file(cssPath));
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${cspSource} 'unsafe-inline';
    script-src ${cspSource};
    font-src ${cspSource};
  ">
  <link href="${styleUri}" rel="stylesheet">
  <title>SQL Results</title>
</head>
<body>
  <div id="root"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getErrorHtml(message: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 20px;
    }
    .error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      padding: 16px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="error">
    <h2>Error</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
  }

  /**
   * Close panel for a file
   */
  closePanel(fileUri: string) {
    const panel = this.panels.get(fileUri);
    if (panel) {
      panel.dispose();
      this.panels.delete(fileUri);
    }
  }

  /**
   * Close all panels
   */
  closeAllPanels() {
    this.panels.forEach(panel => panel.dispose());
    this.panels.clear();
  }
}
