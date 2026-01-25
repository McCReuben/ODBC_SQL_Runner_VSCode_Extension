/**
 * SQL Runner Extension - Main Entry Point
 */

import * as vscode from 'vscode';
import { SqlExecutor } from './sqlExecutor';

let sqlExecutor: SqlExecutor;

export function activate(context: vscode.ExtensionContext) {
  console.log('SQL Runner extension is now active');

  // Initialize SQL executor
  sqlExecutor = new SqlExecutor(context);

  // Register command
  const executeCommand = vscode.commands.registerCommand(
    'sqlRunner.executeQuery',
    async () => {
      await sqlExecutor.executeQuery();
    }
  );

  context.subscriptions.push(executeCommand);

  // Cleanup on deactivation
  context.subscriptions.push({
    dispose: () => {
      if (sqlExecutor) {
        sqlExecutor.dispose();
      }
    }
  });
}

export function deactivate() {
  if (sqlExecutor) {
    sqlExecutor.dispose();
  }
}
