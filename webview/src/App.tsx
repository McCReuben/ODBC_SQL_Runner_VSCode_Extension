import { useReducer, useEffect, useCallback, useState, useRef } from 'react';
import { TopTabs, SideTabs, ResultTable, StatusBar, SqlModal, QueryToolbar, Toast, type ResultTableHandle } from './components';
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
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [showCopyToast, setShowCopyToast] = useState(false);
  const resultTableRef = useRef<ResultTableHandle>(null);

  const activeRun = getActiveRun(state);
  const activeResultSet = getActiveResultSet(state);

  // Apply theme class to root element
  useEffect(() => {
    const themeClass = `${state.theme}-theme`;
    document.documentElement.className = themeClass;
  }, [state.theme]);

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

  const handleCopyComplete = useCallback(() => {
    setShowCopyToast(true);
  }, []);

  const handleCopyTable = useCallback(() => {
    resultTableRef.current?.copyToClipboard();
  }, []);

  const handleToggleTheme = useCallback(() => {
    dispatch({ type: 'TOGGLE_THEME' });
  }, []);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showSqlModal) {
        setShowSqlModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSqlModal]);

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
      <div className="flex-1 flex min-h-0 min-w-0">
        {/* Left: Result Set Tabs (vertical) */}
        {activeRun && (
          <SideTabs
            results={activeRun.results}
            activeResultSetId={state.activeResultSetId}
            onSelectResultSet={handleSelectResultSet}
          />
        )}

        {/* Right: Toolbar + Table */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Toolbar with View SQL button */}
          {activeRun && activeResultSet && (
            <QueryToolbar
              queryTitle={activeResultSet.title || activeRun.title}
              onShowSql={() => setShowSqlModal(true)}
              onCopyTable={handleCopyTable}
            />
          )}

          {/* Main: Table */}
          <ResultTable
            key={activeResultSet?.id ?? 'empty'}
            ref={resultTableRef}
            resultSet={activeResultSet}
            onSelectionChange={handleSelectionChange}
            onCopyComplete={handleCopyComplete}
          />
        </div>
      </div>

      {/* Bottom: Status Bar */}
      <StatusBar
        resultSet={activeResultSet}
        selectionStats={state.selectionStats}
        queryTimestamp={activeRun?.startedAt}
        theme={state.theme}
        onToggleTheme={handleToggleTheme}
      />

      {/* SQL Modal */}
      {showSqlModal && activeRun && activeResultSet && (
        <SqlModal
          sql={activeResultSet.sql || activeRun.sql}
          title={activeResultSet.title || activeRun.title}
          onClose={() => setShowSqlModal(false)}
        />
      )}

      {/* Copy Toast Notification */}
      {showCopyToast && (
        <Toast
          message="Table copied to clipboard"
          onClose={() => setShowCopyToast(false)}
        />
      )}
    </div>
  );
}
