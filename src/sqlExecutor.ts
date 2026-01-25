/**
 * SQL Executor - Coordinates query execution between editor, Python backend, and webview
 */

import * as vscode from 'vscode';
import { getSqlToExecute, StatementInfo } from './statementParser';
import { SessionManager } from './pythonRunner';
import { WebviewManager } from './webviewManager';
import * as crypto from 'crypto';
import * as path from 'path';

export class SqlExecutor {
  private sessionManager: SessionManager;
  private webviewManager: WebviewManager;

  constructor(context: vscode.ExtensionContext) {
    this.sessionManager = new SessionManager(context);
    this.webviewManager = new WebviewManager(context);
  }

  /**
   * Execute SQL query from the active editor
   */
  async executeQuery() {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showErrorMessage('No active editor');
      return;
    }

    // Verify it's a SQL file
    if (editor.document.languageId !== 'sql') {
      vscode.window.showErrorMessage('Active file is not a SQL file');
      return;
    }

    try {
      // Get the file URI and content
      const fileUri = editor.document.uri.toString();
      const fileName = path.basename(editor.document.fileName);
      const text = editor.document.getText();

      // Get selection or cursor position
      const selection = editor.selection;
      const selectionInfo = selection.isEmpty
        ? null
        : {
            start: editor.document.offsetAt(selection.start),
            end: editor.document.offsetAt(selection.end)
          };

      // Parse SQL to execute
      let statements: StatementInfo[];
      try {
        statements = getSqlToExecute(text, selectionInfo);
      } catch (error: any) {
        vscode.window.showErrorMessage(`SQL parsing error: ${error.message}`);
        return;
      }

      if (statements.length === 0) {
        vscode.window.showWarningMessage('No SQL statements to execute');
        return;
      }

      // Generate run ID
      const runId = this.generateId();

      // Get or create session for this file
      let session;
      try {
        session = await this.sessionManager.getOrCreateSession(fileUri);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to create database session: ${error.message}`);
        return;
      }

      // Get or create webview panel
      const panel = this.webviewManager.getOrCreatePanel(fileUri, fileName);

      // Show progress
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Executing SQL query...',
          cancellable: false
        },
        async (progress) => {
          try {
            // Send RUN_STARTED message
            const sqlPreview = this.getSqlPreview(statements);
            this.webviewManager.sendRunStarted(
              fileUri,
              runId,
              sqlPreview,
              `Query ${new Date().toLocaleTimeString()}`
            );

            // Execute each statement
            for (let i = 0; i < statements.length; i++) {
              const stmt = statements[i];
              const resultSetId = `${runId}-rs-${i}`;

              progress.report({
                message: `Executing statement ${i + 1} of ${statements.length}...`
              });

              // Send RESULT_SET_STARTED
              this.webviewManager.sendResultSetStarted(
                fileUri,
                runId,
                resultSetId,
                `Result ${i + 1}`,
                i,
                stmt.sql
              );

              try {
                // Execute the query
                const result = await session.executeQuery(stmt.sql, resultSetId);

                // DEBUG: Log the result received by SqlExecutor
                console.log("[DEBUG] SqlExecutor received result:", {
                  resultSetId,
                  success: result.success,
                  hasResults: result.hasResults,
                  columnsLength: result.columns?.length,
                  rowsLength: result.rows?.length,
                  sql: stmt.sql.substring(0, 100)
                });

                if (!result.success) {
                  // Send error
                  this.webviewManager.sendResultSetError(
                    fileUri,
                    runId,
                    resultSetId,
                    result.error || 'Unknown error'
                  );
                  continue;
                }

                if (result.hasResults && result.columns && result.rows) {
                  console.log("[DEBUG] SqlExecutor: Query has results, sending schema and rows");
                  console.log("[DEBUG] Columns:", result.columns);
                  console.log("[DEBUG] First 2 rows:", result.rows.slice(0, 2));
                  // Send schema
                  this.webviewManager.sendResultSetSchema(
                    fileUri,
                    runId,
                    resultSetId,
                    result.columns
                  );

                  // Send rows
                  this.webviewManager.sendResultSetRows(
                    fileUri,
                    runId,
                    resultSetId,
                    result.rows,
                    false
                  );

                  // Send complete
                  this.webviewManager.sendResultSetComplete(
                    fileUri,
                    runId,
                    resultSetId,
                    result.rowCount || 0,
                    result.executionTimeMs || 0
                  );
                  console.log("[DEBUG] SqlExecutor: Sent schema, rows, and complete messages");
                } else {
                  console.log("[DEBUG] SqlExecutor: Query has no results (DDL/DML)");
                  // DDL/DML query with no results
                  // Send a message as a "schema" with info
                  this.webviewManager.sendResultSetSchema(
                    fileUri,
                    runId,
                    resultSetId,
                    [{ name: 'Message', type: 'string' }]
                  );

                  this.webviewManager.sendResultSetRows(
                    fileUri,
                    runId,
                    resultSetId,
                    [{ Message: result.message || 'Query executed successfully' }],
                    false
                  );

                  this.webviewManager.sendResultSetComplete(
                    fileUri,
                    runId,
                    resultSetId,
                    result.rowCount || 0,
                    result.executionTimeMs || 0
                  );
                }
              } catch (error: any) {
                this.webviewManager.sendResultSetError(
                  fileUri,
                  runId,
                  resultSetId,
                  error.message || 'Unknown error'
                );
              }
            }

            // Send RUN_COMPLETE
            this.webviewManager.sendRunComplete(fileUri, runId);

            vscode.window.showInformationMessage(
              `Executed ${statements.length} statement${statements.length > 1 ? 's' : ''}`
            );
          } catch (error: any) {
            // Send RUN_ERROR
            this.webviewManager.sendRunError(
              fileUri,
              runId,
              error.message || 'Unknown error'
            );
            vscode.window.showErrorMessage(`Query execution failed: ${error.message}`);
          }
        }
      );
    } catch (error: any) {
      vscode.window.showErrorMessage(`Unexpected error: ${error.message}`);
      console.error('SQL execution error:', error);
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Get a preview of the SQL for display
   */
  private getSqlPreview(statements: StatementInfo[]): string {
    if (statements.length === 1) {
      return statements[0].sql;
    }

    // Multiple statements - show them all with separators
    return statements.map(s => s.sql).join('\n;\n');
  }

  /**
   * Cleanup resources
   */
  async dispose() {
    await this.sessionManager.closeAllSessions();
    this.webviewManager.closeAllPanels();
  }
}
