/**
 * SQL CodeLens Provider - Shows actionable buttons above SQL queries in the editor
 * Similar to the "Database Client" VSCode extension's above-query interface
 */

import * as vscode from "vscode";

/**
 * Represents a parsed SQL statement with its position in the document
 */
interface ParsedStatement {
  statement: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

/**
 * Split SQL text into individual statements with line information
 * Properly tracks where actual SQL content begins (skipping leading whitespace/comments)
 * Handles both single-line (--) and multi-line block comments
 */
function splitStatementsWithLines(
  document: vscode.TextDocument,
): ParsedStatement[] {
  const text = document.getText();
  const statements: ParsedStatement[] = [];
  let current = "";
  let contentStartOffset = -1; // Where actual SQL content begins (first non-whitespace, non-comment)
  let inString = false;
  let stringChar = "";
  let inLineComment = false; // Inside -- comment
  let inBlockComment = false; // Inside /* */ comment
  let inLeadingArea = true; // Are we still in the leading whitespace/comments area?

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = i < text.length - 1 ? text[i + 1] : "";
    const prevChar = i > 0 ? text[i - 1] : "";

    // Handle end of block comment
    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        i++; // Skip the '/'
      }
      // Don't add block comment content to current
      continue;
    }

    // Handle start of block comment (only when not in string or line comment)
    if (!inString && !inLineComment && char === "/" && nextChar === "*") {
      inBlockComment = true;
      i++; // Skip the '*'
      continue;
    }

    // Handle line comments
    if (!inString && !inBlockComment && char === "-" && nextChar === "-") {
      inLineComment = true;
      // Don't add line comment to current if we're in leading area
      if (!inLeadingArea) {
        current += char;
      }
      continue;
    }

    if (inLineComment) {
      if (!inLeadingArea) {
        current += char;
      }
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    // Handle strings
    if ((char === '"' || char === "'") && !inString) {
      inString = true;
      stringChar = char;
      // This is actual content
      if (inLeadingArea) {
        contentStartOffset = i;
        inLeadingArea = false;
      }
      current += char;
      continue;
    }

    if (inString && char === stringChar) {
      // Check if escaped
      if (prevChar !== "\\") {
        inString = false;
      }
      current += char;
      continue;
    }

    // Handle semicolons
    if (char === ";" && !inString && !inLineComment && !inBlockComment) {
      current += char;
      const trimmed = current.trim();
      if (trimmed.length > 0 && contentStartOffset !== -1) {
        // Remove any comment-only content
        const sqlContent = removeComments(trimmed);
        if (sqlContent.trim().length > 0) {
          const startPos = document.positionAt(contentStartOffset);
          const endPos = document.positionAt(i + 1);
          statements.push({
            statement: trimmed,
            startLine: startPos.line,
            endLine: endPos.line,
            startOffset: contentStartOffset,
            endOffset: i + 1,
          });
        }
      }
      current = "";
      contentStartOffset = -1;
      inLeadingArea = true;
      continue;
    }

    // Track when we hit actual SQL content (non-whitespace, not in any comment)
    if (
      inLeadingArea &&
      !inLineComment &&
      !inBlockComment &&
      !/\s/.test(char)
    ) {
      contentStartOffset = i;
      inLeadingArea = false;
    }

    current += char;
  }

  // Add the last statement if there's any content
  const trimmed = current.trim();
  if (trimmed.length > 0 && contentStartOffset !== -1) {
    const sqlContent = removeComments(trimmed);
    if (sqlContent.trim().length > 0) {
      const startPos = document.positionAt(contentStartOffset);
      const endPos = document.positionAt(text.length);
      statements.push({
        statement: trimmed,
        startLine: startPos.line,
        endLine: endPos.line,
        startOffset: contentStartOffset,
        endOffset: text.length,
      });
    }
  }

  return statements;
}

/**
 * Remove comments from SQL text to check if there's actual SQL content
 */
