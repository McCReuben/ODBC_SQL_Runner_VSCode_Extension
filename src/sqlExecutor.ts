/**
 * SQL Executor - Coordinates query execution between editor, Python backend, and webview
 */

import * as vscode from "vscode";
import { getSqlToExecute, StatementInfo } from "./statementParser";
import { SessionManager } from "./pythonRunner";
import { WebviewManager } from "./webviewManager";
import { SchemaMetadataStore } from "./schemaMetadata";
import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs";

export class SqlExecutor {
  private sessionManager: SessionManager;
  private webviewManager: WebviewManager;
  private metadataStore: SchemaMetadataStore | null;
  private runningQueries: Map<string, string> = new Map(); // runId -> fileUri
  private runningResultSets: Map<string, Set<string>> = new Map(); // runId -> Set<resultSetId>
  private cancelledRuns: Set<string> = new Set(); // Track cancelled runIds
  private queryCounter: number = 0; // Incremental counter for query numbers
  private defaultSchema: string = "ACCESS_VIEWS";

  constructor(context: vscode.ExtensionContext, metadataStore?: SchemaMetadataStore) {
    this.sessionManager = new SessionManager(context);
    this.webviewManager = new WebviewManager(context);
    this.metadataStore = metadataStore || null;
    
    // Load default schema from config
    const config = vscode.workspace.getConfiguration("sqlRunner.intellisense");
    this.defaultSchema = config.get<string>("defaultSchema", "ACCESS_VIEWS");

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
      case "USER_DISCONNECT_DB":
        this.disconnectDatabase();
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

      // Extract and register table references for Intellisense
      this.extractAndRegisterTableReferences(statements);

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
              // Check if query was cancelled by user
              if (this.cancelledRuns.has(runId)) {
                console.log(
                  "[SqlExecutor] Query was cancelled, stopping execution",
                );
                break;
              }

              // Check if user cancelled the notification
              if (token.isCancellationRequested) {
                console.log(
                  "[SqlExecutor] User dismissed notification during execution",
                );
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
                // Get max rows setting
                const config = vscode.workspace.getConfiguration("sqlRunner");
                const maxRows = config.get<number>("maxDisplayRows", 1000);

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
                  },
                  maxRows,
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
                    },
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
                  },
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
            this.cancelledRuns.delete(runId);
          }
        },
      );
    } catch (error: any) {
      this.runningQueries.delete(runId);
      this.runningResultSets.delete(runId);
      this.cancelledRuns.delete(runId);
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
          result.message || "Successfully reconnected to database",
        );
      } else {
        // Notify webview of error
        this.webviewManager.sendReconnectError(
          fileUri,
          result.error || "Reconnection failed",
        );
        vscode.window.showErrorMessage(
          `Reconnection failed: ${result.error || "Unknown error"}`,
        );
      }
    } catch (error: any) {
      const fileUri = editor.document.uri.toString();
      this.webviewManager.sendReconnectError(
        fileUri,
        error.message || "Unexpected error during reconnection",
      );
      vscode.window.showErrorMessage(
        `Reconnection failed: ${error.message || "Unknown error"}`,
      );
    }
  }

  /**
   * Disconnect from the database
   */
  async disconnectDatabase() {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showErrorMessage("No active editor");
      return;
    }

    const fileUri = editor.document.uri.toString();

    try {
      // Close the session
      await this.sessionManager.closeSession(fileUri);

      // Notify webview of successful disconnection
      this.webviewManager.sendDisconnectSuccess(
        fileUri,
        "Successfully disconnected from database",
      );

      vscode.window.showInformationMessage(
        "Successfully disconnected from database",
      );
    } catch (error: any) {
      // Notify webview of disconnection error
      this.webviewManager.sendDisconnectError(
        fileUri,
        error.message || "Disconnection failed",
      );
      vscode.window.showErrorMessage(
        `Disconnection failed: ${error.message || "Unknown error"}`,
      );
    }
  }

  /**
   * Cancel a running query
   */
  async cancelQuery(runId: string) {
    const fileUri = this.runningQueries.get(runId);
    if (!fileUri) {
      console.log(`[SqlExecutor] No running query found with runId: ${runId}`);
      return;
    }

    console.log(`[SqlExecutor] Cancelling query ${runId} for file ${fileUri}`);

    // Mark this run as cancelled
    this.cancelledRuns.add(runId);

    try {
      // Cancel the session gracefully (without killing the process)
      await this.sessionManager.cancelSession(fileUri);

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

      vscode.window.showInformationMessage(
        "Query cancelled. Database session remains active.",
      );
    } catch (error: any) {
      console.error("[SqlExecutor] Failed to cancel query:", error);
      vscode.window.showErrorMessage(
        `Failed to cancel query: ${error.message}`,
      );
    }
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
   * Extract table references from SQL statements and add them to metadata store
   * This auto-expands the allow-list based on usage
   */
  private extractAndRegisterTableReferences(statements: StatementInfo[]): void {
    // Check if auto-expand is enabled
    const config = vscode.workspace.getConfiguration("sqlRunner.intellisense");
    if (!config.get<boolean>("autoExpandFromQueries", true)) {
      return;
    }

    if (!this.metadataStore) {
      return;
    }

    const schemas: Set<string> = new Set();
    const tables: { schema: string; table: string }[] = [];

    for (const stmt of statements) {
      const sql = stmt.sql;

      // Pattern to match table references in various SQL contexts
      // Handles: FROM table, JOIN table, INTO table, UPDATE table, TABLE table
      // Also handles schema.table format
      const tablePatterns = [
        // FROM/JOIN clauses
        /(?:from|join)\s+([\w.]+)/gi,
        // INSERT INTO
        /insert\s+(?:into\s+)?([\w.]+)/gi,
        // UPDATE
        /update\s+([\w.]+)/gi,
        // CREATE/DROP/ALTER TABLE
        /(?:create|drop|alter)\s+(?:or\s+replace\s+)?(?:temporary\s+)?(?:external\s+)?table\s+(?:if\s+(?:not\s+)?exists\s+)?([\w.]+)/gi,
        // DESCRIBE
        /describe\s+([\w.]+)/gi,
        // SHOW TABLES IN
        /show\s+tables\s+in\s+(\w+)/gi,
        // USE schema
        /use\s+(\w+)/gi,
      ];

      for (const pattern of tablePatterns) {
        let match;
        while ((match = pattern.exec(sql)) !== null) {
          const fullName = match[1];

          if (fullName.includes(".")) {
            // Schema-qualified table
            const [schemaName, tableName] = fullName.split(".");
            schemas.add(schemaName);
            tables.push({ schema: schemaName, table: tableName });
          } else {
            // Unqualified - could be a table or schema
            // Check if it looks like a USE statement (just schema)
            if (/use\s+/i.test(match[0])) {
              schemas.add(fullName);
            } else if (/show\s+tables\s+in\s+/i.test(match[0])) {
              schemas.add(fullName);
            } else {
              // Assume it's a table in the default schema
              tables.push({ schema: this.defaultSchema, table: fullName });
            }
          }
        }
      }
    }

    // Add discovered schemas and tables to metadata store
    if (schemas.size > 0 || tables.length > 0) {
      this.metadataStore.addFromQuery(Array.from(schemas), tables);
      console.log(
        `[SqlExecutor] Auto-discovered ${schemas.size} schemas and ${tables.length} tables from query`
      );
    }
  }

  /**
   * Execute a specific SQL statement at a given position (called from CodeLens)
   */
  async executeStatementAtPosition(
    uri: vscode.Uri,
    startOffset: number,
    endOffset: number
  ) {
    // Find the document
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const sql = text.substring(startOffset, endOffset).trim();

    if (!sql) {
      vscode.window.showWarningMessage("No SQL statement found at position");
      return;
    }

    // Extract and register table references for Intellisense
    this.extractAndRegisterTableReferences([{ sql, statementIndex: 0 }]);

    // Generate run ID early so we can use it in catch blocks
    const runId = this.generateId();

    try {
      const fileUri = uri.toString();
      const fileName = require("path").basename(document.fileName);

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
          `Failed to create database session: ${error.message}`
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
            // Check if query was cancelled by user
            if (this.cancelledRuns.has(runId)) {
              console.log("[SqlExecutor] Query was cancelled before execution");
              return;
            }

            if (token.isCancellationRequested) {
              return;
            }

            // Send RUN_STARTED message
            this.queryCounter++;
            this.webviewManager.sendRunStarted(
              fileUri,
              runId,
              sql,
              `Query ${this.queryCounter}`
            );

            const resultSetId = `${runId}-rs-0`;

            // Send RESULT_SET_PENDING
            this.webviewManager.sendResultSetPending(
              fileUri,
              runId,
              resultSetId,
              `Result 1`,
              0,
              sql
            );

            // Track this result set as running
            this.runningResultSets.get(runId)?.add(resultSetId);

            try {
              const result = await session.executeQuery(sql, resultSetId, () => {
                this.webviewManager.sendResultSetStarted(
                  fileUri,
                  runId,
                  resultSetId,
                  `Result 1`,
                  0,
                  sql
                );
              });

              if (!result.success) {
                this.webviewManager.sendResultSetError(fileUri, runId, resultSetId, {
                  message: result.error || "Unknown error",
                  type: result.errorType,
                  details: result.errorDetails,
                  rawError: result.rawError,
                  traceback: result.traceback,
                });
                this.runningResultSets.get(runId)?.delete(resultSetId);
              } else if (result.hasResults && result.columns && result.rows) {
                this.webviewManager.sendResultSetSchema(
                  fileUri,
                  runId,
                  resultSetId,
                  result.columns
                );

                this.webviewManager.sendResultSetRows(
                  fileUri,
                  runId,
                  resultSetId,
                  result.rows,
                  false
                );

                this.webviewManager.sendResultSetComplete(
                  fileUri,
                  runId,
                  resultSetId,
                  result.rowCount || 0,
                  result.executionTimeMs || 0
                );
                this.runningResultSets.get(runId)?.delete(resultSetId);
              } else {
                this.webviewManager.sendResultSetSchema(
                  fileUri,
                  runId,
                  resultSetId,
                  [{ name: "Message", type: "string" }]
                );

                this.webviewManager.sendResultSetRows(
                  fileUri,
                  runId,
                  resultSetId,
                  [{ Message: result.message || "Query executed successfully" }],
                  false
                );

                this.webviewManager.sendResultSetComplete(
                  fileUri,
                  runId,
                  resultSetId,
                  result.rowCount || 0,
                  result.executionTimeMs || 0
                );
                this.runningResultSets.get(runId)?.delete(resultSetId);
              }
            } catch (error: any) {
              this.webviewManager.sendResultSetError(fileUri, runId, resultSetId, {
                message: error.message || "Unknown error",
                type: "Execution Error",
                rawError: error.stack || error.toString(),
              });
              this.runningResultSets.get(runId)?.delete(resultSetId);
            }

            // Send RUN_COMPLETE
            this.webviewManager.sendRunComplete(fileUri, runId);
            vscode.window.showInformationMessage("Executed 1 statement");
          } catch (error: any) {
            this.webviewManager.sendRunError(
              fileUri,
              runId,
              error.message || "Unknown error"
            );
            vscode.window.showErrorMessage(
              `Query execution failed: ${error.message}`
            );
          } finally {
            this.runningQueries.delete(runId);
            this.runningResultSets.delete(runId);
            this.cancelledRuns.delete(runId);
          }
        }
      );
    } catch (error: any) {
      this.runningQueries.delete(runId);
      this.runningResultSets.delete(runId);
      this.cancelledRuns.delete(runId);
      vscode.window.showErrorMessage(`Unexpected error: ${error.message}`);
      console.error("SQL execution error:", error);
    }
  }

  /**
   * Run a DESCRIBE TABLE statement for the given table name
   */
  async describeTable(uri: vscode.Uri, tableName: string) {
    // Generate the DESCRIBE statement
    const sql = `DESCRIBE ${tableName}`;

    // Extract and register table references for Intellisense
    this.extractAndRegisterTableReferences([{ sql, statementIndex: 0 }]);

    // Generate run ID early so we can use it in catch blocks
    const runId = this.generateId();

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const fileUri = uri.toString();
      const fileName = require("path").basename(document.fileName);

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
          `Failed to create database session: ${error.message}`
        );
        return;
      }

      // Show progress
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Describing table ${tableName}...`,
          cancellable: true,
        },
        async (progress, token) => {
          try {
            // Check if query was cancelled by user
            if (this.cancelledRuns.has(runId)) {
              console.log("[SqlExecutor] Query was cancelled before execution");
              return;
            }

            if (token.isCancellationRequested) {
              return;
            }

            // Send RUN_STARTED message
            this.queryCounter++;
            this.webviewManager.sendRunStarted(
              fileUri,
              runId,
              sql,
              `Describe: ${tableName}`
            );

            const resultSetId = `${runId}-rs-0`;

            // Send RESULT_SET_PENDING
            this.webviewManager.sendResultSetPending(
              fileUri,
              runId,
              resultSetId,
              `${tableName} Schema`,
              0,
              sql
            );

            // Track this result set as running
            this.runningResultSets.get(runId)?.add(resultSetId);

            try {
              const result = await session.executeQuery(sql, resultSetId, () => {
                this.webviewManager.sendResultSetStarted(
                  fileUri,
                  runId,
                  resultSetId,
                  `${tableName} Schema`,
                  0,
                  sql
                );
              });

              if (!result.success) {
                this.webviewManager.sendResultSetError(fileUri, runId, resultSetId, {
                  message: result.error || "Unknown error",
                  type: result.errorType,
                  details: result.errorDetails,
                  rawError: result.rawError,
                  traceback: result.traceback,
                });
                this.runningResultSets.get(runId)?.delete(resultSetId);
              } else if (result.hasResults && result.columns && result.rows) {
                this.webviewManager.sendResultSetSchema(
                  fileUri,
                  runId,
                  resultSetId,
                  result.columns
                );

                this.webviewManager.sendResultSetRows(
                  fileUri,
                  runId,
                  resultSetId,
                  result.rows,
                  false
                );

                this.webviewManager.sendResultSetComplete(
                  fileUri,
                  runId,
                  resultSetId,
                  result.rowCount || 0,
                  result.executionTimeMs || 0
                );
                this.runningResultSets.get(runId)?.delete(resultSetId);
              } else {
                this.webviewManager.sendResultSetSchema(
                  fileUri,
                  runId,
                  resultSetId,
                  [{ name: "Message", type: "string" }]
                );

                this.webviewManager.sendResultSetRows(
                  fileUri,
                  runId,
                  resultSetId,
                  [{ Message: result.message || "No schema information available" }],
                  false
                );

                this.webviewManager.sendResultSetComplete(
                  fileUri,
                  runId,
                  resultSetId,
                  result.rowCount || 0,
                  result.executionTimeMs || 0
                );
                this.runningResultSets.get(runId)?.delete(resultSetId);
              }
            } catch (error: any) {
              this.webviewManager.sendResultSetError(fileUri, runId, resultSetId, {
                message: error.message || "Unknown error",
                type: "Execution Error",
                rawError: error.stack || error.toString(),
              });
              this.runningResultSets.get(runId)?.delete(resultSetId);
            }

            // Send RUN_COMPLETE
            this.webviewManager.sendRunComplete(fileUri, runId);
            vscode.window.showInformationMessage(
              `Described table: ${tableName}`
            );
          } catch (error: any) {
            this.webviewManager.sendRunError(
              fileUri,
              runId,
              error.message || "Unknown error"
            );
            vscode.window.showErrorMessage(
              `Failed to describe table: ${error.message}`
            );
          } finally {
            this.runningQueries.delete(runId);
            this.runningResultSets.delete(runId);
            this.cancelledRuns.delete(runId);
          }
        }
      );
    } catch (error: any) {
      this.runningQueries.delete(runId);
      this.runningResultSets.delete(runId);
      this.cancelledRuns.delete(runId);
      vscode.window.showErrorMessage(`Unexpected error: ${error.message}`);
      console.error("Describe table error:", error);
    }
  }

  /**
   * Export query result to CSV file
   */
  async exportQueryResult(
    uri: vscode.Uri,
    startOffset: number,
    endOffset: number
  ) {
    // Find the document
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const sql = text.substring(startOffset, endOffset).trim();

    if (!sql) {
      vscode.window.showWarningMessage("No SQL statement found at position");
      return;
    }

    // Extract and register table references for Intellisense
    this.extractAndRegisterTableReferences([{ sql, statementIndex: 0 }]);

    // Generate run ID early so we can use it in catch blocks
    const runId = this.generateId();

    try {
      const fileUri = uri.toString();
      const fileName = path.basename(document.fileName);
      const fileDir = path.dirname(document.fileName);

      // Get export directory from settings
      const config = vscode.workspace.getConfiguration("sqlRunner");
      let exportDir = config.get<string>("exportDirectory") || "";
      
      // If no export directory configured, use the SQL file's directory
      if (!exportDir) {
        exportDir = fileDir;
      }

      // Ensure export directory exists
      if (!fs.existsSync(exportDir)) {
        try {
          fs.mkdirSync(exportDir, { recursive: true });
        } catch (mkdirError: any) {
          vscode.window.showErrorMessage(
            `Failed to create export directory: ${mkdirError.message}`
          );
          return;
        }
      }

      // Generate export filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const baseName = path.basename(document.fileName, ".sql");
      const exportFileName = `${baseName}_export_${timestamp}.csv`;
      const exportPath = path.join(exportDir, exportFileName);

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
          `Failed to create database session: ${error.message}`
        );
        return;
      }

      // Show progress
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Executing and exporting SQL query...",
          cancellable: true,
        },
        async (progress, token) => {
          try {
            // Check if query was cancelled by user
            if (this.cancelledRuns.has(runId)) {
              console.log("[SqlExecutor] Query was cancelled before execution");
              return;
            }

            if (token.isCancellationRequested) {
              return;
            }

            // Send RUN_STARTED message
            this.queryCounter++;
            this.webviewManager.sendRunStarted(
              fileUri,
              runId,
              sql,
              `Export ${this.queryCounter}`
            );

            const resultSetId = `${runId}-rs-0`;

            // Send RESULT_SET_PENDING
            this.webviewManager.sendResultSetPending(
              fileUri,
              runId,
              resultSetId,
              `Result 1`,
              0,
              sql
            );

            // Track this result set as running
            this.runningResultSets.get(runId)?.add(resultSetId);

            try {
              const result = await session.executeQuery(sql, resultSetId, () => {
                this.webviewManager.sendResultSetStarted(
                  fileUri,
                  runId,
                  resultSetId,
                  `Result 1`,
                  0,
                  sql
                );
              });

              if (!result.success) {
                this.webviewManager.sendResultSetError(fileUri, runId, resultSetId, {
                  message: result.error || "Unknown error",
                  type: result.errorType,
                  details: result.errorDetails,
                  rawError: result.rawError,
                  traceback: result.traceback,
                });
                this.runningResultSets.get(runId)?.delete(resultSetId);
              } else if (result.hasResults && result.columns && result.rows) {
                // Export to CSV
                const csvContent = this.convertToCSV(result.columns, result.rows);
                fs.writeFileSync(exportPath, csvContent, "utf-8");

                // Send results to webview
                this.webviewManager.sendResultSetSchema(
                  fileUri,
                  runId,
                  resultSetId,
                  result.columns
                );

                this.webviewManager.sendResultSetRows(
                  fileUri,
                  runId,
                  resultSetId,
                  result.rows,
                  false
                );

                this.webviewManager.sendResultSetComplete(
                  fileUri,
                  runId,
                  resultSetId,
                  result.rowCount || 0,
                  result.executionTimeMs || 0
                );
                this.runningResultSets.get(runId)?.delete(resultSetId);

                // Show success message with export info
                vscode.window
                  .showInformationMessage(
                    `Exported ${result.rowCount || 0} rows to ${exportFileName}`,
                    "Open File",
                    "Open Folder"
                  )
                  .then((selection) => {
                    if (selection === "Open File") {
                      vscode.commands.executeCommand(
                        "vscode.open",
                        vscode.Uri.file(exportPath)
                      );
                    } else if (selection === "Open Folder") {
                      vscode.commands.executeCommand(
                        "revealFileInOS",
                        vscode.Uri.file(exportPath)
                      );
                    }
                  });
              } else {
                // DDL/DML query with no results - nothing to export
                this.webviewManager.sendResultSetSchema(
                  fileUri,
                  runId,
                  resultSetId,
                  [{ name: "Message", type: "string" }]
                );

                this.webviewManager.sendResultSetRows(
                  fileUri,
                  runId,
                  resultSetId,
                  [{ Message: "Query executed but returned no data to export" }],
                  false
                );

                this.webviewManager.sendResultSetComplete(
                  fileUri,
                  runId,
                  resultSetId,
                  0,
                  result.executionTimeMs || 0
                );
                this.runningResultSets.get(runId)?.delete(resultSetId);

                vscode.window.showWarningMessage(
                  "Query executed but returned no data to export"
                );
              }
            } catch (error: any) {
              this.webviewManager.sendResultSetError(fileUri, runId, resultSetId, {
                message: error.message || "Unknown error",
                type: "Execution Error",
                rawError: error.stack || error.toString(),
              });
              this.runningResultSets.get(runId)?.delete(resultSetId);
            }

            // Send RUN_COMPLETE
            this.webviewManager.sendRunComplete(fileUri, runId);
          } catch (error: any) {
            this.webviewManager.sendRunError(
              fileUri,
              runId,
              error.message || "Unknown error"
            );
            vscode.window.showErrorMessage(
              `Export failed: ${error.message}`
            );
          } finally {
            this.runningQueries.delete(runId);
            this.runningResultSets.delete(runId);
            this.cancelledRuns.delete(runId);
          }
        }
      );
    } catch (error: any) {
      this.runningQueries.delete(runId);
      this.runningResultSets.delete(runId);
      this.cancelledRuns.delete(runId);
      vscode.window.showErrorMessage(`Unexpected error: ${error.message}`);
      console.error("Export query error:", error);
    }
  }

  /**
   * Convert query results to CSV format
   */
  private convertToCSV(
    columns: Array<{ name: string; type: string }>,
    rows: Array<Record<string, any>>
  ): string {
    const escapeCSV = (value: any): string => {
      if (value === null || value === undefined) {
        return "";
      }
      const str = String(value);
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Header row
    const header = columns.map((col) => escapeCSV(col.name)).join(",");

    // Data rows
    const dataRows = rows.map((row) =>
      columns.map((col) => escapeCSV(row[col.name])).join(",")
    );

    return [header, ...dataRows].join("\n");
  }

  /**
   * Cleanup resources
   */
  async dispose() {
    await this.sessionManager.closeAllSessions();
    this.webviewManager.closeAllPanels();
  }
}
