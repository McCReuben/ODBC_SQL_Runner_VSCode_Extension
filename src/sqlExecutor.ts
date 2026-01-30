/**
 * SQL Executor - Coordinates query execution between editor, Python backend, and webview
 */

import * as vscode from "vscode";
import { getSqlToExecute, StatementInfo } from "./statementParser";
import { SessionManager } from "./pythonRunner";
import { WebviewManager } from "./webviewManager";
import * as crypto from "crypto";
import * as path from "path";

export class SqlExecutor {
  private sessionManager: SessionManager;
  private webviewManager: WebviewManager;
  private runningQueries: Map<string, string> = new Map(); // runId -> fileUri
  private runningResultSets: Map<string, Set<string>> = new Map(); // runId -> Set<resultSetId>
  private queryCounter: number = 0; // Incremental counter for query numbers

  constructor(context: vscode.ExtensionContext) {
    this.sessionManager = new SessionManager(context);
    this.webviewManager = new WebviewManager(context);

    // Set up message handler for webview messages
    this.webviewManager.setMessageHandler((message) => {
      this.handleWebviewMessage(message);
    });
  }

  /**
   * Handle messages from the webview
   */
  private handleWebviewMessage(message: any) {
    switch (message.type) {
      case "USER_CANCELLED_RUN":
        this.cancelQuery(message.payload.runId);
        break;
      case "USER_RECONNECT_DB":
        this.reconnectDatabase();
        break;
      // Other message types can be added here if needed
    }
  }

  /**
   * Execute SQL query from the active editor
   */
  async executeQuery() {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showErrorMessage("No active editor");
      return;
    }

    // Verify it's a SQL file
    if (editor.document.languageId !== "sql") {
      vscode.window.showErrorMessage("Active file is not a SQL file");
      return;
    }

    // Generate run ID early so we can use it in catch blocks
    const runId = this.generateId();

