// ============================================================================
// Data Model Types
// ============================================================================

export type Column = {
  name: string;
  type?: string; // e.g., "string", "number", "date", etc.
};

export type ResultSetStatus = 'pending' | 'running' | 'complete' | 'error' | 'cancelled';

export type ResultSet = {
  id: string;
  title: string; // "Result 1", "users table", etc.
  sql?: string; // The specific SQL statement that generated this result set
  columns: Column[];
  rows: Array<Record<string, unknown>>;
  rowCount?: number;
  executionTimeMs?: number;
  statementIndex?: number;
  status: ResultSetStatus;
  errorMessage?: string;
};

export type QueryRunStatus = 'running' | 'complete' | 'error';

export type QueryRun = {
  id: string;
  title: string; // Short label, e.g., "Query 12" or first 30 chars of SQL
  sql: string;
  startedAt: number;
  status: QueryRunStatus;
  results: ResultSet[];
  errorMessage?: string;
};

// ============================================================================
// App State
// ============================================================================

export type Theme = 'light' | 'dark';

export type AppState = {
  runs: QueryRun[];
  activeRunId: string | null;
  activeResultSetId: string | null;
  // Selection aggregation computed from Tabulator
  selectionStats: SelectionStats | null;
  theme: Theme;
};

export type SelectionStats = {
  cellCount: number;
  numericCellCount: number;
  sum: number;
  avg: number;
  max: number;
};

// ============================================================================
// Message Types (Webview <-> Extension Protocol)
// ============================================================================

// Messages FROM extension TO webview
export type ExtensionMessage =
  | { type: 'RUN_STARTED'; payload: { runId: string; sql: string; title: string; startedAt: number } }
  | { type: 'RESULT_SET_PENDING'; payload: { runId: string; resultSetId: string; title: string; statementIndex?: number; sql?: string } }
  | { type: 'RESULT_SET_STARTED'; payload: { runId: string; resultSetId: string; title: string; statementIndex?: number; sql?: string } }
  | { type: 'RESULT_SET_SCHEMA'; payload: { runId: string; resultSetId: string; columns: Column[] } }
  | { type: 'RESULT_SET_ROWS'; payload: { runId: string; resultSetId: string; rows: Array<Record<string, unknown>>; append: boolean } }
  | { type: 'RESULT_SET_COMPLETE'; payload: { runId: string; resultSetId: string; rowCount?: number; executionTimeMs?: number } }
  | { type: 'RESULT_SET_ERROR'; payload: { runId: string; resultSetId: string; message: string } }
  | { type: 'RESULT_SET_CANCELLED'; payload: { runId: string; resultSetId: string } }
  | { type: 'RUN_COMPLETE'; payload: { runId: string } }
  | { type: 'RUN_ERROR'; payload: { runId: string; message: string } }
  | { type: 'RUN_CANCELLED'; payload: { runId: string } };

// Messages FROM webview TO extension
export type WebviewMessage =
  | { type: 'WEBVIEW_READY' }
  | { type: 'USER_SELECTED_RUN'; payload: { runId: string } }
  | { type: 'USER_SELECTED_RESULTSET'; payload: { runId: string; resultSetId: string } }
  | { type: 'USER_CLOSED_RUN'; payload: { runId: string } }
  | { type: 'USER_CANCELLED_RUN'; payload: { runId: string } };
