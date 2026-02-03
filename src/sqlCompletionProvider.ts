/**
 * SQL Completion Provider - Intellisense for SQL files
 * 
 * Provides autocomplete suggestions for:
 * - Schema names (after FROM, JOIN, INTO, UPDATE, etc.)
 * - Table names (after schema. or in appropriate contexts)
 * - Column names (when a table is referenced in the query)
 * - SQL keywords
 */

import * as vscode from "vscode";
import { SchemaMetadataStore, TableInfo, ColumnInfo } from "./schemaMetadata";

/**
 * SQL keywords for basic completion
 */
const SQL_KEYWORDS = [
  // DML
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE", "BETWEEN",
  "IS", "NULL", "AS", "DISTINCT", "ALL", "ORDER", "BY", "ASC", "DESC",
  "LIMIT", "OFFSET", "GROUP", "HAVING", "UNION", "INTERSECT", "EXCEPT",
  "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
  // Joins
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS", "ON", "USING",
  // DDL
  "CREATE", "ALTER", "DROP", "TABLE", "VIEW", "INDEX", "DATABASE", "SCHEMA",
  "IF", "EXISTS", "CASCADE", "RESTRICT",
  // Functions
  "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF", "CASE", "WHEN",
  "THEN", "ELSE", "END", "CAST", "CONVERT", "SUBSTRING", "TRIM", "UPPER", "LOWER",
  // Spark/Hive specific
  "SHOW", "DESCRIBE", "EXPLAIN", "USE", "WITH", "PARTITIONED", "CLUSTERED",
  "STORED", "LOCATION", "TBLPROPERTIES", "LATERAL", "EXPLODE", "COLLECT_LIST",
  "COLLECT_SET", "OVER", "PARTITION", "ROWS", "RANGE", "UNBOUNDED", "PRECEDING",
  "FOLLOWING", "CURRENT", "ROW",
];

/**
 * Context types for SQL completion
 */
type CompletionContext =
  | "schema"       // Suggest schemas
  | "table"        // Suggest tables (possibly schema-qualified)
  | "column"       // Suggest columns from referenced tables
  | "keyword"      // Suggest SQL keywords
  | "alias"        // Suggest table aliases
  | "unknown";

/**
 * Table reference found in the query
 */
interface TableReference {
  schema?: string;
  table: string;
  alias?: string;
}

/**
 * SQL Completion Provider
 */
export class SqlCompletionProvider implements vscode.CompletionItemProvider {
  private metadataStore: SchemaMetadataStore;
  private defaultSchema: string = "ACCESS_VIEWS";

