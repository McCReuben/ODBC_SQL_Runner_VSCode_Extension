/**
 * Schema Metadata Storage and Management
 * 
 * Stores and manages database schema metadata for Intellisense:
 * - Schemas (databases)
 * - Tables within schemas
 * - Columns within tables
 * 
 * Supports:
 * - User-configurable allow-list of schemas/tables
 * - Automatic expansion based on query usage
 * - Persistence to workspace storage
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
  isFromAllowList: boolean; // true if from config, false if auto-discovered
}

/**
 * Schema metadata
 */
export interface SchemaInfo {
  name: string;
  tables: Map<string, TableInfo>; // tableName -> TableInfo
  lastRefreshed?: number;
  isFromAllowList: boolean;
}

/**
 * Serializable format for persistence
 */
interface SerializedMetadata {
  version: number;
  schemas: {
    name: string;
    lastRefreshed?: number;
    isFromAllowList: boolean;
    tables: {
      name: string;
      schema: string;
      columns: ColumnInfo[];
      lastRefreshed?: number;
      isFromAllowList: boolean;
    }[];
  }[];
  autoDiscoveredSchemas: string[];
  autoDiscoveredTables: { schema: string; table: string }[];
}

/**
 * Events emitted by SchemaMetadataStore
 */
export interface MetadataEvents {
  onMetadataChanged: vscode.Event<void>;
  onSchemaAdded: vscode.Event<string>;
  onTableAdded: vscode.Event<{ schema: string; table: string }>;
}

/**
 * SchemaMetadataStore - Central storage for database metadata
 */
export class SchemaMetadataStore implements vscode.Disposable {
  private schemas: Map<string, SchemaInfo> = new Map();
  private autoDiscoveredSchemas: Set<string> = new Set();
  private autoDiscoveredTables: Set<string> = new Set(); // "schema.table" format
  private storagePath: string;
  private isDirty: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;
  
  // Event emitters
  private _onMetadataChanged = new vscode.EventEmitter<void>();
  private _onSchemaAdded = new vscode.EventEmitter<string>();
  private _onTableAdded = new vscode.EventEmitter<{ schema: string; table: string }>();
  
  public readonly onMetadataChanged = this._onMetadataChanged.event;
  public readonly onSchemaAdded = this._onSchemaAdded.event;
  public readonly onTableAdded = this._onTableAdded.event;

