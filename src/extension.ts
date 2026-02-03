/**
 * Hermes SQL Runner Extension - Main Entry Point
 */

import * as vscode from "vscode";
import { SqlExecutor } from "./sqlExecutor";
import { registerSqlCodeLens } from "./sqlCodeLens";
import { SchemaMetadataStore } from "./schemaMetadata";
import { MetadataWorker } from "./metadataWorker";
import { registerSqlCompletionProvider } from "./sqlCompletionProvider";
import { getTableNameAtCursor } from "./sqlDefinitionProvider";

let sqlExecutor: SqlExecutor;
let metadataStore: SchemaMetadataStore;
let metadataWorker: MetadataWorker;

export function activate(context: vscode.ExtensionContext) {
  console.log("Hermes SQL Runner extension is now active");

  // Initialize schema metadata store
  metadataStore = new SchemaMetadataStore(context);
  context.subscriptions.push(metadataStore);

  // Initialize metadata worker
  metadataWorker = new MetadataWorker(context, metadataStore);
  context.subscriptions.push(metadataWorker);

  // Initialize SQL executor with metadata store reference
  sqlExecutor = new SqlExecutor(context, metadataStore);

  // Register CodeLens provider for SQL files
  const codeLensDisposable = registerSqlCodeLens(context);
  context.subscriptions.push(codeLensDisposable);

  // Register Intellisense completion provider (always registered, but checks setting at runtime)
  const completionDisposable = registerSqlCompletionProvider(
    context,
    metadataStore,
  );
  context.subscriptions.push(completionDisposable);
  console.log("SQL Intellisense provider registered (toggle via sqlRunner.intellisense.enabled setting)");

  // Start metadata worker in the background (needed for IntelliSense)
  metadataWorker.start().catch((error) => {
    console.error("Failed to start metadata worker:", error);
  });

  // Register command: Execute query (Cmd+Enter or from CodeLens)
  const executeCommand = vscode.commands.registerCommand(
    "sqlRunner.executeQuery",
    async () => {
      await sqlExecutor.executeQuery();
    },
  );

  // Register command: Execute statement at specific position (from CodeLens)
  const executeStatementAtLineCommand = vscode.commands.registerCommand(
    "sqlRunner.executeStatementAtLine",
    async (uri: vscode.Uri, startOffset: number, endOffset: number) => {
      await sqlExecutor.executeStatementAtPosition(uri, startOffset, endOffset);
    },
  );

  // Register command: Describe table (from CodeLens or Definition Provider)
  const describeTableCommand = vscode.commands.registerCommand(
    "sqlRunner.describeTable",
    async (uri: vscode.Uri, tableName: string) => {
      await sqlExecutor.describeTable(uri, tableName);
    },
  );

  // Register command: Describe table at cursor position (keyboard shortcut)
  const describeTableAtCursorCommand = vscode.commands.registerCommand(
    "sqlRunner.describeTableAtCursor",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }

      const tableName = getTableNameAtCursor();
      if (!tableName) {
        vscode.window.showWarningMessage(
          "No table name found at cursor position",
        );
        return;
      }

      await sqlExecutor.describeTable(editor.document.uri, tableName);
    },
  );

  // Register command: Export query result to CSV (from CodeLens)
  const exportResultCommand = vscode.commands.registerCommand(
    "sqlRunner.exportResult",
    async (uri: vscode.Uri, startOffset: number, endOffset: number) => {
      await sqlExecutor.exportQueryResult(uri, startOffset, endOffset);
    },
  );

  // Register command: Select SQL statement in editor (from CodeLens)
  const selectStatementCommand = vscode.commands.registerCommand(
    "sqlRunner.selectStatement",
    async (uri: vscode.Uri, startOffset: number, endOffset: number) => {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);
      const startPos = document.positionAt(startOffset);
      const endPos = document.positionAt(endOffset);
      editor.selection = new vscode.Selection(startPos, endPos);
      editor.revealRange(
        new vscode.Range(startPos, endPos),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );
    },
  );

  // Register command: Copy SQL statement to clipboard (from CodeLens)
  const copyStatementCommand = vscode.commands.registerCommand(
    "sqlRunner.copyStatement",
    async (uri: vscode.Uri, startOffset: number, endOffset: number) => {
      const document = await vscode.workspace.openTextDocument(uri);
      const text = document.getText();
      const sql = text.substring(startOffset, endOffset).trim();
      await vscode.env.clipboard.writeText(sql);
      vscode.window.showInformationMessage("SQL copied to clipboard");
    },
  );

  // Register command: Refresh schema metadata
  const refreshMetadataCommand = vscode.commands.registerCommand(
    "sqlRunner.refreshMetadata",
    async () => {
      if (metadataWorker) {
        vscode.window.showInformationMessage("Refreshing schema metadata...");
        metadataWorker.forceRefreshAll();
      }
    },
  );

  // Register command: Show metadata statistics
  const showMetadataStatsCommand = vscode.commands.registerCommand(
    "sqlRunner.showMetadataStats",
    async () => {
      if (metadataStore) {
        const stats = metadataStore.getStats();
        const workerState = metadataWorker?.getState() || "unknown";
        const queueLength = metadataWorker?.getQueueLength() || 0;

        vscode.window.showInformationMessage(
          `Metadata: ${stats.totalSchemas} schemas, ${stats.totalTables} tables (${stats.tablesWithColumns} with columns). ` +
            `Configured: ${stats.schemasToScan} schemas to scan, ${stats.configuredTables} specific tables. ` +
            `Auto-discovered: ${stats.autoDiscoveredSchemas} schemas, ${stats.autoDiscoveredTables} tables. ` +
            `Worker: ${workerState}, Queue: ${queueLength}`,
        );
      }
    },
  );

  // Register command: Edit schemas config file
  const editSchemasConfigCommand = vscode.commands.registerCommand(
    "sqlRunner.editSchemasConfig",
    async () => {
      if (metadataStore) {
        await metadataStore.openSchemasFile();
      }
    },
  );

  // Register command: Edit tables config file
  const editTablesConfigCommand = vscode.commands.registerCommand(
    "sqlRunner.editTablesConfig",
    async () => {
      if (metadataStore) {
        await metadataStore.openTablesFile();
      }
    },
  );

  context.subscriptions.push(executeCommand);
  context.subscriptions.push(executeStatementAtLineCommand);
  context.subscriptions.push(describeTableCommand);
  context.subscriptions.push(describeTableAtCursorCommand);
  context.subscriptions.push(exportResultCommand);
  context.subscriptions.push(selectStatementCommand);
  context.subscriptions.push(copyStatementCommand);
  context.subscriptions.push(refreshMetadataCommand);
  context.subscriptions.push(showMetadataStatsCommand);
  context.subscriptions.push(editSchemasConfigCommand);
  context.subscriptions.push(editTablesConfigCommand);

  // Cleanup on deactivation
  context.subscriptions.push({
    dispose: () => {
      if (sqlExecutor) {
        sqlExecutor.dispose();
      }
      if (metadataWorker) {
        metadataWorker.dispose();
      }
      if (metadataStore) {
        metadataStore.dispose();
      }
    },
  });
}

export function deactivate() {
  if (sqlExecutor) {
    sqlExecutor.dispose();
  }
  if (metadataWorker) {
    metadataWorker.dispose();
  }
  if (metadataStore) {
    metadataStore.dispose();
  }
}
