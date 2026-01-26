/**
 * Parses SQL statements and extracts the relevant statement(s) to execute
 */

export interface StatementInfo {
  sql: string;
  statementIndex: number;
}

/**
 * Split SQL text into individual statements separated by semicolons
 * This is a simple parser that handles basic SQL statement separation
 */
function splitStatements(
  text: string,
): Array<{ statement: string; start: number; end: number }> {
  const statements: Array<{ statement: string; start: number; end: number }> =
    [];
  let current = "";
  let start = 0;
  let inString = false;
  let stringChar = "";
  let inComment = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = i < text.length - 1 ? text[i + 1] : "";

    // Handle comments
    if (!inString && char === "-" && nextChar === "-") {
      inComment = true;
      current += char;
      continue;
    }

    if (inComment) {
      current += char;
      if (char === "\n") {
        inComment = false;
      }
      continue;
    }

    // Handle strings
    if ((char === '"' || char === "'") && !inString) {
      inString = true;
      stringChar = char;
      current += char;
      continue;
    }

    if (inString && char === stringChar) {
      // Check if escaped
      if (i > 0 && text[i - 1] !== "\\") {
        inString = false;
      }
      current += char;
      continue;
    }

    // Handle semicolons
    if (char === ";" && !inString && !inComment) {
      current += char;
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push({
          statement: trimmed,
          start,
          end: i + 1,
        });
      }
      current = "";
      start = i + 1;
      continue;
    }

    current += char;
  }

  // Add the last statement if there's any content
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push({
      statement: trimmed,
      start,
      end: text.length,
    });
  }

  return statements;
}

/**
 * Get the SQL statement(s) to execute based on selection or cursor position
 */
export function getSqlToExecute(
  text: string,
  selection: { start: number; end: number } | null,
): StatementInfo[] {
  // If there's a selection, use it
  if (selection && selection.start !== selection.end) {
    const selectedText = text.substring(selection.start, selection.end).trim();
    if (selectedText.length === 0) {
      throw new Error("Selected text is empty");
    }

    // If selection contains multiple statements, split them
    const statements = splitStatements(selectedText);
    return statements.map((stmt, index) => ({
      sql: stmt.statement,
      statementIndex: index,
    }));
  }

  // No selection - find the statement containing the cursor
  const cursorPos = selection ? selection.start : 0;
  const statements = splitStatements(text);

  if (statements.length === 0) {
    throw new Error("No SQL statements found");
  }

  // Find which statement contains the cursor
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (cursorPos >= stmt.start && cursorPos <= stmt.end) {
      return [
        {
          sql: stmt.statement,
          statementIndex: i,
        },
      ];
    }
  }

  // If cursor is past all statements, execute the last one
  const lastStmt = statements[statements.length - 1];
  return [
    {
      sql: lastStmt.statement,
      statementIndex: statements.length - 1,
    },
  ];
}
