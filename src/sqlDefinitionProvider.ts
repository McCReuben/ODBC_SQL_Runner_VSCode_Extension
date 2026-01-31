/**
 * SQL Table Name Detection - Helpers for extracting table names from SQL files
 *
 * Used by the "Describe Table at Cursor" command to identify table names
 * at the current cursor position.
 */

import * as vscode from "vscode";

/**
 * Check if a word looks like a valid SQL table identifier
 * Supports schema.table format (e.g., ACCESS_VIEWS.users)
 */
function isValidTableIdentifier(word: string): boolean {
  // SQL identifiers: start with letter or underscore, followed by letters, numbers, underscores
  // Also supports schema.table format
  const identifierPattern =
    /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/;
  return identifierPattern.test(word);
}

/**
 * Get the word at position, including dots for schema.table format
 */
function getTableNameAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
): string | null {
  // Get the word range at position
  const wordRange = document.getWordRangeAtPosition(
    position,
    /[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*/,
  );

  if (!wordRange) {
    return null;
  }

  const word = document.getText(wordRange);

  // Validate it looks like a table identifier
  if (!isValidTableIdentifier(word)) {
    return null;
  }

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

  if (sqlKeywords.includes(word.toUpperCase())) {
    return null;
  }

  return word;
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
