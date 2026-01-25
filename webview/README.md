# SQL Results Webview

A React-based VS Code webview UI for displaying SQL query results with multi-cell selection, sorting, and real-time aggregation.

## Features

- **Query History Tabs** - Horizontal tabs showing past query executions
- **Result Set Tabs** - Vertical tabs for multi-statement query results
- **Interactive Table** - Powered by Tabulator with sorting and multi-cell selection
- **Live Aggregation** - Sum, Average, Max computed on selected numeric cells
- **Incremental Updates** - Supports streaming results as they arrive

## Development

```bash
# Install dependencies
npm install

# Start dev server (with mock data)
npm run dev

# Build for production
npm run build
```

The dev server runs standalone with mock data, simulating messages that would come from the VS Code extension.

## Integration with VS Code Extension

### 1. Build the Webview

```bash
cd webview
npm run build
```

This produces `dist/webview.js` and `dist/webview.css`.

### 2. Create the Webview Panel

In your extension code:

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function createResultsPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'sqlResults',
    'SQL Results',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'webview', 'dist'))
      ]
    }
  );

  // Get URIs for bundled assets
  const distPath = path.join(context.extensionPath, 'webview', 'dist');
  const scriptUri = panel.webview.asWebviewUri(
    vscode.Uri.file(path.join(distPath, 'webview.js'))
  );
  const styleUri = panel.webview.asWebviewUri(
    vscode.Uri.file(path.join(distPath, 'webview.css'))
  );

  // Set HTML content with CSP
  panel.webview.html = getWebviewContent(scriptUri, styleUri, panel.webview.cspSource);

  return panel;
}

function getWebviewContent(
  scriptUri: vscode.Uri,
  styleUri: vscode.Uri,
  cspSource: string
): string {
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
```

### 3. Send Messages to the Webview

The webview expects messages in a specific format. Here's how to send them:

```typescript
// When starting a query execution
panel.webview.postMessage({
  type: 'RUN_STARTED',
  payload: {
    runId: 'unique-run-id',
    sql: 'SELECT * FROM users',
    title: 'Query 1',
    startedAt: Date.now()
  }
});

// When a result set starts (for multi-statement queries)
panel.webview.postMessage({
  type: 'RESULT_SET_STARTED',
  payload: {
    runId: 'unique-run-id',
    resultSetId: 'result-1',
    title: 'users',
    statementIndex: 0
  }
});

// When schema/columns are known
panel.webview.postMessage({
  type: 'RESULT_SET_SCHEMA',
  payload: {
    runId: 'unique-run-id',
    resultSetId: 'result-1',
    columns: [
      { name: 'id', type: 'number' },
      { name: 'name', type: 'string' },
      { name: 'email', type: 'string' }
    ]
  }
});

// Send rows (can be batched, use append: true for subsequent batches)
panel.webview.postMessage({
  type: 'RESULT_SET_ROWS',
  payload: {
    runId: 'unique-run-id',
    resultSetId: 'result-1',
    rows: [
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' }
    ],
    append: false // true for subsequent batches
  }
});

// When result set is complete
panel.webview.postMessage({
  type: 'RESULT_SET_COMPLETE',
  payload: {
    runId: 'unique-run-id',
    resultSetId: 'result-1',
    rowCount: 2,
    executionTimeMs: 42
  }
});

// When entire run is complete
panel.webview.postMessage({
  type: 'RUN_COMPLETE',
  payload: { runId: 'unique-run-id' }
});

// On error
panel.webview.postMessage({
  type: 'RUN_ERROR',
  payload: {
    runId: 'unique-run-id',
    message: 'Connection failed'
  }
});
```

### 4. Receive Messages from the Webview

```typescript
panel.webview.onDidReceiveMessage(
  (message) => {
    switch (message.type) {
      case 'WEBVIEW_READY':
        // Webview is ready to receive data
        // You might want to restore previous state here
        break;
      case 'USER_SELECTED_RUN':
        // User switched to a different query history tab
        console.log('User selected run:', message.payload.runId);
        break;
      case 'USER_SELECTED_RESULTSET':
        // User switched to a different result set tab
        console.log('User selected result set:', message.payload.resultSetId);
        break;
      case 'USER_CLOSED_RUN':
        // User closed a query history tab
        console.log('User closed run:', message.payload.runId);
        break;
    }
  },
  undefined,
  context.subscriptions
);
```

## Message Protocol Reference

### Extension → Webview

| Message Type | Payload | Description |
|-------------|---------|-------------|
| `RUN_STARTED` | `{ runId, sql, title, startedAt }` | New query execution started |
| `RESULT_SET_STARTED` | `{ runId, resultSetId, title, statementIndex? }` | New result set starting |
| `RESULT_SET_SCHEMA` | `{ runId, resultSetId, columns }` | Column definitions arrived |
| `RESULT_SET_ROWS` | `{ runId, resultSetId, rows, append }` | Row data batch |
| `RESULT_SET_COMPLETE` | `{ runId, resultSetId, rowCount?, executionTimeMs? }` | Result set finished |
| `RESULT_SET_ERROR` | `{ runId, resultSetId, message }` | Result set error |
| `RUN_COMPLETE` | `{ runId }` | All statements finished |
| `RUN_ERROR` | `{ runId, message }` | Run-level error |

### Webview → Extension

| Message Type | Payload | Description |
|-------------|---------|-------------|
| `WEBVIEW_READY` | - | Webview mounted and ready |
| `USER_SELECTED_RUN` | `{ runId }` | User switched tabs |
| `USER_SELECTED_RESULTSET` | `{ runId, resultSetId }` | User switched result |
| `USER_CLOSED_RUN` | `{ runId }` | User closed a tab |

## Architecture

```
src/
├── main.tsx          # Entry point
├── App.tsx           # Main layout component
├── types.ts          # TypeScript type definitions
├── state.ts          # Reducer and state management
├── vscode.ts         # VS Code API wrapper
├── styles.css        # Tailwind + custom styles
├── devMock.ts        # Mock data for development
└── components/
    ├── TopTabs.tsx   # Query history tabs
    ├── SideTabs.tsx  # Result set tabs
    ├── ResultTable.tsx # Tabulator table
    └── StatusBar.tsx # Aggregation bar
```

## Styling

The UI uses VS Code CSS variables for theming, automatically adapting to light/dark themes:

- `--vscode-editor-background`
- `--vscode-editor-foreground`
- `--vscode-panel-border`
- `--vscode-tab-activeBackground`
- `--vscode-tab-inactiveBackground`
- etc.

Tabulator is styled to match the VS Code aesthetic with custom CSS overrides.
