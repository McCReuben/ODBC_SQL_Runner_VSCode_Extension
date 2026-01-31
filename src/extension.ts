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
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
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

  context.subscriptions.push(executeCommand);
  context.subscriptions.push(executeStatementAtLineCommand);
  context.subscriptions.push(describeTableCommand);
  context.subscriptions.push(exportResultCommand);
  context.subscriptions.push(selectStatementCommand);
  context.subscriptions.push(copyStatementCommand);

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
