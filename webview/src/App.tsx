import { useReducer, useEffect, useCallback } from 'react';
import { TopTabs, SideTabs, ResultTable, StatusBar } from './components';
import { reducer, initialState, getActiveRun, getActiveResultSet } from './state';
import { postMessage, notifyReady } from './vscode';
import type { ExtensionMessage, SelectionStats } from './types';

/**
 * Main application component for the SQL Results webview.
 * 
 * Layout:
 * ┌──────────────────────────────────────┐
 * │          Top Tabs (Query History)    │
 * ├────────┬─────────────────────────────┤
 * │ Side   │                             │
 * │ Tabs   │       Result Table          │
 * │(Results│                             │
 * │  per   │                             │
 * │  run)  │                             │
 * ├────────┴─────────────────────────────┤
 * │          Status Bar (Aggregates)     │
 * └──────────────────────────────────────┘
 */
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const activeRun = getActiveRun(state);
  const activeResultSet = getActiveResultSet(state);

  // Handle messages from VS Code extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      // All extension messages are handled by the reducer
      dispatch(message);
    };

    window.addEventListener('message', handleMessage);
    
    // Notify extension that webview is ready
    notifyReady();

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // Event handlers
  const handleSelectRun = useCallback((runId: string) => {
    dispatch({ type: 'SELECT_RUN', payload: { runId } });
    postMessage({ type: 'USER_SELECTED_RUN', payload: { runId } });
  }, []);

  const handleCloseRun = useCallback((runId: string) => {
    dispatch({ type: 'CLOSE_RUN', payload: { runId } });
    postMessage({ type: 'USER_CLOSED_RUN', payload: { runId } });
  }, []);

  const handleSelectResultSet = useCallback((resultSetId: string) => {
    dispatch({ type: 'SELECT_RESULT_SET', payload: { resultSetId } });
    if (state.activeRunId) {
      postMessage({ 
        type: 'USER_SELECTED_RESULTSET', 
        payload: { runId: state.activeRunId, resultSetId } 
      });
    }
  }, [state.activeRunId]);

  const handleSelectionChange = useCallback((stats: SelectionStats | null) => {
    dispatch({ type: 'UPDATE_SELECTION_STATS', payload: stats });
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-vscode-bg text-vscode-fg font-vscode">
      {/* Top: Query History Tabs */}
      <TopTabs
        runs={state.runs}
        activeRunId={state.activeRunId}
        onSelectRun={handleSelectRun}
        onCloseRun={handleCloseRun}
      />

      {/* Middle: Side tabs + Table */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Result Set Tabs (vertical) */}
        {activeRun && (
          <SideTabs
            results={activeRun.results}
            activeResultSetId={state.activeResultSetId}
            onSelectResultSet={handleSelectResultSet}
          />
        )}

        {/* Main: Table */}
        <ResultTable
          resultSet={activeResultSet}
          onSelectionChange={handleSelectionChange}
        />
      </div>

      {/* Bottom: Status Bar */}
      <StatusBar
        resultSet={activeResultSet}
        selectionStats={state.selectionStats}
      />
    </div>
  );
}
