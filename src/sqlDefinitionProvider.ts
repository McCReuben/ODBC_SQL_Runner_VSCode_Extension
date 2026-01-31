/**
 * SQL Definition Provider - Enables Option+Click (or Cmd+Click) on table names to show table description
 *
 * When a user clicks on a table name in a SQL file, this provider triggers a DESCRIBE query
 * to show the table's schema information in the results panel.
 */

import * as vscode from "vscode";

/**
 * Check if a word looks like a valid SQL table identifier
 * Supports schema.table format (e.g., ACCESS_VIEWS.users)
 */
function isValidTableIdentifier(word: string): boolean {
  // SQL identifiers: start with letter or underscore, followed by letters, numbers, underscores
  // Also supports schema.table format
  const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/;
  return identifierPattern.test(word);
}

/**
 * Get the word at position, including dots for schema.table format
 */
function getTableNameAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): string | null {
  // Get the word range at position
  const wordRange = document.getWordRangeAtPosition(
    position,
    /[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*/
  );

  if (!wordRange) {
    return null;
  }

  const word = document.getText(wordRange);

  // Validate it looks like a table identifier
  if (!isValidTableIdentifier(word)) {
    return null;
  }

  return word;
}

/**
 * Check if position is within a SQL context where table names are expected
 * This helps avoid triggering on keywords, string literals, etc.
 */
function isInTableContext(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  const line = document.lineAt(position.line).text;
  const textBefore = line.substring(0, position.character).toUpperCase();

  // Check if we're after common table-reference keywords
  const tableContextPatterns = [
    /\bFROM\s+$/i,
    /\bFROM\s+\w*$/i,
    /\bJOIN\s+$/i,
    /\bJOIN\s+\w*$/i,
    /\bINTO\s+$/i,
    /\bINTO\s+\w*$/i,
    /\bUPDATE\s+$/i,
    /\bUPDATE\s+\w*$/i,
    /\bTABLE\s+$/i,
    /\bTABLE\s+\w*$/i,
    /\bDESCRIBE\s+$/i,
    /\bDESCRIBE\s+\w*$/i,
  ];

  for (const pattern of tableContextPatterns) {
    if (pattern.test(textBefore)) {
      return true;
    }
  }

  // Also check if the word appears after FROM/JOIN/etc somewhere on the line
  const fullLine = line.toUpperCase();
  const hasTableKeyword =
    /\b(FROM|JOIN|INTO|UPDATE|TABLE|DESCRIBE)\b/.test(fullLine);

  return hasTableKeyword;
}

/**
 * SQL Definition Provider
 * Intercepts "Go to Definition" actions and triggers DESCRIBE TABLE for table names
 */
export class SqlDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
    // Only handle SQL files
    if (document.languageId !== "sql") {
      return null;
    }

    // Get the table name at the click position
    const tableName = getTableNameAtPosition(document, position);

    if (!tableName) {
      return null;
    }

    // Check if we're in a context where this looks like a table reference
    // This is a soft check - we'll still allow it even if context is unclear
    // since users explicitly clicking on an identifier likely want to describe it
    const inContext = isInTableContext(document, position);

    // Skip SQL keywords
    const sqlKeywords = [
      "SELECT",
      "FROM",
      "WHERE",
      "AND",
      "OR",
      "NOT",
      "IN",
      "IS",
      "NULL",
      "TRUE",
      "FALSE",
      "AS",
      "ON",
      "JOIN",
      "LEFT",
      "RIGHT",
      "INNER",
      "OUTER",
      "FULL",
      "CROSS",
      "ORDER",
      "BY",
      "GROUP",
      "HAVING",
      "LIMIT",
      "OFFSET",
      "UNION",
      "ALL",
      "DISTINCT",
      "INSERT",
      "INTO",
      "VALUES",
      "UPDATE",
      "SET",
      "DELETE",
      "CREATE",
      "DROP",
      "ALTER",
      "TABLE",
      "INDEX",
      "VIEW",
      "IF",
      "EXISTS",
      "CASE",
      "WHEN",
      "THEN",
      "ELSE",
      "END",
      "CAST",
      "BETWEEN",
      "LIKE",
      "DESCRIBE",
      "SHOW",
      "USE",
      "WITH",
      "RECURSIVE",
      "TEMPORARY",
      "TEMP",
      "EXTERNAL",
      "STORED",
      "PARTITIONED",
      "CLUSTERED",
      "SORTED",
      "COMMENT",
      "TBLPROPERTIES",
      "LOCATION",
      "FORMAT",
      "SERDE",
      "ROW",
      "FIELDS",
      "TERMINATED",
      "COLLECTION",
      "ITEMS",
      "KEYS",
      "LINES",
      "MAP",
      "STRUCT",
      "ARRAY",
      "BIGINT",
      "INT",
      "INTEGER",
      "SMALLINT",
      "TINYINT",
      "FLOAT",
      "DOUBLE",
      "DECIMAL",
      "STRING",
      "VARCHAR",
      "CHAR",
      "BOOLEAN",
      "DATE",
      "TIMESTAMP",
      "BINARY",
      "ASC",
      "DESC",
      "NULLS",
      "FIRST",
      "LAST",
      "OVER",
      "PARTITION",
      "ROWS",
      "RANGE",
      "UNBOUNDED",
      "PRECEDING",
      "FOLLOWING",
      "CURRENT",
    ];

    if (sqlKeywords.includes(tableName.toUpperCase())) {
      return null;
    }

    // Trigger the describe table command asynchronously
    // We return null because we're not providing a "definition" location,
    // but rather executing a side effect (showing table schema)
    vscode.commands.executeCommand(
      "sqlRunner.describeTable",
      document.uri,
      tableName
    );

    // Return null - we don't have an actual definition location to navigate to
    // The describe command will show results in the webview panel
    return null;
  }
}

/**
 * Register the SQL Definition Provider
 */
export function registerSqlDefinitionProvider(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const provider = new SqlDefinitionProvider();
  return vscode.languages.registerDefinitionProvider(
    { language: "sql", scheme: "file" },
    provider
  );
}

/**
 * Get the table name at the current cursor position in the active editor
 * Used by the "Describe Table at Cursor" command
 */
export function getTableNameAtCursor(): string | null {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    return null;
  }

  if (editor.document.languageId !== "sql") {
    return null;
  }

  return getTableNameAtPosition(editor.document, editor.selection.active);
}
