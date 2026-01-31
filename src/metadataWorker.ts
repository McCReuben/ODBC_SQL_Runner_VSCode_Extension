/**
 * Metadata Worker - Background service for refreshing database schema metadata
 * 
 * Handles:
 * - Fetching schemas via SHOW DATABASES
 * - Fetching tables via SHOW TABLES IN <schema>
 * - Fetching columns via DESCRIBE <schema.table>
 * 
 * Considerations:
 * - Respects max session limit (12 sessions globally)
 * - Uses a dedicated session for metadata operations
 * - Throttles requests to avoid overwhelming the database
 * - Queues refresh requests and processes them sequentially
 */

import * as vscode from "vscode";
import { SchemaMetadataStore, ColumnInfo } from "./schemaMetadata";
import { PythonRunner } from "./pythonRunner";
import * as path from "path";

/**
 * Refresh request types
 */
type RefreshRequest =
  | { type: "schemas" }
  | { type: "tables"; schema: string }
  | { type: "columns"; schema: string; table: string };

/**
 * Worker state
 */
type WorkerState = "idle" | "busy" | "starting" | "error";

/**
 * MetadataWorker - Background service for refreshing metadata
 */
export class MetadataWorker implements vscode.Disposable {
  private metadataStore: SchemaMetadataStore;
  private pythonRunner: PythonRunner | null = null;
  private extensionPath: string;
  
  // Queue management
  private requestQueue: RefreshRequest[] = [];
  private isProcessing = false;
  private state: WorkerState = "idle";
  
  // Timing
  private lastRequestTime = 0;
  private minRequestInterval = 500; // ms between requests
  private refreshInterval: NodeJS.Timeout | null = null;
  private autoRefreshIntervalMs = 3600000; // 1 hour default
  
  // Session management
  private sessionCreationPromise: Promise<void> | null = null;
  
  // Events
  private _onStateChanged = new vscode.EventEmitter<WorkerState>();
  public readonly onStateChanged = this._onStateChanged.event;
  
  private _onError = new vscode.EventEmitter<string>();
  public readonly onError = this._onError.event;