  constructor(private context: vscode.ExtensionContext) {
    // Store metadata in workspace storage
    this.storagePath = path.join(
      context.globalStorageUri.fsPath,
      "schema-metadata.json"
    );
    
    // Ensure storage directory exists
    const storageDir = path.dirname(this.storagePath);
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    
    // Load existing metadata
    this.loadFromDisk();
    
    // Load from config
    this.loadFromConfig();
    
    // Watch for config changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("sqlRunner.intellisense")) {
        this.loadFromConfig();
      }
    });
  }

  /**
   * Load metadata from disk
   */
  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, "utf-8");
        const serialized: SerializedMetadata = JSON.parse(data);
        
        // Restore auto-discovered sets
        this.autoDiscoveredSchemas = new Set(serialized.autoDiscoveredSchemas || []);
        this.autoDiscoveredTables = new Set(
          (serialized.autoDiscoveredTables || []).map(t => `${t.schema}.${t.table}`)
        );
        
        // Restore schemas
        for (const schemaData of serialized.schemas) {
          const schemaInfo: SchemaInfo = {
            name: schemaData.name,
            tables: new Map(),
            lastRefreshed: schemaData.lastRefreshed,
            isFromAllowList: schemaData.isFromAllowList,
          };
          
          for (const tableData of schemaData.tables) {
            schemaInfo.tables.set(tableData.name.toUpperCase(), tableData);
          }
          
          this.schemas.set(schemaData.name.toUpperCase(), schemaInfo);
        }
        
        console.log(`[SchemaMetadata] Loaded ${this.schemas.size} schemas from disk`);
      }
    } catch (error) {
      console.error("[SchemaMetadata] Failed to load from disk:", error);
    }
  }

  /**
   * Save metadata to disk (debounced)
   */
  private saveToDisk(): void {
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
        autoDiscoveredSchemas: Array.from(this.autoDiscoveredSchemas),
        autoDiscoveredTables: Array.from(this.autoDiscoveredTables).map(key => {
          const [schema, table] = key.split(".");
          return { schema, table };
        }),
      };
      
      for (const [, schemaInfo] of this.schemas) {
        serialized.schemas.push({
          name: schemaInfo.name,
          lastRefreshed: schemaInfo.lastRefreshed,
          isFromAllowList: schemaInfo.isFromAllowList,
          tables: Array.from(schemaInfo.tables.values()),
        });
      }
      
      fs.writeFileSync(this.storagePath, JSON.stringify(serialized, null, 2));
      this.isDirty = false;
      console.log(`[SchemaMetadata] Saved ${this.schemas.size} schemas to disk`);
    } catch (error) {
      console.error("[SchemaMetadata] Failed to save to disk:", error);
    }
  }

  /**
   * Load schemas from configuration
   */
  private loadFromConfig(): void {
    const config = vscode.workspace.getConfiguration("sqlRunner.intellisense");
    
    // Get allowed schemas from config
    const allowedSchemas = config.get<string[]>("allowedSchemas", []);
    
    // Get allowed tables from config (format: "schema.table")
    const allowedTables = config.get<string[]>("allowedTables", []);
    
    // Add configured schemas
    for (const schemaName of allowedSchemas) {
      const upperName = schemaName.toUpperCase();
      if (!this.schemas.has(upperName)) {
        this.schemas.set(upperName, {
          name: schemaName,
          tables: new Map(),
          isFromAllowList: true,
        });
        this._onSchemaAdded.fire(schemaName);
      } else {
        // Mark existing schema as from allow-list
        const schema = this.schemas.get(upperName)!;
        schema.isFromAllowList = true;
      }
    }
    
    // Add configured tables
    for (const fullTableName of allowedTables) {
      const parts = fullTableName.split(".");
      if (parts.length === 2) {
        const [schemaName, tableName] = parts;
        this.ensureSchema(schemaName, true);
        
        const schema = this.schemas.get(schemaName.toUpperCase());
        if (schema && !schema.tables.has(tableName.toUpperCase())) {
          schema.tables.set(tableName.toUpperCase(), {
            name: tableName,
            schema: schemaName,
            columns: [],
            isFromAllowList: true,
          });
          this._onTableAdded.fire({ schema: schemaName, table: tableName });
        }
      }
    }
    
    this.isDirty = true;
    this.saveToDisk();
    this._onMetadataChanged.fire();
  }

  /**
   * Ensure a schema exists in the store
   */
  private ensureSchema(schemaName: string, isFromAllowList: boolean): SchemaInfo {
    const upperName = schemaName.toUpperCase();
    
    if (!this.schemas.has(upperName)) {
      const schemaInfo: SchemaInfo = {
        name: schemaName,
        tables: new Map(),
        isFromAllowList,
      };
      this.schemas.set(upperName, schemaInfo);
      this._onSchemaAdded.fire(schemaName);
    }
    
    return this.schemas.get(upperName)!;
  }

  /**
   * Add or update a schema (from metadata refresh)
   */
  addSchema(schemaName: string, isFromAllowList: boolean = false): void {
    const schema = this.ensureSchema(schemaName, isFromAllowList);
    schema.lastRefreshed = Date.now();
    
    if (!isFromAllowList) {
      this.autoDiscoveredSchemas.add(schemaName.toUpperCase());
    }
    
    this.isDirty = true;
    this.saveToDisk();
    this._onMetadataChanged.fire();
  }

  /**
   * Add or update a table (from metadata refresh)
   */
  addTable(
    schemaName: string,
    tableName: string,
    columns: ColumnInfo[] = [],
    isFromAllowList: boolean = false
  ): void {
    const schema = this.ensureSchema(schemaName, false);
    const upperTableName = tableName.toUpperCase();
    
    const tableInfo: TableInfo = {
      name: tableName,
      schema: schemaName,
      columns,
      lastRefreshed: Date.now(),
      isFromAllowList,
    };
    
    schema.tables.set(upperTableName, tableInfo);
    
    if (!isFromAllowList) {
      this.autoDiscoveredTables.add(`${schemaName.toUpperCase()}.${upperTableName}`);
    }
    
    this.isDirty = true;
    this.saveToDisk();
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
    this.saveToDisk();
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
  schemaNeeedsRefresh(schemaName: string, maxAgeMs: number = 3600000): boolean {
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
   * Get schemas that need refresh
   */
  getSchemasNeedingRefresh(maxAgeMs: number = 3600000): string[] {
    const result: string[] = [];
    for (const [, schema] of this.schemas) {
      if (!schema.lastRefreshed || Date.now() - schema.lastRefreshed > maxAgeMs) {
        result.push(schema.name);
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
   * Called when a query is executed to expand the allow-list
   */
  addFromQuery(schemas: string[], tables: { schema: string; table: string }[]): void {
    let changed = false;
    
    for (const schemaName of schemas) {
      const upperName = schemaName.toUpperCase();
      if (!this.schemas.has(upperName)) {
        this.schemas.set(upperName, {
          name: schemaName,
          tables: new Map(),
          isFromAllowList: false,
        });
        this.autoDiscoveredSchemas.add(upperName);
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
          isFromAllowList: false,
        });
        this.autoDiscoveredTables.add(`${schema.toUpperCase()}.${upperTableName}`);
        this._onTableAdded.fire({ schema, table });
        changed = true;
      }
    }
    
    if (changed) {
      this.isDirty = true;
      this.saveToDisk();
      this._onMetadataChanged.fire();
    }
  }

  /**
   * Clear all auto-discovered schemas/tables (keep allow-list items)
   */
  clearAutoDiscovered(): void {
    // Remove auto-discovered schemas that aren't in allow-list
    for (const schemaName of this.autoDiscoveredSchemas) {
      const schema = this.schemas.get(schemaName);
      if (schema && !schema.isFromAllowList) {
        this.schemas.delete(schemaName);
      }
    }
    
    // Remove auto-discovered tables from allow-list schemas
    for (const tableKey of this.autoDiscoveredTables) {
      const [schemaName, tableName] = tableKey.split(".");
      const schema = this.schemas.get(schemaName);
      if (schema) {
        const table = schema.tables.get(tableName);
        if (table && !table.isFromAllowList) {
          schema.tables.delete(tableName);
        }
      }
    }
    
    this.autoDiscoveredSchemas.clear();
    this.autoDiscoveredTables.clear();
    
    this.isDirty = true;
    this.saveToDisk();
    this._onMetadataChanged.fire();
  }

  /**
   * Get statistics about the metadata store
   */
  getStats(): {
    totalSchemas: number;
    totalTables: number;
    tablesWithColumns: number;
    autoDiscoveredSchemas: number;
    autoDiscoveredTables: number;
  } {
    let totalTables = 0;
    let tablesWithColumns = 0;
    
    for (const [, schema] of this.schemas) {
      totalTables += schema.tables.size;
      for (const [, table] of schema.tables) {
        if (table.columns.length > 0) {
          tablesWithColumns++;
        }
      }
    }
    
    return {
      totalSchemas: this.schemas.size,
      totalTables,
      tablesWithColumns,
      autoDiscoveredSchemas: this.autoDiscoveredSchemas.size,
      autoDiscoveredTables: this.autoDiscoveredTables.size,
    };
  }

  dispose(): void {
    // Force save before disposing
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    if (this.isDirty) {
      this.doSave();
    }
    
    this._onMetadataChanged.dispose();
    this._onSchemaAdded.dispose();
    this._onTableAdded.dispose();
  }
}
