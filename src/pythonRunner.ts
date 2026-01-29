/**
 * Manages Python child processes for SQL execution
 */

import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as vscode from "vscode";

export interface PythonMessage {
  type: string;
  payload?: any;
}

export interface ExecuteRequest {
  sql: string;
  resultSetId: string;
}

export interface ErrorDetails {
  line?: number;
  position?: number;
  tableName?: string;
  columnName?: string;
  suggestions?: string[];
  nearText?: string;
  sqlSnippet?: string;
  literalType?: string;
  invalidValue?: string;
}

export interface ExecuteResult {
  success: boolean;
  resultSetId: string;
  hasResults?: boolean;
  columns?: Array<{ name: string; type: string }>;
  rows?: any[];
  rowCount?: number;
  executionTimeMs?: number;
  // Legacy error fields
  error?: string;
  message?: string;
  traceback?: string;
  // New structured error fields
  errorType?: string;
  errorDetails?: ErrorDetails;
  rawError?: string;
}

interface QueuedQuery {
  sql: string;
  resultSetId: string;
  resolve: (result: ExecuteResult) => void;
  reject: (error: Error) => void;
  onStarted?: () => void;
}

export class PythonRunner {
  private process: ChildProcess | null = null;
  private messageHandlers: Map<string, (message: PythonMessage) => void> =
    new Map();
  private outputBuffer = "";
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolver!: () => void;
  
  // Query queue for sequential execution
  private queryQueue: QueuedQuery[] = [];
  private isExecutingQuery = false;

  constructor(
    private pythonPath: string,
    private scriptPath: string,
  ) {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolver = resolve;
    });
  }

  async start(dsn: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Spawn the Python process
        this.process = spawn(this.pythonPath, [this.scriptPath], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Handle stdout (JSON messages)
        this.process.stdout?.on("data", (data: Buffer) => {
          this.handleStdout(data);
        });

        // Handle stderr (logs/errors)
        this.process.stderr?.on("data", (data: Buffer) => {
          console.error("[Python stderr]:", data.toString());
        });

        // Handle process exit
        this.process.on("exit", (code) => {
          console.log(`Python process exited with code ${code}`);
          this.isReady = false;
        });

        // Handle process errors
        this.process.on("error", (error) => {
          console.error("Python process error:", error);
          reject(error);
        });

        // Wait for ready message
        this.readyPromise.then(() => {
          // Send connect command
          this.sendCommand({ type: "CONNECT", dsn })
            .then((result) => {
              if (result.payload?.success) {
                resolve();
              } else {
                reject(new Error(result.payload?.error || "Connection failed"));
              }
            })
            .catch(reject);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleStdout(data: Buffer) {
    this.outputBuffer += data.toString();

    // Process complete JSON messages (line by line)
    let newlineIndex: number;
    while ((newlineIndex = this.outputBuffer.indexOf("\n")) !== -1) {
      const line = this.outputBuffer.substring(0, newlineIndex).trim();
      this.outputBuffer = this.outputBuffer.substring(newlineIndex + 1);

      if (line.length === 0) {
        continue;
      }

      try {
        const message: PythonMessage = JSON.parse(line);
        this.handleMessage(message);
      } catch (error) {
        console.error("Failed to parse JSON from Python:", line, error);
      }
    }
  }

  private handleMessage(message: PythonMessage) {
    // Handle READY message
    if (message.type === "READY") {
      this.isReady = true;
      this.readyResolver();
      return;
    }

    // DEBUG: Log received message
    if (message.type === "EXECUTE_RESULT") {
      console.log("[DEBUG] PythonRunner received EXECUTE_RESULT:", {
        type: message.type,
        success: message.payload?.success,
        hasResults: message.payload?.hasResults,
        rowCount: message.payload?.rowCount,
        columnsLength: message.payload?.columns?.length,
        rowsLength: message.payload?.rows?.length,
        payloadKeys: message.payload ? Object.keys(message.payload) : []
      });
    }

    if (message.type === "ERROR") {
      console.log("[DEBUG] PythonRunner received ERROR:", {
        type: message.type,
        payload: message.payload
      });
    }

    // Call registered handler
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler(message);
      this.messageHandlers.delete(message.type);
    } else {
      console.log("[DEBUG] No handler registered for message type:", message.type);
      console.log("[DEBUG] Full message:", JSON.stringify(message, null, 2));
      console.log("[DEBUG] Registered handlers:", Array.from(this.messageHandlers.keys()));
    }
  }

  private sendCommand(command: any): Promise<PythonMessage> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        reject(new Error("Python process not started"));
        return;
      }

      // Determine expected response type
      let responseType: string;
      switch (command.type) {
        case "CONNECT":
          responseType = "CONNECT_RESULT";
          break;
        case "RECONNECT":
          responseType = "RECONNECT_RESULT";
          break;
        case "EXECUTE":
          console.log("Sending EXECUTE command for SQL:", command.sql);
          responseType = "EXECUTE_RESULT";
          break;
        case "CLOSE":
          responseType = "CLOSE_RESULT";
          break;
        default:
          responseType = "ERROR";
      }

      // Register handler for expected response
      this.messageHandlers.set(responseType, (message) => {
        this.messageHandlers.delete("ERROR"); // Clean up error handler
        resolve(message);
      });

      // Also register handler for ERROR in case something goes wrong
      const errorHandler = (message: PythonMessage) => {
        this.messageHandlers.delete(responseType); // Clean up success handler
        reject(new Error(`Python error: ${JSON.stringify(message.payload)}`));
      };
      this.messageHandlers.set("ERROR", errorHandler);

      // Send command
      try {
        this.process.stdin.write(JSON.stringify(command) + "\n");
      } catch (error) {
        this.messageHandlers.delete(responseType);
        this.messageHandlers.delete("ERROR");
        reject(error);
      }
    });
  }

  /**
   * Execute a query, queuing it if another query is already running.
   * This ensures sequential execution within a session.
   * @param onStarted - Optional callback invoked when query actually starts executing (not just queued)
   */
  async executeQuery(
    sql: string, 
    resultSetId: string,
    onStarted?: () => void
  ): Promise<ExecuteResult> {
    await this.readyPromise;

    return new Promise((resolve, reject) => {
      // Add to queue
      this.queryQueue.push({ sql, resultSetId, resolve, reject, onStarted });
      
      // Process queue if not already processing
      this.processQueryQueue();
    });
  }

  /**
   * Process the query queue sequentially
   */
  private async processQueryQueue(): Promise<void> {
    // If already executing a query, don't start another
    if (this.isExecutingQuery) {
      return;
    }

    // Get next query from queue
    const query = this.queryQueue.shift();
    if (!query) {
      return;
    }

    this.isExecutingQuery = true;

    try {
      // Call onStarted callback before actually executing
      // This signals that the query has moved from pending to running
      if (query.onStarted) {
        query.onStarted();
      }

      const response = await this.sendCommand({
        type: "EXECUTE",
        sql: query.sql,
        resultSetId: query.resultSetId,
      });

      // DEBUG: Log the parsed result
      console.log("[DEBUG] PythonRunner.executeQuery returning result:", {
        resultSetId: query.resultSetId,
        success: response.payload?.success,
        hasResults: response.payload?.hasResults,
        columnsLength: response.payload?.columns?.length,
        rowsLength: response.payload?.rows?.length,
        payloadKeys: response.payload ? Object.keys(response.payload) : []
      });

      query.resolve(response.payload as ExecuteResult);
    } catch (error: any) {
      query.reject(error);
    } finally {
      this.isExecutingQuery = false;
      
      // Process next query in queue
      this.processQueryQueue();
    }
  }

  /**
   * Clear any pending queries from the queue
   * Used when cancelling a batch - allows clearing queries that haven't started yet
   */
  clearPendingQueries(resultSetIds: string[]): void {
    const idsToCancel = new Set(resultSetIds);
    this.queryQueue = this.queryQueue.filter((query) => {
      if (idsToCancel.has(query.resultSetId)) {
        // Reject with a cancellation error
        query.reject(new Error("Query cancelled"));
        return false;
      }
      return true;
    });
  }

  async reconnect(): Promise<{ success: boolean; message?: string; error?: string }> {
    await this.readyPromise;
    
    const response = await this.sendCommand({ type: "RECONNECT" });
    return response.payload as { success: boolean; message?: string; error?: string };
  }

  async close(): Promise<void> {
    if (this.process) {
      await this.sendCommand({ type: "CLOSE" });
      this.process.kill();
      this.process = null;
    }
  }

  /**
   * Cancel/kill the running Python process immediately
   * This will terminate any running query and lose session state
   */
  cancel(): void {
    // Clear all pending queries from the queue
    for (const query of this.queryQueue) {
      query.reject(new Error("Query cancelled - session terminated"));
    }
    this.queryQueue = [];
    this.isExecutingQuery = false;

    if (this.process) {
      console.log("[PythonRunner] Cancelling query by killing process");
      this.process.kill("SIGTERM");
      this.process = null;
      this.isReady = false;
    }
  }

  isRunning(): boolean {
    return this.process !== null && this.isReady;
  }
}