  constructor(
    private context: vscode.ExtensionContext,
    metadataStore: SchemaMetadataStore
  ) {
    this.extensionPath = context.extensionPath;
    this.metadataStore = metadataStore;
    
    // Load config
    this.loadConfig();
    
    // Watch for config changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("sqlRunner.intellisense")) {
        this.loadConfig();
      }
    });
    
    // Listen for new schemas/tables to auto-refresh columns
    this.metadataStore.onTableAdded(({ schema, table }) => {
      // Queue column refresh for newly added tables
      this.queueRequest({ type: "columns", schema, table });
    });
  }

  /**
   * Load configuration
   */
  private loadConfig(): void {
    const config = vscode.workspace.getConfiguration("sqlRunner.intellisense");
    this.autoRefreshIntervalMs = config.get<number>("autoRefreshIntervalMs", 3600000);
    this.minRequestInterval = config.get<number>("requestThrottleMs", 500);
  }

  /**
   * Start the worker (create session and begin processing)
   */
  async start(): Promise<void> {
    if (this.pythonRunner?.isRunning()) {
      return;
    }
    
    this.setState("starting");
    
    try {
      await this.ensureSession();
      this.startAutoRefresh();
      this.setState("idle");
      
      // Initial refresh of schemas
      this.queueRequest({ type: "schemas" });
      
      console.log("[MetadataWorker] Started successfully");
    } catch (error: any) {
      console.error("[MetadataWorker] Failed to start:", error);
      this.setState("error");
      this._onError.fire(error.message);
    }
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    this.stopAutoRefresh();
    
    if (this.pythonRunner) {
      try {
        await this.pythonRunner.close();
      } catch (error) {
        console.error("[MetadataWorker] Error closing session:", error);
      }
      this.pythonRunner = null;
    }
    
    this.requestQueue = [];
    this.isProcessing = false;
    this.setState("idle");
    
    console.log("[MetadataWorker] Stopped");
  }

  /**
   * Ensure we have an active session
   */
  private async ensureSession(): Promise<void> {
    // If already creating, wait for it
    if (this.sessionCreationPromise) {
      await this.sessionCreationPromise;
      return;
    }
    
    if (this.pythonRunner?.isRunning()) {
      return;
    }
    
    this.sessionCreationPromise = this.createSession();
    
    try {
      await this.sessionCreationPromise;
    } finally {
      this.sessionCreationPromise = null;
    }
  }

  /**
   * Create a new Python session for metadata queries
   */
  private async createSession(): Promise<void> {
    const config = vscode.workspace.getConfiguration("sqlRunner");
    const pythonPath = config.get<string>("pythonPath", "python3");
    const dsn = config.get<string>("odbcDsn", "Hermes");
    const useMock = config.get<boolean>("useMockDatabase", false);
    
    const scriptName = useMock ? "sql_executor_mock.py" : "sql_executor.py";
    const scriptPath = path.join(this.extensionPath, "python", scriptName);
    
    this.pythonRunner = new PythonRunner(pythonPath, scriptPath);
    
    try {
      await this.pythonRunner.start(dsn);
      console.log("[MetadataWorker] Session created successfully");
    } catch (error: any) {
      this.pythonRunner = null;
      throw new Error(`Failed to create metadata session: ${error.message}`);
    }
  }

  /**
   * Set worker state
   */
  private setState(state: WorkerState): void {
    if (this.state !== state) {
      this.state = state;
      this._onStateChanged.fire(state);
    }
  }

  /**
   * Start auto-refresh timer
   */
  private startAutoRefresh(): void {
    if (this.refreshInterval) {
      return;
    }
    
    this.refreshInterval = setInterval(() => {
      this.scheduleRefreshCycle();
    }, this.autoRefreshIntervalMs);
  }

  /**
   * Stop auto-refresh timer
   */
  private stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Schedule a full refresh cycle
   */
  scheduleRefreshCycle(): void {
    // Queue schema refresh
    this.queueRequest({ type: "schemas" });
    
    // Queue table refresh for schemas needing refresh
    const schemasToRefresh = this.metadataStore.getSchemasNeedingRefresh(this.autoRefreshIntervalMs);
    for (const schema of schemasToRefresh) {
      this.queueRequest({ type: "tables", schema });
    }
    
    // Queue column refresh for tables needing refresh
    const tablesToRefresh = this.metadataStore.getTablesNeedingColumnRefresh(this.autoRefreshIntervalMs);
    for (const { schema, table } of tablesToRefresh) {
      this.queueRequest({ type: "columns", schema, table });
    }
  }

  /**
   * Queue a refresh request
   */
  queueRequest(request: RefreshRequest): void {
    // Deduplicate requests
    const isDuplicate = this.requestQueue.some((r) => {
      if (r.type !== request.type) return false;
      if (r.type === "schemas") return true;
      if (r.type === "tables" && request.type === "tables") {
        return r.schema === request.schema;
      }
      if (r.type === "columns" && request.type === "columns") {
        return r.schema === request.schema && r.table === request.table;
      }
      return false;
    });
    
    if (!isDuplicate) {
      this.requestQueue.push(request);
      this.processQueue();
    }
  }

  /**
   * Refresh a specific schema's tables
   */
  refreshSchema(schemaName: string): void {
    this.queueRequest({ type: "tables", schema: schemaName });
  }

  /**
   * Refresh a specific table's columns
   */
  refreshTable(schemaName: string, tableName: string): void {
    this.queueRequest({ type: "columns", schema: schemaName, table: tableName });
  }

  /**
   * Process the request queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    
    if (this.requestQueue.length === 0) {
      this.setState("idle");
      return;
    }
    
    this.isProcessing = true;
    this.setState("busy");
    
    try {
      await this.ensureSession();
      
      while (this.requestQueue.length > 0) {
        // Throttle requests
        const now = Date.now();
        const timeSinceLast = now - this.lastRequestTime;
        if (timeSinceLast < this.minRequestInterval) {
          await this.sleep(this.minRequestInterval - timeSinceLast);
        }
        
        const request = this.requestQueue.shift()!;
        this.lastRequestTime = Date.now();
        
        try {
          await this.processRequest(request);
        } catch (error: any) {
          console.error(`[MetadataWorker] Error processing request:`, error);
          // If session died, try to recreate it
          if (!this.pythonRunner?.isRunning()) {
            try {
              await this.ensureSession();
            } catch (sessionError) {
              console.error("[MetadataWorker] Failed to recreate session:", sessionError);
              this.setState("error");
              break;
            }
          }
        }
      }
    } finally {
      this.isProcessing = false;
      if (this.requestQueue.length === 0) {
        this.setState("idle");
      }
    }
  }

  /**
   * Process a single request
   */
  private async processRequest(request: RefreshRequest): Promise<void> {
    if (!this.pythonRunner?.isRunning()) {
      throw new Error("No active session");
    }
    
    switch (request.type) {
      case "schemas":
        await this.fetchSchemas();
        break;
      case "tables":
        await this.fetchTables(request.schema);
        break;
      case "columns":
        await this.fetchColumns(request.schema, request.table);
        break;
    }
  }

  /**
   * Fetch available schemas (databases)
   */
  private async fetchSchemas(): Promise<void> {
    console.log("[MetadataWorker] Fetching schemas...");
    
    const result = await this.pythonRunner!.executeQuery(
      "SHOW DATABASES",
      "metadata-schemas",
      undefined,
      100 // Limit to 100 schemas initially
    );
    
    if (!result.success) {
      console.error("[MetadataWorker] Failed to fetch schemas:", result.error);
      return;
    }
    
    if (!result.rows || result.rows.length === 0) {
      console.log("[MetadataWorker] No schemas returned");
      return;
    }
    
    // SHOW DATABASES typically returns a "databaseName" or "namespace" column
    const schemaColumn = result.columns?.find(
      (c) => c.name.toLowerCase().includes("database") || c.name.toLowerCase().includes("namespace")
    );
    
    const columnName = schemaColumn?.name || Object.keys(result.rows[0])[0];
    
    for (const row of result.rows) {
      const schemaName = row[columnName];
      if (schemaName) {
        // Add schema if it's in the allow-list or was auto-discovered
        const existingSchema = this.metadataStore.getSchema(schemaName);
        if (existingSchema) {
          // Update existing schema
          this.metadataStore.addSchema(schemaName, existingSchema.isFromAllowList);
        }
      }
    }
    
    console.log(`[MetadataWorker] Fetched ${result.rows.length} schemas`);
  }

  /**
   * Fetch tables in a schema
   */
  private async fetchTables(schemaName: string): Promise<void> {
    console.log(`[MetadataWorker] Fetching tables for schema: ${schemaName}`);
    
    const result = await this.pythonRunner!.executeQuery(
      `SHOW TABLES IN ${schemaName}`,
      `metadata-tables-${schemaName}`,
      undefined,
      1000 // Limit to 1000 tables
    );
    
    if (!result.success) {
      console.error(`[MetadataWorker] Failed to fetch tables for ${schemaName}:`, result.error);
      return;
    }
    
    if (!result.rows || result.rows.length === 0) {
      console.log(`[MetadataWorker] No tables found in ${schemaName}`);
      return;
    }
    
    // SHOW TABLES typically returns a "tableName" column
    const tableColumn = result.columns?.find(
      (c) => c.name.toLowerCase().includes("table") || c.name.toLowerCase().includes("name")
    );
    
    const columnName = tableColumn?.name || Object.keys(result.rows[0])[0];
    
    for (const row of result.rows) {
      const tableName = row[columnName];
      if (tableName) {
        // Check if table already exists
        const existingTable = this.metadataStore.getTable(schemaName, tableName);
        if (!existingTable) {
          // Add new table (will be marked as auto-discovered)
          this.metadataStore.addTable(schemaName, tableName, [], false);
        }
      }
    }
    
    console.log(`[MetadataWorker] Fetched ${result.rows.length} tables for ${schemaName}`);
  }

  /**
   * Fetch columns for a table
   */
  private async fetchColumns(schemaName: string, tableName: string): Promise<void> {
    console.log(`[MetadataWorker] Fetching columns for: ${schemaName}.${tableName}`);
    
    const result = await this.pythonRunner!.executeQuery(
      `DESCRIBE ${schemaName}.${tableName}`,
      `metadata-columns-${schemaName}-${tableName}`,
      undefined,
      500 // Limit columns
    );
    
    if (!result.success) {
      console.error(`[MetadataWorker] Failed to fetch columns for ${schemaName}.${tableName}:`, result.error);
      return;
    }
    
    if (!result.rows || result.rows.length === 0) {
      console.log(`[MetadataWorker] No columns found for ${schemaName}.${tableName}`);
      return;
    }
    
    // DESCRIBE typically returns col_name, data_type, comment columns
    const columns: ColumnInfo[] = [];
    
    for (const row of result.rows) {
      // Handle different DESCRIBE output formats
      const colName = row["col_name"] || row["column_name"] || row["name"] || Object.values(row)[0];
      const colType = row["data_type"] || row["type"] || row["data_type_desc"] || Object.values(row)[1] || "unknown";
      const colComment = row["comment"] || row["description"] || "";
      
      if (colName && !colName.startsWith("#")) { // Skip partition info rows
        columns.push({
          name: colName,
          type: colType,
          comment: colComment || undefined,
        });
      }
    }
    
    // Update the table with columns
    this.metadataStore.updateTableColumns(schemaName, tableName, columns);
    
    console.log(`[MetadataWorker] Fetched ${columns.length} columns for ${schemaName}.${tableName}`);
  }

  /**
   * Helper: sleep for ms
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current worker state
   */
  getState(): WorkerState {
    return this.state;
  }

  /**
   * Get queue length
   */
  getQueueLength(): number {
    return this.requestQueue.length;
  }

  dispose(): void {
    this.stop();
    this._onStateChanged.dispose();
    this._onError.dispose();
  }
}
