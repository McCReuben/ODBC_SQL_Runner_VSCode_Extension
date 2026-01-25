import type { ResultSet, SelectionStats } from '../types';

type StatusBarProps = {
  resultSet: ResultSet | null;
  selectionStats: SelectionStats | null;
};

/**
 * Bottom status bar showing:
 * - Result set metadata (row count, execution time)
 * - Selection aggregates (sum, avg, max) when numeric cells are selected
 */
export function StatusBar({ resultSet, selectionStats }: StatusBarProps) {
  return (
    <div className="h-6 flex items-center justify-between px-3 border-t border-vscode-border bg-vscode-tab-inactive text-[11px]">
      {/* Left side: Result set info */}
      <div className="flex items-center gap-4">
        {resultSet ? (
          <>
            {resultSet.status === 'running' && (
              <span className="text-yellow-400 flex items-center gap-1">
                <span className="spinner w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full" />
                Running...
              </span>
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
          </>
        ) : (
          <span className="text-gray-500">No result selected</span>
        )}
      </div>

      {/* Right side: Selection aggregates */}
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
      </div>
    </div>
  );
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