/**
 * Manages Python sessions per file
 */
export class SessionManager {
  private sessions: Map<string, PythonRunner> = new Map();
  private extensionPath: string;

  constructor(private context: vscode.ExtensionContext) {
    this.extensionPath = context.extensionPath;
  }

  async getOrCreateSession(fileUri: string): Promise<PythonRunner> {
    // Check if session already exists
    let session = this.sessions.get(fileUri);

    if (session && session.isRunning()) {
      return session;
    }

    // Create new session
    const config = vscode.workspace.getConfiguration("sqlRunner");
    const pythonPath = config.get<string>("pythonPath", "python3");
    const dsn = config.get<string>("odbcDsn", "Hermes");
    const useMock = config.get<boolean>("useMockDatabase", false);

    // Choose the correct Python script based on mock mode
    const scriptName = useMock ? "sql_executor_mock.py" : "sql_executor.py";
    const scriptPath = path.join(this.extensionPath, "python", scriptName);

    session = new PythonRunner(pythonPath, scriptPath);

    try {
      await session.start(dsn);
      this.sessions.set(fileUri, session);
      return session;
    } catch (error) {
      throw new Error(`Failed to start Python session: ${error}`);
    }
  }

  /**
   * Reconnect to the database for a session
   */
  async reconnectSession(fileUri: string): Promise<{ success: boolean; message?: string; error?: string }> {
    const session = this.sessions.get(fileUri);
    if (!session) {
      return {
        success: false,
        error: "No active session found"
      };
    }

    try {
      return await session.reconnect();
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Reconnection failed"
      };
    }
  }

  /**
   * Cancel the running query for a session by killing the Python process
   * The session will be removed and recreated on next query
   * WARNING: This will lose session state (temporary tables, etc.)
   */
  cancelSession(fileUri: string): void {
    const session = this.sessions.get(fileUri);
    if (session) {
      session.cancel();
      this.sessions.delete(fileUri);
    }
  }

  async closeSession(fileUri: string): Promise<void> {
    const session = this.sessions.get(fileUri);
    if (session) {
      await session.close();
      this.sessions.delete(fileUri);
    }
  }

  async closeAllSessions(): Promise<void> {
    const promises = Array.from(this.sessions.values()).map((session) =>
      session.close(),
    );
    await Promise.all(promises);
    this.sessions.clear();
  }
}
