import type { AppState, ExtensionMessage, QueryRun, ResultSet, SelectionStats, Theme } from './types';

// ============================================================================
// Initial State
// ============================================================================

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem('tableAssetTheme');
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
  } catch (e) {
    // Ignore localStorage errors
  }
  return 'light';
}

export const initialState: AppState = {
  runs: [],
  activeRunId: null,
  activeResultSetId: null,
  selectionStats: null,
  theme: getInitialTheme(),
};

// ============================================================================
// Action Types (internal + from extension messages)
// ============================================================================

export type Action =
  | ExtensionMessage
  | { type: 'SELECT_RUN'; payload: { runId: string } }
  | { type: 'SELECT_RESULT_SET'; payload: { resultSetId: string } }
  | { type: 'CLOSE_RUN'; payload: { runId: string } }
  | { type: 'UPDATE_SELECTION_STATS'; payload: SelectionStats | null }
  | { type: 'TOGGLE_THEME' };

// ============================================================================
// Reducer
// ============================================================================

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    // -------------------------------------------------------------------------
    // Run lifecycle
    // -------------------------------------------------------------------------
    case 'RUN_STARTED': {
      const newRun: QueryRun = {
        id: action.payload.runId,
        title: action.payload.title,
        sql: action.payload.sql,
        startedAt: action.payload.startedAt,
        status: 'running',
        results: [],
      };
      return {
        ...state,
        runs: [...state.runs, newRun],
        activeRunId: newRun.id,
        activeResultSetId: null,
      };
    }

    case 'RUN_COMPLETE': {
      return {
        ...state,
        runs: updateRun(state.runs, action.payload.runId, (run) => ({
          ...run,
          status: 'complete',
        })),
      };
    }

    case 'RUN_ERROR': {
      return {
        ...state,
        runs: updateRun(state.runs, action.payload.runId, (run) => ({
          ...run,
          status: 'error',
          errorMessage: action.payload.message,
        })),
      };
    }

    case 'RUN_CANCELLED': {
      return {
        ...state,
        runs: updateRun(state.runs, action.payload.runId, (run) => ({
          ...run,
          status: 'complete',
          // Mark all running/pending result sets as cancelled
          results: run.results.map((rs) =>
            rs.status === 'running' || rs.status === 'pending'
              ? { ...rs, status: 'cancelled' as const }
              : rs
          ),
        })),
      };
    }

    // -------------------------------------------------------------------------
    // Result set lifecycle
    // -------------------------------------------------------------------------
    case 'RESULT_SET_STARTED': {
      const newResultSet: ResultSet = {
        id: action.payload.resultSetId,
        title: action.payload.title,
        sql: action.payload.sql, // Individual SQL statement for this result set
        columns: [],
        rows: [],
        statementIndex: action.payload.statementIndex,
        status: 'running',
      };
      const updatedRuns = updateRun(state.runs, action.payload.runId, (run) => ({
        ...run,
        results: [...run.results, newResultSet],
      }));
      // Auto-select the new result set if this run is active
      const shouldSelect = state.activeRunId === action.payload.runId;
      return {
        ...state,
        runs: updatedRuns,
        activeResultSetId: shouldSelect ? newResultSet.id : state.activeResultSetId,
      };
    }

    case 'RESULT_SET_SCHEMA': {
      console.log("[DEBUG] Webview reducer: RESULT_SET_SCHEMA", {
        runId: action.payload.runId,
        resultSetId: action.payload.resultSetId,
        columnsLength: action.payload.columns.length,
        columns: action.payload.columns
      });
      return {
        ...state,
        runs: updateResultSet(
          state.runs,
          action.payload.runId,
          action.payload.resultSetId,
          (rs) => ({ ...rs, columns: action.payload.columns })
        ),
      };
    }

    case 'RESULT_SET_ROWS': {
      console.log("[DEBUG] Webview reducer: RESULT_SET_ROWS", {
        runId: action.payload.runId,
        resultSetId: action.payload.resultSetId,
        rowsLength: action.payload.rows.length,
        append: action.payload.append,
        firstRow: action.payload.rows[0]
      });
      return {
        ...state,
        runs: updateResultSet(
          state.runs,
          action.payload.runId,
          action.payload.resultSetId,
          (rs) => ({
            ...rs,
            rows: action.payload.append
              ? [...rs.rows, ...action.payload.rows]
              : action.payload.rows,
          })
        ),
      };
    }

    case 'RESULT_SET_COMPLETE': {
      return {
        ...state,
        runs: updateResultSet(
          state.runs,
          action.payload.runId,
          action.payload.resultSetId,
          (rs) => ({
            ...rs,
            status: 'complete',
            rowCount: action.payload.rowCount ?? rs.rows.length,
            executionTimeMs: action.payload.executionTimeMs,
          })
        ),
      };
    }

    case 'RESULT_SET_ERROR': {
      return {
        ...state,
        runs: updateResultSet(
          state.runs,
          action.payload.runId,
          action.payload.resultSetId,
          (rs) => ({
            ...rs,
            status: 'error',
            errorMessage: action.payload.message,
          })
        ),
      };
    }

    case 'RESULT_SET_CANCELLED': {
      return {
        ...state,
        runs: updateResultSet(
          state.runs,
          action.payload.runId,
          action.payload.resultSetId,
          (rs) => ({
            ...rs,
            status: 'cancelled',
          })
        ),
      };
    }

    // -------------------------------------------------------------------------
    // UI actions
    // -------------------------------------------------------------------------
    case 'SELECT_RUN': {
      const run = state.runs.find((r) => r.id === action.payload.runId);
      return {
        ...state,
        activeRunId: action.payload.runId,
        // Select first result set of the run, if any
        activeResultSetId: run?.results[0]?.id ?? null,
        selectionStats: null,
      };
    }

    case 'SELECT_RESULT_SET': {
      return {
        ...state,
        activeResultSetId: action.payload.resultSetId,
        selectionStats: null,
      };
    }

    case 'CLOSE_RUN': {
      const runIndex = state.runs.findIndex((r) => r.id === action.payload.runId);
      const newRuns = state.runs.filter((r) => r.id !== action.payload.runId);
      
      // Determine new active run
      let newActiveRunId = state.activeRunId;
      let newActiveResultSetId = state.activeResultSetId;
      
      if (state.activeRunId === action.payload.runId) {
        // Select adjacent run or null
        const newActiveRun = newRuns[Math.min(runIndex, newRuns.length - 1)] ?? null;
        newActiveRunId = newActiveRun?.id ?? null;
        newActiveResultSetId = newActiveRun?.results[0]?.id ?? null;
      }
      
      return {
        ...state,
        runs: newRuns,
        activeRunId: newActiveRunId,
        activeResultSetId: newActiveResultSetId,
        selectionStats: null,
      };
    }

    case 'UPDATE_SELECTION_STATS': {
      return {
        ...state,
        selectionStats: action.payload,
      };
    }

    case 'TOGGLE_THEME': {
      const newTheme = state.theme === 'light' ? 'dark' : 'light';
      // Persist theme preference to localStorage
      try {
        localStorage.setItem('tableAssetTheme', newTheme);
      } catch (e) {
        // Ignore localStorage errors
      }
      return {
        ...state,
        theme: newTheme,
      };
    }

    default:
      return state;
  }
}

// ============================================================================
// Helper functions
// ============================================================================

function updateRun(
  runs: QueryRun[],
  runId: string,
  updater: (run: QueryRun) => QueryRun
): QueryRun[] {
  return runs.map((run) => (run.id === runId ? updater(run) : run));
}

function updateResultSet(
  runs: QueryRun[],
  runId: string,
  resultSetId: string,
  updater: (rs: ResultSet) => ResultSet
): QueryRun[] {
  return runs.map((run) => {
    if (run.id !== runId) return run;
    return {
      ...run,
      results: run.results.map((rs) =>
        rs.id === resultSetId ? updater(rs) : rs
      ),
    };
  });
}

// ============================================================================
// Selectors
// ============================================================================

export function getActiveRun(state: AppState): QueryRun | null {
  return state.runs.find((r) => r.id === state.activeRunId) ?? null;
}

export function getActiveResultSet(state: AppState): ResultSet | null {
  const run = getActiveRun(state);
  return run?.results.find((rs) => rs.id === state.activeResultSetId) ?? null;
}