function removeComments(sql: string): string {
  let result = "";
  let inString = false;
  let stringChar = "";
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = i < sql.length - 1 ? sql[i + 1] : "";
    const prevChar = i > 0 ? sql[i - 1] : "";

    // Handle end of block comment
    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        i++; // Skip the '/'
      }
      continue;
    }

    // Handle start of block comment
    if (!inString && !inLineComment && char === "/" && nextChar === "*") {
      inBlockComment = true;
      i++; // Skip the '*'
      continue;
    }

    // Handle line comments
    if (!inString && !inBlockComment && char === "-" && nextChar === "-") {
      inLineComment = true;
      continue;
    }

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        result += char;
      }
      continue;
    }

    // Handle strings
    if ((char === '"' || char === "'") && !inString) {
      inString = true;
      stringChar = char;
      result += char;
      continue;
    }

    if (inString && char === stringChar && prevChar !== "\\") {
      inString = false;
      result += char;
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Extract table name from a SQL statement
 * Handles SELECT (FROM clause), CREATE TABLE, DROP TABLE, INSERT INTO, UPDATE, DELETE FROM
 */
function extractTableName(sql: string): string | null {
  const normalizedSql = sql.replace(/\s+/g, " ").trim().toUpperCase();
  const originalSql = sql.replace(/\s+/g, " ").trim();

  // CREATE TABLE pattern
  const createMatch = normalizedSql.match(
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMPORARY\s+)?(?:EXTERNAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i,
  );
  if (createMatch) {
    // Get the actual case from original SQL
    const originalMatch = originalSql.match(
      /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMPORARY\s+)?(?:EXTERNAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i,
    );
    return originalMatch ? originalMatch[1] : null;
  }

  // DROP TABLE pattern
  const dropMatch = normalizedSql.match(
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)/i,
  );
  if (dropMatch) {
    const originalMatch = originalSql.match(
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)/i,
    );
    return originalMatch ? originalMatch[1] : null;
  }

  // INSERT INTO pattern
  const insertMatch = normalizedSql.match(/INSERT\s+(?:INTO\s+)?([^\s(]+)/i);
  if (insertMatch) {
    const originalMatch = originalSql.match(/INSERT\s+(?:INTO\s+)?([^\s(]+)/i);
    return originalMatch ? originalMatch[1] : null;
  }

  // UPDATE pattern
  const updateMatch = normalizedSql.match(/UPDATE\s+([^\s]+)/i);
  if (updateMatch) {
    const originalMatch = originalSql.match(/UPDATE\s+([^\s]+)/i);
    return originalMatch ? originalMatch[1] : null;
  }

  // DELETE FROM pattern
  const deleteMatch = normalizedSql.match(/DELETE\s+FROM\s+([^\s]+)/i);
  if (deleteMatch) {
    const originalMatch = originalSql.match(/DELETE\s+FROM\s+([^\s]+)/i);
    return originalMatch ? originalMatch[1] : null;
  }

  // SELECT ... FROM pattern (handles subqueries by finding the first FROM)
  // This regex matches FROM followed by a table name, but not FROM within a subquery
  const fromMatch = originalSql.match(
    /\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/i,
  );
  if (fromMatch) {
    return fromMatch[1];
  }

  return null;
}

/**
 * CodeLens provider for SQL files
 * Shows "Run SQL" and "Table Description" buttons above each SQL statement
 */
export class SqlCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> =
    this._onDidChangeCodeLenses.event;

  constructor() {
    // Refresh CodeLenses when document changes
    vscode.workspace.onDidChangeTextDocument(() => {
      this._onDidChangeCodeLenses.fire();
    });
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    if (document.languageId !== "sql") {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];
    const statements = splitStatementsWithLines(document);

    for (const stmt of statements) {
      // startLine now correctly points to where actual SQL content begins
      const range = new vscode.Range(stmt.startLine, 0, stmt.startLine, 0);

      // "Run SQL" button
      const runCodeLens = new vscode.CodeLens(range, {
        title: "▶ Run SQL",
        tooltip: "Execute this SQL statement (Cmd+Enter)",
        command: "sqlRunner.executeStatementAtLine",
        arguments: [document.uri, stmt.startOffset, stmt.endOffset],
      });
      codeLenses.push(runCodeLens);

      // "Table Description" button - only if we can extract a table name
      const tableName = extractTableName(stmt.statement);
      if (tableName) {
        const describeCodeLens = new vscode.CodeLens(range, {
          title: "📋 Describe Table",
          tooltip: `Show schema for ${tableName}`,
          command: "sqlRunner.describeTable",
          arguments: [document.uri, tableName],
        });
        codeLenses.push(describeCodeLens);
      }

      // "Export Result" button - for queries that return results (SELECT, etc.)
      const normalizedSql = stmt.statement.trim().toUpperCase();
      const isSelectQuery =
        normalizedSql.startsWith("SELECT") ||
        normalizedSql.startsWith("SHOW") ||
        normalizedSql.startsWith("DESCRIBE") ||
        normalizedSql.startsWith("WITH") ||
        normalizedSql.startsWith("EXPLAIN");
      if (isSelectQuery) {
        const exportCodeLens = new vscode.CodeLens(range, {
          title: "📁 Export CSV",
          tooltip: "Execute and export results to CSV",
          command: "sqlRunner.exportResult",
          arguments: [document.uri, stmt.startOffset, stmt.endOffset],
        });
        codeLenses.push(exportCodeLens);
      }

      // "Select" button - highlights the SQL statement in the editor
      const selectCodeLens = new vscode.CodeLens(range, {
        title: "⬜ Select",
        tooltip: "Select this SQL statement in the editor",
        command: "sqlRunner.selectStatement",
        arguments: [document.uri, stmt.startOffset, stmt.endOffset],
      });
      codeLenses.push(selectCodeLens);

      // "Copy" button - copies the SQL statement to clipboard
      const copyCodeLens = new vscode.CodeLens(range, {
        title: "📋 Copy",
        tooltip: "Copy this SQL statement to clipboard",
        command: "sqlRunner.copyStatement",
        arguments: [document.uri, stmt.startOffset, stmt.endOffset],
      });
      codeLenses.push(copyCodeLens);
    }

    return codeLenses;
  }
}

/**
 * Register the SQL CodeLens provider
 */
export function registerSqlCodeLens(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  const provider = new SqlCodeLensProvider();
  return vscode.languages.registerCodeLensProvider(
    { language: "sql", scheme: "file" },
    provider,
  );
}