  constructor(metadataStore: SchemaMetadataStore) {
    this.metadataStore = metadataStore;
    
    // Load default schema from config
    const config = vscode.workspace.getConfiguration("sqlRunner.intellisense");
    this.defaultSchema = config.get<string>("defaultSchema", "ACCESS_VIEWS");
    
    // Watch for config changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("sqlRunner.intellisense.defaultSchema")) {
        const newConfig = vscode.workspace.getConfiguration("sqlRunner.intellisense");
        this.defaultSchema = newConfig.get<string>("defaultSchema", "ACCESS_VIEWS");
      }
    });
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | vscode.CompletionList | null> {
    if (token.isCancellationRequested) {
      return null;
    }

    // Check if IntelliSense is enabled (allows runtime toggling via settings)
    const config = vscode.workspace.getConfiguration("sqlRunner.intellisense");
    if (!config.get<boolean>("enabled", true)) {
      return null;
    }

    const items: vscode.CompletionItem[] = [];
    
    // Get text up to cursor
    const textBefore = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const currentLine = document.lineAt(position.line).text;
    const charBefore = position.character > 0 ? currentLine[position.character - 1] : "";
    
    // Get the word being typed
    const wordRange = document.getWordRangeAtPosition(position, /[\w.]+/);
    const currentWord = wordRange ? document.getText(wordRange) : "";
    
    // Determine completion context
    const completionContext = this.determineContext(textBefore, currentWord, charBefore);
    
    // Parse table references from the query
    const tableRefs = this.parseTableReferences(textBefore);
    
    switch (completionContext) {
      case "schema":
        items.push(...this.getSchemaCompletions());
        break;
        
      case "table":
        // Check if we're after a schema prefix (e.g., "schema.")
        if (currentWord.includes(".")) {
          const [schemaName] = currentWord.split(".");
          items.push(...this.getTableCompletions(schemaName));
        } else {
          // Offer both schemas and tables from default schema
          items.push(...this.getSchemaCompletions());
          items.push(...this.getTableCompletions(this.defaultSchema));
        }
        break;
        
      case "column":
        items.push(...this.getColumnCompletions(tableRefs, currentWord));
        break;
        
      case "alias":
        items.push(...this.getAliasCompletions(tableRefs));
        break;
        
      case "keyword":
        items.push(...this.getKeywordCompletions());
        break;
        
      default:
        // Offer everything
        items.push(...this.getKeywordCompletions());
        items.push(...this.getSchemaCompletions());
        items.push(...this.getTableCompletions(this.defaultSchema));
        if (tableRefs.length > 0) {
          items.push(...this.getColumnCompletions(tableRefs, currentWord));
        }
    }
    
    return items;
  }

  /**
   * Determine the completion context based on text before cursor
   */
  private determineContext(
    textBefore: string,
    currentWord: string,
    charBefore: string
  ): CompletionContext {
    const textLower = textBefore.toLowerCase().trim();
    
    // If we just typed a dot, check what's before it
    if (charBefore === ".") {
      // Check if it's a table alias (e.g., "t.")
      const beforeDot = currentWord.split(".")[0];
      if (beforeDot && beforeDot.length <= 3) {
        // Likely an alias - suggest columns
        return "column";
      }
      // It's a schema prefix - suggest tables
      return "table";
    }
    
    // Check for patterns that indicate we want table/schema names
    const tableContextPatterns = [
      /\bfrom\s+$/i,
      /\bjoin\s+$/i,
      /\binner\s+join\s+$/i,
      /\bleft\s+(?:outer\s+)?join\s+$/i,
      /\bright\s+(?:outer\s+)?join\s+$/i,
      /\bfull\s+(?:outer\s+)?join\s+$/i,
      /\bcross\s+join\s+$/i,
      /\binto\s+$/i,
      /\bupdate\s+$/i,
      /\btable\s+$/i,
      /\bdescribe\s+$/i,
      /\bshow\s+tables\s+in\s+$/i,
    ];
    
    for (const pattern of tableContextPatterns) {
      if (pattern.test(textLower)) {
        return "table";
      }
    }
    
    // Check for schema context
    const schemaContextPatterns = [
      /\buse\s+$/i,
      /\bdatabase\s+$/i,
      /\bschema\s+$/i,
      /\bshow\s+tables\s+in\s+$/i,
    ];
    
    for (const pattern of schemaContextPatterns) {
      if (pattern.test(textLower)) {
        return "schema";
      }
    }
    
    // Check for column context (SELECT, WHERE, ON, etc.)
    const columnContextPatterns = [
      /\bselect\s+(?:[\w\s,.*]+,\s*)?$/i,
      /\bselect\s+$/i,
      /\bwhere\s+$/i,
      /\band\s+$/i,
      /\bor\s+$/i,
      /\bon\s+$/i,
      /\bby\s+$/i,
      /\bhaving\s+$/i,
      /\bset\s+$/i,
      /[=<>!]+\s*$/,
    ];
    
    for (const pattern of columnContextPatterns) {
      if (pattern.test(textLower)) {
        return "column";
      }
    }
    
    // Check if we're typing a partial word that looks like a column reference
    if (currentWord.includes(".") && !currentWord.endsWith(".")) {
      return "column";
    }
    
    return "unknown";
  }

  /**
   * Parse table references from the SQL query
   */
  private parseTableReferences(sql: string): TableReference[] {
    const refs: TableReference[] = [];
    
    // Pattern to match table references:
    // - FROM/JOIN schema.table [AS] alias
    // - FROM/JOIN table [AS] alias
    const tablePattern = /(?:from|join)\s+([\w.]+)(?:\s+(?:as\s+)?(\w+))?/gi;
    
    let match;
    while ((match = tablePattern.exec(sql)) !== null) {
      const fullName = match[1];
      const alias = match[2];
      
      if (fullName.includes(".")) {
        const [schema, table] = fullName.split(".");
        refs.push({ schema, table, alias });
      } else {
        refs.push({ table: fullName, alias });
      }
    }
    
    return refs;
  }

  /**
   * Get schema name completions
   */
  private getSchemaCompletions(): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    const schemas = this.metadataStore.getSchemaNames();
    
    for (const schemaName of schemas) {
      const item = new vscode.CompletionItem(
        schemaName,
        vscode.CompletionItemKind.Module
      );
      item.detail = "Schema";
      item.insertText = schemaName;
      item.sortText = `0-${schemaName}`; // Sort schemas first
      items.push(item);
    }
    
    return items;
  }

  /**
   * Get table name completions for a schema
   */
  private getTableCompletions(schemaName?: string): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    
    if (schemaName) {
      // Get tables from specific schema
      const tables = this.metadataStore.getTables(schemaName);
      
      for (const table of tables) {
        const item = new vscode.CompletionItem(
          table.name,
          vscode.CompletionItemKind.Class
        );
        item.detail = `Table in ${schemaName}`;
        item.documentation = this.formatTableDocumentation(table);
        item.insertText = table.name;
        item.sortText = `1-${table.name}`; // Sort tables after schemas
        items.push(item);
        
        // Also add fully qualified name
        const fqItem = new vscode.CompletionItem(
          `${schemaName}.${table.name}`,
          vscode.CompletionItemKind.Class
        );
        fqItem.detail = `Table (fully qualified)`;
        fqItem.documentation = this.formatTableDocumentation(table);
        fqItem.insertText = `${schemaName}.${table.name}`;
        fqItem.sortText = `2-${schemaName}.${table.name}`;
        items.push(fqItem);
      }
    } else {
      // Get tables from all known schemas
      const schemas = this.metadataStore.getSchemas();
      
      for (const schema of schemas) {
        for (const [, table] of schema.tables) {
          const fqName = `${schema.name}.${table.name}`;
          const item = new vscode.CompletionItem(
            fqName,
            vscode.CompletionItemKind.Class
          );
          item.detail = `Table in ${schema.name}`;
          item.documentation = this.formatTableDocumentation(table);
          item.insertText = fqName;
          item.sortText = `1-${fqName}`;
          items.push(item);
        }
      }
    }
    
    return items;
  }

  /**
   * Get column completions for referenced tables
   */
  private getColumnCompletions(
    tableRefs: TableReference[],
    currentWord: string
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    const seenColumns = new Set<string>();
    
    // Check if we're typing a table alias prefix
    const aliasPrefix = currentWord.includes(".") ? currentWord.split(".")[0] : null;
    
    for (const ref of tableRefs) {
      // If alias prefix is specified, only include columns from matching table
      if (aliasPrefix && ref.alias !== aliasPrefix && ref.table.toLowerCase() !== aliasPrefix.toLowerCase()) {
        continue;
      }
      
      // Get columns for this table
      const schemaName = ref.schema || this.defaultSchema;
      const columns = this.metadataStore.getColumns(schemaName, ref.table);
      
      for (const col of columns) {
        // Create completion with alias/table prefix
        const prefix = ref.alias || ref.table;
        const qualifiedName = `${prefix}.${col.name}`;
        
        if (!seenColumns.has(qualifiedName.toLowerCase())) {
          seenColumns.add(qualifiedName.toLowerCase());
          
          // Add qualified column name
          const qualifiedItem = new vscode.CompletionItem(
            qualifiedName,
            vscode.CompletionItemKind.Field
          );
          qualifiedItem.detail = `${col.type} - ${ref.table}`;
          qualifiedItem.documentation = col.comment || `Column from ${schemaName}.${ref.table}`;
          qualifiedItem.insertText = aliasPrefix ? col.name : qualifiedName;
          qualifiedItem.sortText = `0-${col.name}`;
          items.push(qualifiedItem);
          
          // Also add unqualified column name
          if (!seenColumns.has(col.name.toLowerCase())) {
            seenColumns.add(col.name.toLowerCase());
            
            const item = new vscode.CompletionItem(
              col.name,
              vscode.CompletionItemKind.Field
            );
            item.detail = `${col.type}`;
            item.documentation = col.comment || `Column from ${schemaName}.${ref.table}`;
            item.insertText = col.name;
            item.sortText = `1-${col.name}`;
            items.push(item);
          }
        }
      }
    }
    
    return items;
  }

  /**
   * Get table alias completions
   */
  private getAliasCompletions(tableRefs: TableReference[]): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    
    for (const ref of tableRefs) {
      if (ref.alias) {
        const item = new vscode.CompletionItem(
          ref.alias,
          vscode.CompletionItemKind.Variable
        );
        item.detail = `Alias for ${ref.schema ? ref.schema + "." : ""}${ref.table}`;
        item.insertText = ref.alias;
        items.push(item);
      }
    }
    
    return items;
  }

  /**
   * Get SQL keyword completions
   */
  private getKeywordCompletions(): vscode.CompletionItem[] {
    return SQL_KEYWORDS.map((keyword) => {
      const item = new vscode.CompletionItem(
        keyword,
        vscode.CompletionItemKind.Keyword
      );
      item.detail = "SQL Keyword";
      item.insertText = keyword;
      item.sortText = `9-${keyword}`; // Sort keywords last
      return item;
    });
  }

  /**
   * Format table documentation markdown
   */
  private formatTableDocumentation(table: TableInfo): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${table.schema}.${table.name}**\n\n`);
    
    if (table.columns.length > 0) {
      md.appendMarkdown("**Columns:**\n\n");
      
      // Show first 10 columns
      const columnsToShow = table.columns.slice(0, 10);
      for (const col of columnsToShow) {
        md.appendMarkdown(`- \`${col.name}\` (*${col.type}*)`);
        if (col.comment) {
          md.appendMarkdown(` - ${col.comment}`);
        }
        md.appendMarkdown("\n");
      }
      
      if (table.columns.length > 10) {
        md.appendMarkdown(`\n*...and ${table.columns.length - 10} more columns*\n`);
      }
    } else {
      md.appendMarkdown("*Column information not loaded*\n");
    }
    
    return md;
  }
}

/**
 * Register the SQL completion provider
 */
export function registerSqlCompletionProvider(
  context: vscode.ExtensionContext,
  metadataStore: SchemaMetadataStore
): vscode.Disposable {
  const provider = new SqlCompletionProvider(metadataStore);
  
  return vscode.languages.registerCompletionItemProvider(
    { language: "sql", scheme: "file" },
    provider,
    ".", // Trigger on dot
    " ", // Trigger on space (for keywords)
  );
}
