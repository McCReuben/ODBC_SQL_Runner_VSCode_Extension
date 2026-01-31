/**
 * Schema Metadata Storage and Management
 * 
 * Stores and manages database schema metadata for Intellisense:
 * - Schemas (databases)
 * - Tables within schemas
 * - Columns within tables
 * 
 * Configuration is managed via files in .sqlrunner/ folder:
 * - schemas.txt: Schemas to fully scan (all tables will be discovered)
 * - tables.txt: Specific tables to include (schema.table format)
 * 
 * Supports:
 * - File-based configuration for schemas to scan and tables to include
 * - Automatic expansion based on query usage
 * - Persistence of discovered metadata
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * Column metadata
 */
export interface ColumnInfo {
  name: string;
  type: string;
  comment?: string;
}

/**
 * Table metadata
 */
export interface TableInfo {
  name: string;
  schema: string;
  columns: ColumnInfo[];
  lastRefreshed?: number; // timestamp
  source: "scanned" | "configured" | "auto-discovered";
}

/**
 * Schema metadata
 */
export interface SchemaInfo {
  name: string;
  tables: Map<string, TableInfo>; // tableName -> TableInfo
  lastRefreshed?: number;
  shouldScan: boolean; // true if this schema should have all tables discovered
  source: "scanned" | "configured" | "auto-discovered";
}

/**
 * Serializable format for persistence
 */
interface SerializedMetadata {
  version: number;
  schemas: {
    name: string;
    lastRefreshed?: number;
    shouldScan: boolean;
    source: "scanned" | "configured" | "auto-discovered";
    tables: {
      name: string;
      schema: string;
      columns: ColumnInfo[];
      lastRefreshed?: number;
      source: "scanned" | "configured" | "auto-discovered";
    }[];
  }[];
}

/**
 * SchemaMetadataStore - Central storage for database metadata
 */
export class SchemaMetadataStore implements vscode.Disposable {
  private schemas: Map<string, SchemaInfo> = new Map();
  private schemasToScan: Set<string> = new Set(); // Schemas from schemas.txt
  private configuredTables: Set<string> = new Set(); // Tables from tables.txt (schema.table)
  private metadataStoragePath: string;
  private configFolderPath: string;
  private schemasFilePath: string;
  private tablesFilePath: string;
  private isDirty: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;
  private fileWatchers: vscode.FileSystemWatcher[] = [];
  
  // Event emitters
  private _onMetadataChanged = new vscode.EventEmitter<void>();
  private _onSchemaAdded = new vscode.EventEmitter<string>();
  private _onTableAdded = new vscode.EventEmitter<{ schema: string; table: string }>();
  private _onConfigChanged = new vscode.EventEmitter<void>();
  
  public readonly onMetadataChanged = this._onMetadataChanged.event;
  public readonly onSchemaAdded = this._onSchemaAdded.event;
  public readonly onTableAdded = this._onTableAdded.event;
  public readonly onConfigChanged = this._onConfigChanged.event;

  constructor(private context: vscode.ExtensionContext) {
    // Store metadata in global storage (persists across workspaces)
    this.metadataStoragePath = path.join(
      context.globalStorageUri.fsPath,
      "schema-metadata.json"
    );
    
    // Config files in workspace .sqlrunner folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      this.configFolderPath = path.join(workspaceFolder.uri.fsPath, ".sqlrunner");
    } else {
      // Fallback to extension storage if no workspace
      this.configFolderPath = path.join(context.globalStorageUri.fsPath, ".sqlrunner");
    }
    
    this.schemasFilePath = path.join(this.configFolderPath, "schemas.txt");
    this.tablesFilePath = path.join(this.configFolderPath, "tables.txt");
    
    // Ensure directories exist
    this.ensureDirectories();
    
    // Load existing metadata
    this.loadMetadataFromDisk();
    
    // Load configuration from files
    this.loadConfigFiles();
    
