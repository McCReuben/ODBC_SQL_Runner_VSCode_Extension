/**
 * SQL Runner Extension - Main Entry Point
 */

import * as vscode from "vscode";
import { SqlExecutor } from "./sqlExecutor";
import { registerSqlCodeLens } from "./sqlCodeLens";

let sqlExecutor: SqlExecutor;

export function activate(context: vscode.ExtensionContext) {
  console.log("SQL Runner extension is now active");

  // Initialize SQL executor
  sqlExecutor = new SqlExecutor(context);

  // Register CodeLens provider for SQL files
  const codeLensDisposable = registerSqlCodeLens(context);
  context.subscriptions.push(codeLensDisposable);

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

  // Register command: Describe table (from CodeLens)
  const describeTableCommand = vscode.commands.registerCommand(
    "sqlRunner.describeTable",
    async (uri: vscode.Uri, tableName: string) => {
      await sqlExecutor.describeTable(uri, tableName);
    },
  );

  // Register command: Export query result to CSV (from CodeLens)
  const exportResultCommand = vscode.commands.registerCommand(
    "sqlRunner.exportResult",
    async (uri: vscode.Uri, startOffset: number, endOffset: number) => {
      await sqlExecutor.exportQueryResult(uri, startOffset, endOffset);
    },
  );

  context.subscriptions.push(executeCommand);
  context.subscriptions.push(executeStatementAtLineCommand);
  context.subscriptions.push(describeTableCommand);
  context.subscriptions.push(exportResultCommand);

  // Cleanup on deactivation
  context.subscriptions.push({
    dispose: () => {
      if (sqlExecutor) {
        sqlExecutor.dispose();
      }
    },
  });
}

export function deactivate() {
  if (sqlExecutor) {
    sqlExecutor.dispose();
  }
}