    try {
      // Get the file URI and content
      const fileUri = editor.document.uri.toString();
      const fileName = path.basename(editor.document.fileName);
      const text = editor.document.getText();

      // Get selection or cursor position
      const selection = editor.selection;
      const selectionInfo = selection.isEmpty
        ? {
            start: editor.document.offsetAt(selection.start),
            end: editor.document.offsetAt(selection.start),
          }
        : {
            start: editor.document.offsetAt(selection.start),
            end: editor.document.offsetAt(selection.end),
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
        vscode.window.showWarningMessage("No SQL statements to execute");
        return;
      }

      // Track this running query
      this.runningQueries.set(runId, fileUri);
      this.runningResultSets.set(runId, new Set());

      // Get or create webview panel FIRST (before establishing connection)
      const panel = this.webviewManager.getOrCreatePanel(fileUri, fileName);

      // Get or create session for this file
      let session;
      try {
        // Notify webview that connection is starting
        this.webviewManager.sendConnectionStarted(fileUri);
        
        session = await this.sessionManager.getOrCreateSession(fileUri);
        
        // Notify webview that connection succeeded
        this.webviewManager.sendConnectionSuccess(fileUri);
      } catch (error: any) {
        this.runningQueries.delete(runId);
        
        // Notify webview of connection error
        this.webviewManager.sendConnectionError(fileUri, error.message);
        
        vscode.window.showErrorMessage(
          `Failed to create database session: ${error.message}`,
        );
        return;
      }

      // Show progress
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Executing SQL query...",
          cancellable: true,
        },
        async (progress, token) => {
          try {
            // Check if user cancelled the notification
            if (token.isCancellationRequested) {
              console.log("[SqlExecutor] User dismissed progress notification");
              return;
            }

            // Send RUN_STARTED message
            this.queryCounter++;
            const sqlPreview = this.getSqlPreview(statements);
            this.webviewManager.sendRunStarted(
              fileUri,
              runId,
              sqlPreview,
              `Query ${this.queryCounter}`,
            );

            // Send RESULT_SET_PENDING for all statements upfront to create tabs immediately
            for (let i = 0; i < statements.length; i++) {
              const stmt = statements[i];
              const resultSetId = `${runId}-rs-${i}`;
              this.webviewManager.sendResultSetPending(
                fileUri,
                runId,
                resultSetId,
                `Result ${i + 1}`,
                i,
                stmt.sql,
              );
            }

            // Execute each statement
            let batchFailed = false;
            for (let i = 0; i < statements.length; i++) {
              // Check if user cancelled the notification
              if (token.isCancellationRequested) {
                console.log("[SqlExecutor] User dismissed notification during execution");
                break;
              }

              const stmt = statements[i];
              const resultSetId = `${runId}-rs-${i}`;

              // If a previous query in this batch failed, cancel this one
              if (batchFailed) {
                // Just send CANCELLED - tab already exists from RESULT_SET_PENDING
                this.webviewManager.sendResultSetCancelled(
                  fileUri,
                  runId,
                  resultSetId,
                );
                continue;
              }

              // Track this result set as running
              this.runningResultSets.get(runId)?.add(resultSetId);

              progress.report({
                message: `Executing statement ${i + 1} of ${statements.length}...`,
              });

              try {
                // Execute the query with onStarted callback
                // The callback will be invoked when the query actually starts (not just queued)
                const result = await session.executeQuery(
                  stmt.sql,
                  resultSetId,
                  () => {
                    // Send RESULT_SET_STARTED when query actually begins executing
                    this.webviewManager.sendResultSetStarted(
                      fileUri,
                      runId,
                      resultSetId,
                      `Result ${i + 1}`,
                      i,
                      stmt.sql,
                    );
                  }
                );

                // DEBUG: Log the result received by SqlExecutor
                console.log("[DEBUG] SqlExecutor received result:", {
                  resultSetId,
                  success: result.success,
                  hasResults: result.hasResults,
                  columnsLength: result.columns?.length,
                  rowsLength: result.rows?.length,
                  sql: stmt.sql.substring(0, 100),
                });

                if (!result.success) {
                  // Send structured error
                  this.webviewManager.sendResultSetError(
                    fileUri,
                    runId,
                    resultSetId,
                    {
                      message: result.error || "Unknown error",
                      type: result.errorType,
                      details: result.errorDetails,
                      rawError: result.rawError,
                      traceback: result.traceback,
                    }
                  );
                  // Remove from running result sets
                  this.runningResultSets.get(runId)?.delete(resultSetId);
                  
                  // Mark batch as failed - downstream queries in this batch will be cancelled
                  batchFailed = true;
                  continue;
                }

                if (result.hasResults && result.columns && result.rows) {
                  console.log(
                    "[DEBUG] SqlExecutor: Query has results, sending schema and rows",
                  );
                  console.log("[DEBUG] Columns:", result.columns);
                  console.log("[DEBUG] First 2 rows:", result.rows.slice(0, 2));
                  // Send schema
                  this.webviewManager.sendResultSetSchema(
                    fileUri,
                    runId,
                    resultSetId,
                    result.columns,
                  );

                  // Send rows
                  this.webviewManager.sendResultSetRows(
                    fileUri,
                    runId,
                    resultSetId,
                    result.rows,
                    false,
                  );

                  // Send complete
                  this.webviewManager.sendResultSetComplete(
                    fileUri,
                    runId,
                    resultSetId,
                    result.rowCount || 0,
                    result.executionTimeMs || 0,
                  );
                  // Remove from running result sets
                  this.runningResultSets.get(runId)?.delete(resultSetId);
                  console.log(
                    "[DEBUG] SqlExecutor: Sent schema, rows, and complete messages",
                  );
                } else {
                  console.log(
                    "[DEBUG] SqlExecutor: Query has no results (DDL/DML)",
                  );
                  // DDL/DML query with no results
                  // Send a message as a "schema" with info
                  this.webviewManager.sendResultSetSchema(
                    fileUri,
                    runId,
                    resultSetId,
                    [{ name: "Message", type: "string" }],
                  );

                  this.webviewManager.sendResultSetRows(
                    fileUri,
                    runId,
                    resultSetId,
                    [
                      {
                        Message:
                          result.message || "Query executed successfully",
                      },
                    ],
                    false,
                  );

                  this.webviewManager.sendResultSetComplete(
                    fileUri,
                    runId,
                    resultSetId,
                    result.rowCount || 0,
                    result.executionTimeMs || 0,
                  );
                  // Remove from running result sets
                  this.runningResultSets.get(runId)?.delete(resultSetId);
                }
              } catch (error: any) {
                this.webviewManager.sendResultSetError(
                  fileUri,
                  runId,
                  resultSetId,
                  {
                    message: error.message || "Unknown error",
                    type: "Execution Error",
                    rawError: error.stack || error.toString(),
                  }
                );
                // Remove from running result sets
                this.runningResultSets.get(runId)?.delete(resultSetId);
                
                // Mark batch as failed - downstream queries in this batch will be cancelled
                batchFailed = true;
              }
            }

            // Send RUN_COMPLETE
            this.webviewManager.sendRunComplete(fileUri, runId);

            if (batchFailed) {
              vscode.window.showWarningMessage(
                `Batch execution stopped due to error. Some downstream queries were cancelled.`,
              );
            } else {
              vscode.window.showInformationMessage(
                `Executed ${statements.length} statement${statements.length > 1 ? "s" : ""}`,
              );
            }
          } catch (error: any) {
            // Send RUN_ERROR
            this.webviewManager.sendRunError(
              fileUri,
              runId,
              error.message || "Unknown error",
            );
            vscode.window.showErrorMessage(
              `Query execution failed: ${error.message}`,
            );
          } finally {
            // Remove from running queries
            this.runningQueries.delete(runId);
            this.runningResultSets.delete(runId);
          }
        },
      );
    } catch (error: any) {
      this.runningQueries.delete(runId);
      this.runningResultSets.delete(runId);
      vscode.window.showErrorMessage(`Unexpected error: ${error.message}`);
      console.error("SQL execution error:", error);
    }
  }

  /**
   * Reconnect to the database
   */
  async reconnectDatabase() {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showErrorMessage("No active editor");
      return;
    }

    const fileUri = editor.document.uri.toString();

    try {
      // Get the panel for this file (if it exists)
      const fileName = path.basename(editor.document.fileName);
      const panel = this.webviewManager.getOrCreatePanel(fileUri, fileName);

      // Notify webview that reconnection is starting
      this.webviewManager.sendReconnectStarted(fileUri);

      // Attempt reconnection
      const result = await this.sessionManager.reconnectSession(fileUri);

      if (result.success) {
        // Notify webview of success
        this.webviewManager.sendReconnectSuccess(fileUri, result.message);
        vscode.window.showInformationMessage(
          result.message || "Successfully reconnected to database"
        );
      } else {
        // Notify webview of error
        this.webviewManager.sendReconnectError(
          fileUri,
          result.error || "Reconnection failed"
        );
        vscode.window.showErrorMessage(
          `Reconnection failed: ${result.error || "Unknown error"}`
        );
      }
    } catch (error: any) {
      const fileUri = editor.document.uri.toString();
      this.webviewManager.sendReconnectError(
        fileUri,
        error.message || "Unexpected error during reconnection"
      );
      vscode.window.showErrorMessage(
        `Reconnection failed: ${error.message || "Unknown error"}`
      );
    }
  }

  /**
   * Cancel a running query
   */
  cancelQuery(runId: string) {
    const fileUri = this.runningQueries.get(runId);
    if (!fileUri) {
      console.log(`[SqlExecutor] No running query found with runId: ${runId}`);
      return;
    }

    console.log(`[SqlExecutor] Cancelling query ${runId} for file ${fileUri}`);

    // Cancel the session (kills Python process)
    this.sessionManager.cancelSession(fileUri);

    // Send cancellation messages to webview
    // First, cancel any running result sets
    const runningResultSetIds = this.runningResultSets.get(runId);
    if (runningResultSetIds) {
      runningResultSetIds.forEach((resultSetId) => {
        this.webviewManager.sendResultSetCancelled(fileUri, runId, resultSetId);
      });
    }

    // Then send run cancelled message
    this.webviewManager.sendRunCancelled(fileUri, runId);

    // Remove from running queries
    this.runningQueries.delete(runId);
    this.runningResultSets.delete(runId);

    vscode.window.showWarningMessage(
      "Query cancelled. Session will be recreated on next execution.",
    );
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return crypto.randomBytes(8).toString("hex");
  }

  /**
   * Get a preview of the SQL for display
   */
  private getSqlPreview(statements: StatementInfo[]): string {
    if (statements.length === 1) {
      return statements[0].sql;
    }

    // Multiple statements - show them all with separators
    return statements.map((s) => s.sql).join("\n;\n");
  }

  /**
   * Cleanup resources
   */
  async dispose() {
    await this.sessionManager.closeAllSessions();
    this.webviewManager.closeAllPanels();
  }
}