    // Watch config files for changes
    this.setupFileWatchers();
  }

  /**
   * Ensure required directories exist
   */
  private ensureDirectories(): void {
    const metadataDir = path.dirname(this.metadataStoragePath);
    if (!fs.existsSync(metadataDir)) {
      fs.mkdirSync(metadataDir, { recursive: true });
    }
    
    if (!fs.existsSync(this.configFolderPath)) {
      fs.mkdirSync(this.configFolderPath, { recursive: true });
    }
  }

  /**
   * Create default config files if they don't exist
   */
  createDefaultConfigFiles(): void {
    if (!fs.existsSync(this.schemasFilePath)) {
      const defaultContent = `# Schemas to scan - one schema name per line
# All tables in these schemas will be discovered and added to Intellisense
# Example:
# ACCESS_VIEWS
# MY_SCHEMA

ACCESS_VIEWS
`;
      fs.writeFileSync(this.schemasFilePath, defaultContent, "utf-8");
      console.log(`[SchemaMetadata] Created default schemas.txt`);
    }
    
    if (!fs.existsSync(this.tablesFilePath)) {
      const defaultContent = `# Specific tables to include - one per line in schema.table format
# Use this for tables in schemas you don't want to fully scan
# Example:
# OTHER_SCHEMA.important_table
# ANOTHER_SCHEMA.lookup_table

`;
      fs.writeFileSync(this.tablesFilePath, defaultContent, "utf-8");
      console.log(`[SchemaMetadata] Created default tables.txt`);
    }
  }

  /**
   * Setup file watchers for config files
   */
  private setupFileWatchers(): void {
    // Watch for changes to schemas.txt and tables.txt
    const schemasWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.configFolderPath, "schemas.txt")
    );
    const tablesWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.configFolderPath, "tables.txt")
    );
    
    const reloadConfig = () => {
      console.log("[SchemaMetadata] Config file changed, reloading...");
      this.loadConfigFiles();
      this._onConfigChanged.fire();
    };
    
    schemasWatcher.onDidChange(reloadConfig);
    schemasWatcher.onDidCreate(reloadConfig);
    tablesWatcher.onDidChange(reloadConfig);
    tablesWatcher.onDidCreate(reloadConfig);
    
    this.fileWatchers.push(schemasWatcher, tablesWatcher);
  }

  /**
   * Load metadata from disk
   */
  private loadMetadataFromDisk(): void {
    try {
      if (fs.existsSync(this.metadataStoragePath)) {
        const data = fs.readFileSync(this.metadataStoragePath, "utf-8");
        const serialized: SerializedMetadata = JSON.parse(data);
        
        // Restore schemas
        for (const schemaData of serialized.schemas) {
          const schemaInfo: SchemaInfo = {
            name: schemaData.name,
            tables: new Map(),
            lastRefreshed: schemaData.lastRefreshed,
            shouldScan: schemaData.shouldScan,
            source: schemaData.source,
          };
          
          for (const tableData of schemaData.tables) {
            schemaInfo.tables.set(tableData.name.toUpperCase(), tableData);
          }
          
          this.schemas.set(schemaData.name.toUpperCase(), schemaInfo);
        }
        
        console.log(`[SchemaMetadata] Loaded ${this.schemas.size} schemas from disk`);
      }
    } catch (error) {
      console.error("[SchemaMetadata] Failed to load metadata from disk:", error);
    }
  }

  /**
   * Load configuration from schemas.txt and tables.txt
   */
  loadConfigFiles(): void {
    this.schemasToScan.clear();
    this.configuredTables.clear();
    
    // Load schemas to scan
    if (fs.existsSync(this.schemasFilePath)) {
      try {
        const content = fs.readFileSync(this.schemasFilePath, "utf-8");
        const lines = content.split("\n");
        
        for (const line of lines) {
          const trimmed = line.trim();
          // Skip empty lines and comments
          if (trimmed && !trimmed.startsWith("#")) {
            this.schemasToScan.add(trimmed.toUpperCase());
            
            // Ensure schema exists in metadata
            if (!this.schemas.has(trimmed.toUpperCase())) {
              this.schemas.set(trimmed.toUpperCase(), {
                name: trimmed,
                tables: new Map(),
                shouldScan: true,
                source: "scanned",
              });
              this._onSchemaAdded.fire(trimmed);
            } else {
              // Update existing schema to be scanned
              const schema = this.schemas.get(trimmed.toUpperCase())!;
              schema.shouldScan = true;
              schema.source = "scanned";
            }
          }
        }
        
        console.log(`[SchemaMetadata] Loaded ${this.schemasToScan.size} schemas to scan`);
      } catch (error) {
        console.error("[SchemaMetadata] Failed to load schemas.txt:", error);
      }
    } else {
      // Create default config files
      this.createDefaultConfigFiles();
      // Reload after creating
      this.loadConfigFiles();
      return;
    }
    
    // Load specific tables
    if (fs.existsSync(this.tablesFilePath)) {
      try {
        const content = fs.readFileSync(this.tablesFilePath, "utf-8");
        const lines = content.split("\n");
        
        for (const line of lines) {
          const trimmed = line.trim();
          // Skip empty lines and comments
          if (trimmed && !trimmed.startsWith("#")) {
            const parts = trimmed.split(".");
            if (parts.length === 2) {
              const [schemaName, tableName] = parts;
              const key = `${schemaName.toUpperCase()}.${tableName.toUpperCase()}`;
              this.configuredTables.add(key);
              
              // Ensure schema and table exist
              this.ensureSchema(schemaName, false);
              const schema = this.schemas.get(schemaName.toUpperCase())!;
              
              if (!schema.tables.has(tableName.toUpperCase())) {
                schema.tables.set(tableName.toUpperCase(), {
                  name: tableName,
                  schema: schemaName,
                  columns: [],
                  source: "configured",
                });
                this._onTableAdded.fire({ schema: schemaName, table: tableName });
              } else {
                // Update source if not already scanned
                const table = schema.tables.get(tableName.toUpperCase())!;
                if (table.source !== "scanned") {
                  table.source = "configured";
                }
              }
            }
          }
        }
        
        console.log(`[SchemaMetadata] Loaded ${this.configuredTables.size} configured tables`);
      } catch (error) {
        console.error("[SchemaMetadata] Failed to load tables.txt:", error);
      }
    }
    
    this.isDirty = true;
    this.saveMetadataToDisk();
    this._onMetadataChanged.fire();
  }

  /**
   * Save metadata to disk (debounced)
   */
  private saveMetadataToDisk(): void {
    if (!this.isDirty) return;
    
    // Debounce saves
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    
    this.saveTimeout = setTimeout(() => {
      this.doSave();
    }, 1000);
  }

  private doSave(): void {
    try {
      const serialized: SerializedMetadata = {
        version: 1,
        schemas: [],
      };
      
      for (const [, schemaInfo] of this.schemas) {
        serialized.schemas.push({
          name: schemaInfo.name,
          lastRefreshed: schemaInfo.lastRefreshed,
          shouldScan: schemaInfo.shouldScan,
          source: schemaInfo.source,
          tables: Array.from(schemaInfo.tables.values()),
        });
      }
      
      fs.writeFileSync(this.metadataStoragePath, JSON.stringify(serialized, null, 2));
      this.isDirty = false;
      console.log(`[SchemaMetadata] Saved ${this.schemas.size} schemas to disk`);
    } catch (error) {
      console.error("[SchemaMetadata] Failed to save metadata to disk:", error);
    }
  }

  /**
   * Ensure a schema exists in the store
   */
  private ensureSchema(schemaName: string, shouldScan: boolean): SchemaInfo {
    const upperName = schemaName.toUpperCase();
    
    if (!this.schemas.has(upperName)) {
      const schemaInfo: SchemaInfo = {
        name: schemaName,
        tables: new Map(),
        shouldScan,
        source: shouldScan ? "scanned" : "auto-discovered",
      };
      this.schemas.set(upperName, schemaInfo);
      this._onSchemaAdded.fire(schemaName);
    }
    
    return this.schemas.get(upperName)!;
  }

  /**
   * Add or update a schema (from metadata refresh)
   */
  addSchema(schemaName: string, source: "scanned" | "configured" | "auto-discovered" = "auto-discovered"): void {
    const upperName = schemaName.toUpperCase();
    const shouldScan = this.schemasToScan.has(upperName);
    const schema = this.ensureSchema(schemaName, shouldScan);
    schema.lastRefreshed = Date.now();
    schema.source = source;
    
    this.isDirty = true;
    this.saveMetadataToDisk();
    this._onMetadataChanged.fire();
  }

  /**
   * Add or update a table (from metadata refresh)
   */
  addTable(
    schemaName: string,
    tableName: string,
    columns: ColumnInfo[] = [],
    source: "scanned" | "configured" | "auto-discovered" = "auto-discovered"
  ): void {
    const schema = this.ensureSchema(schemaName, false);
    const upperTableName = tableName.toUpperCase();
    
    const tableInfo: TableInfo = {
      name: tableName,
      schema: schemaName,
      columns,
      lastRefreshed: Date.now(),
      source,
    };
    
    schema.tables.set(upperTableName, tableInfo);
    
    this.isDirty = true;
    this.saveMetadataToDisk();
    this._onTableAdded.fire({ schema: schemaName, table: tableName });
    this._onMetadataChanged.fire();
  }

  /**
   * Update columns for a table
   */
  updateTableColumns(schemaName: string, tableName: string, columns: ColumnInfo[]): void {
    const schema = this.schemas.get(schemaName.toUpperCase());
    if (!schema) return;
    
    const table = schema.tables.get(tableName.toUpperCase());
    if (!table) return;
    
    table.columns = columns;
    table.lastRefreshed = Date.now();
    
    this.isDirty = true;
    this.saveMetadataToDisk();
    this._onMetadataChanged.fire();
  }

  /**
   * Get all known schemas
   */
  getSchemas(): SchemaInfo[] {
    return Array.from(this.schemas.values());
  }

  /**
   * Get schema names only
   */
  getSchemaNames(): string[] {
    return Array.from(this.schemas.values()).map(s => s.name);
  }

  /**
   * Get schemas that are configured to be fully scanned
   */
  getSchemasToScan(): string[] {
    return Array.from(this.schemasToScan);
  }

  /**
   * Check if a schema should be fully scanned
   */
  shouldScanSchema(schemaName: string): boolean {
    return this.schemasToScan.has(schemaName.toUpperCase());
  }

  /**
   * Get a specific schema
   */
  getSchema(schemaName: string): SchemaInfo | undefined {
    return this.schemas.get(schemaName.toUpperCase());
  }

  /**
   * Get all tables in a schema
   */
  getTables(schemaName: string): TableInfo[] {
    const schema = this.schemas.get(schemaName.toUpperCase());
    if (!schema) return [];
    return Array.from(schema.tables.values());
  }

  /**
   * Get a specific table
   */
  getTable(schemaName: string, tableName: string): TableInfo | undefined {
    const schema = this.schemas.get(schemaName.toUpperCase());
    if (!schema) return undefined;
    return schema.tables.get(tableName.toUpperCase());
  }

  /**
   * Get columns for a table
   */
  getColumns(schemaName: string, tableName: string): ColumnInfo[] {
    const table = this.getTable(schemaName, tableName);
    return table?.columns || [];
  }

  /**
   * Check if a schema needs refresh
   */
  schemaNeedsRefresh(schemaName: string, maxAgeMs: number = 3600000): boolean {
    const schema = this.schemas.get(schemaName.toUpperCase());
    if (!schema) return true;
    if (!schema.lastRefreshed) return true;
    return Date.now() - schema.lastRefreshed > maxAgeMs;
  }

  /**
   * Check if a table needs refresh
   */
  tableNeedsRefresh(schemaName: string, tableName: string, maxAgeMs: number = 3600000): boolean {
    const table = this.getTable(schemaName, tableName);
    if (!table) return true;
    if (!table.lastRefreshed) return true;
    return Date.now() - table.lastRefreshed > maxAgeMs;
  }

  /**
   * Get schemas that are configured to scan but need table refresh
   */
  getSchemasNeedingTableScan(maxAgeMs: number = 3600000): string[] {
    const result: string[] = [];
    
    for (const schemaName of this.schemasToScan) {
      const schema = this.schemas.get(schemaName);
      if (!schema || !schema.lastRefreshed || Date.now() - schema.lastRefreshed > maxAgeMs) {
        result.push(schemaName);
      }
    }
    
    return result;
  }

  /**
   * Get tables that need column refresh
   */
  getTablesNeedingColumnRefresh(maxAgeMs: number = 3600000): { schema: string; table: string }[] {
    const result: { schema: string; table: string }[] = [];
    
    for (const [, schema] of this.schemas) {
      for (const [, table] of schema.tables) {
        // Needs refresh if no columns or stale
        if (
          table.columns.length === 0 ||
          !table.lastRefreshed ||
          Date.now() - table.lastRefreshed > maxAgeMs
        ) {
          result.push({ schema: schema.name, table: table.name });
        }
      }
    }
    
    return result;
  }

  /**
   * Auto-discover schemas/tables from executed SQL
   * Called when a query is executed to expand discovered metadata
   */
  addFromQuery(schemas: string[], tables: { schema: string; table: string }[]): void {
    let changed = false;
    
    for (const schemaName of schemas) {
      const upperName = schemaName.toUpperCase();
      if (!this.schemas.has(upperName)) {
        this.schemas.set(upperName, {
          name: schemaName,
          tables: new Map(),
          shouldScan: false,
          source: "auto-discovered",
        });
        this._onSchemaAdded.fire(schemaName);
        changed = true;
      }
    }
    
    for (const { schema, table } of tables) {
      const schemaInfo = this.ensureSchema(schema, false);
      const upperTableName = table.toUpperCase();
      
      if (!schemaInfo.tables.has(upperTableName)) {
        schemaInfo.tables.set(upperTableName, {
          name: table,
          schema: schema,
          columns: [],
          source: "auto-discovered",
        });
        this._onTableAdded.fire({ schema, table });
        changed = true;
      }
    }
    
    if (changed) {
      this.isDirty = true;
      this.saveMetadataToDisk();
      this._onMetadataChanged.fire();
    }
  }

  /**
   * Clear all auto-discovered schemas/tables (keep configured/scanned items)
   */
  clearAutoDiscovered(): void {
    for (const [schemaName, schema] of this.schemas) {
      if (schema.source === "auto-discovered") {
        this.schemas.delete(schemaName);
      } else {
        // Remove auto-discovered tables from scanned/configured schemas
        for (const [tableName, table] of schema.tables) {
          if (table.source === "auto-discovered") {
            schema.tables.delete(tableName);
          }
        }
      }
    }
    
    this.isDirty = true;
    this.saveMetadataToDisk();
    this._onMetadataChanged.fire();
  }

  /**
   * Add a schema to the schemas.txt file
   */
  addSchemaToConfig(schemaName: string): void {
    if (this.schemasToScan.has(schemaName.toUpperCase())) {
      return; // Already in config
    }
    
    try {
      let content = "";
      if (fs.existsSync(this.schemasFilePath)) {
        content = fs.readFileSync(this.schemasFilePath, "utf-8");
      }
      
      // Add to file
      if (!content.endsWith("\n")) {
        content += "\n";
      }
      content += `${schemaName}\n`;
      
      fs.writeFileSync(this.schemasFilePath, content, "utf-8");
      console.log(`[SchemaMetadata] Added schema ${schemaName} to schemas.txt`);
      
      // Reload will happen via file watcher
    } catch (error) {
      console.error(`[SchemaMetadata] Failed to add schema to config:`, error);
    }
  }

  /**
   * Add a table to the tables.txt file
   */
  addTableToConfig(schemaName: string, tableName: string): void {
    const key = `${schemaName.toUpperCase()}.${tableName.toUpperCase()}`;
    if (this.configuredTables.has(key)) {
      return; // Already in config
    }
    
    try {
      let content = "";
      if (fs.existsSync(this.tablesFilePath)) {
        content = fs.readFileSync(this.tablesFilePath, "utf-8");
      }
      
      // Add to file
      if (!content.endsWith("\n")) {
        content += "\n";
      }
      content += `${schemaName}.${tableName}\n`;
      
      fs.writeFileSync(this.tablesFilePath, content, "utf-8");
      console.log(`[SchemaMetadata] Added table ${schemaName}.${tableName} to tables.txt`);
      
      // Reload will happen via file watcher
    } catch (error) {
      console.error(`[SchemaMetadata] Failed to add table to config:`, error);
    }
  }

  /**
   * Open the config folder in file explorer
   */
  async openConfigFolder(): Promise<void> {
    const uri = vscode.Uri.file(this.configFolderPath);
    await vscode.commands.executeCommand("revealFileInOS", uri);
  }

  /**
   * Open schemas.txt in editor
   */
  async openSchemasFile(): Promise<void> {
    this.createDefaultConfigFiles();
    const uri = vscode.Uri.file(this.schemasFilePath);
    await vscode.window.showTextDocument(uri);
  }

  /**
   * Open tables.txt in editor
   */
  async openTablesFile(): Promise<void> {
    this.createDefaultConfigFiles();
    const uri = vscode.Uri.file(this.tablesFilePath);
    await vscode.window.showTextDocument(uri);
  }

  /**
   * Get statistics about the metadata store
   */
  getStats(): {
    totalSchemas: number;
    totalTables: number;
    tablesWithColumns: number;
    schemasToScan: number;
    configuredTables: number;
    autoDiscoveredSchemas: number;
    autoDiscoveredTables: number;
  } {
    let totalTables = 0;
    let tablesWithColumns = 0;
    let autoDiscoveredSchemas = 0;
    let autoDiscoveredTables = 0;
    
    for (const [, schema] of this.schemas) {
      if (schema.source === "auto-discovered") {
        autoDiscoveredSchemas++;
      }
      
      totalTables += schema.tables.size;
      for (const [, table] of schema.tables) {
        if (table.columns.length > 0) {
          tablesWithColumns++;
        }
        if (table.source === "auto-discovered") {
          autoDiscoveredTables++;
        }
      }
    }
    
    return {
      totalSchemas: this.schemas.size,
      totalTables,
      tablesWithColumns,
      schemasToScan: this.schemasToScan.size,
      configuredTables: this.configuredTables.size,
      autoDiscoveredSchemas,
      autoDiscoveredTables,
    };
  }

  /**
   * Get config folder path
   */
  getConfigFolderPath(): string {
    return this.configFolderPath;
  }

  dispose(): void {
    // Force save before disposing
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    if (this.isDirty) {
      this.doSave();
    }
    
    // Dispose file watchers
    for (const watcher of this.fileWatchers) {
      watcher.dispose();
    }
    
    this._onMetadataChanged.dispose();
    this._onSchemaAdded.dispose();
    this._onTableAdded.dispose();
    this._onConfigChanged.dispose();
  }
}
