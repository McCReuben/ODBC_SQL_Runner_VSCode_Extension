import type { ResultSet, SelectionStats, Theme, ConnectionStatus } from '../types';

type StatusBarProps = {
  resultSet: ResultSet | null;
  selectionStats: SelectionStats | null;
  queryTimestamp?: number;
  theme: Theme;
  onToggleTheme: () => void;
  isQueryRunning?: boolean;
  onCancelQuery?: () => void;
  connectionStatus?: ConnectionStatus;
  onReconnect?: () => void;
};

/**
 * Bottom status bar showing:
 * - Result set metadata (query timestamp, row count, execution time)
 * - Selection aggregates (sum, avg, max) when numeric cells are selected
 * - Settings gear icon for theme toggle
 * - Cancel button when query is running
 * - Reconnect button for connection errors
 */
export function StatusBar({ 
  resultSet, 
  selectionStats, 
  queryTimestamp, 
  theme, 
  onToggleTheme, 
  isQueryRunning, 
  onCancelQuery, 
  connectionStatus,
  onReconnect 
}: StatusBarProps) {
  return (
    <div className="h-6 flex items-center justify-between px-3 border-t border-vscode-border bg-vscode-tab-inactive text-[11px]">
      {/* Left side: Result set info */}
      <div className="flex items-center gap-4">
        {resultSet ? (
          <>
            {queryTimestamp && (
              <span>
                <span className="text-gray-500">Executed:</span>{' '}
                <span className="font-medium">{formatTimestamp(queryTimestamp)}</span>
              </span>
            )}
            {resultSet.status === 'running' && (
              <div className="flex items-center gap-2">
                <span className="text-yellow-400 flex items-center gap-1">
                  <span className="spinner w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full" />
                  Running...
                </span>
                {isQueryRunning && onCancelQuery && (
                  <button
                    onClick={onCancelQuery}
                    className="px-2 py-0.5 text-[10px] bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                    title="Cancel query execution"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
            {resultSet.status === 'complete' && (
              <>
                <span>
                  <span className="text-gray-500">Rows:</span>{' '}
                  <span className="font-medium">{resultSet.rowCount?.toLocaleString() ?? resultSet.rows.length.toLocaleString()}</span>
                </span>
                {resultSet.executionTimeMs !== undefined && (
                  <span>
                    <span className="text-gray-500">Time:</span>{' '}
                    <span className="font-medium">{formatDuration(resultSet.executionTimeMs)}</span>
                  </span>
                )}
              </>
            )}
            {resultSet.status === 'error' && (
              <span className="text-red-400 truncate max-w-xs" title={resultSet.errorMessage}>
                Error: {resultSet.errorMessage}
              </span>
            )}
            {resultSet.status === 'cancelled' && (
              <span className="text-orange-400 flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm3.5 4.5L9.914 8l1.586 1.5-.707.707L9.207 8.707l-1.586 1.586-.707-.707L8.5 8l-1.586-1.586.707-.707L9.207 7.293l1.586-1.586z" />
                </svg>
                Cancelled
              </span>
            )}
          </>
        ) : (
          <span className="text-gray-500">No result selected</span>
        )}
      </div>

      {/* Right side: Selection aggregates & Settings */}
      <div className="flex items-center gap-4">
        {selectionStats ? (
          selectionStats.numericCellCount > 0 ? (
            <>
              <span>
                <span className="text-gray-500">Selected:</span>{' '}
                <span className="font-medium">{selectionStats.cellCount}</span>
                {selectionStats.numericCellCount !== selectionStats.cellCount && (
                  <span className="text-gray-500"> ({selectionStats.numericCellCount} numeric)</span>
                )}
              </span>
              <span>
                <span className="text-gray-500">Sum:</span>{' '}
                <span className="font-medium text-blue-400">{formatNumber(selectionStats.sum)}</span>
              </span>
              <span>
                <span className="text-gray-500">Avg:</span>{' '}
                <span className="font-medium text-green-400">{formatNumber(selectionStats.avg)}</span>
              </span>
              <span>
                <span className="text-gray-500">Max:</span>{' '}
                <span className="font-medium text-orange-400">{formatNumber(selectionStats.max)}</span>
              </span>
            </>
          ) : (
            <span className="text-gray-500">
              {selectionStats.cellCount} cells selected (no numeric values)
            </span>
          )
        ) : (
          <span className="text-gray-500">Select cells to see aggregates</span>
        )}

        {/* Reconnect button - show when connection error and not running query */}
        {connectionStatus === 'error' && !isQueryRunning && onReconnect && (
          <button
            onClick={onReconnect}
            className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            title="Reconnect to database"
          >
            <ReconnectIcon />
            <span>Reconnect</span>
          </button>
        )}

        {/* Theme toggle button */}
        <button
          onClick={onToggleTheme}
          className="ml-2 p-1 rounded hover:bg-vscode-hover transition-colors"
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="opacity-70 hover:opacity-100"
          >
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 13V2a6 6 0 1 1 0 12z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatNumber(n: number): string {
  // Handle very large or very small numbers with scientific notation
  if (Math.abs(n) >= 1e9 || (Math.abs(n) < 0.0001 && n !== 0)) {
    return n.toExponential(2);
  }
  // Round to avoid floating point display issues
  const rounded = Math.round(n * 1000000) / 1000000;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function ReconnectIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M8 1a7 7 0 0 0-7 7h1a6 6 0 0 1 6-6V1zm0 14a7 7 0 0 0 7-7h-1a6 6 0 0 1-6 6v1z" />
      <path d="M4.5 8.5L3 7l-1.5 1.5L0 7l3-3 3 3-1.5 1.5L3 7l1.5 1.5z" />
      <path d="M11.5 7.5L13 9l1.5-1.5L16 9l-3 3-3-3 1.5-1.5L13 9l-1.5-1.5z" />
    </svg>
  );
}
