import type { ResultSet } from '../types';

type SideTabsProps = {
  results: ResultSet[];
  activeResultSetId: string | null;
  onSelectResultSet: (resultSetId: string) => void;
};

/**
 * Vertical tabs on the left showing result sets for the current run.
 * Each tab represents one result set (one SQL statement's output).
 */
export function SideTabs({ results, activeResultSetId, onSelectResultSet }: SideTabsProps) {
  if (results.length === 0) {
    return (
      <div className="w-32 flex-shrink-0 border-r border-vscode-border bg-vscode-tab-inactive flex items-center justify-center">
        <span className="text-xs text-gray-500 text-center px-2">
          No results
        </span>
      </div>
    );
  }

  return (
    <div className="w-32 flex-shrink-0 border-r border-vscode-border bg-vscode-tab-inactive overflow-y-auto">
      {results.map((rs) => {
        const isActive = rs.id === activeResultSetId;
        return (
          <div
            key={rs.id}
            className={`
              flex items-center gap-2 px-3 py-2 cursor-pointer
              border-b border-vscode-border select-none
              transition-colors duration-100
              ${isActive
                ? 'bg-vscode-tab-active border-l-2 border-l-vscode-accent'
                : 'hover:bg-vscode-hover'
              }
            `}
            onClick={() => onSelectResultSet(rs.id)}
          >
            {/* Status indicator */}
            <ResultStatusIndicator status={rs.status} />
            
            {/* Result title */}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {rs.title}
              </div>
              {rs.status === 'pending' && (
                <div className="text-[10px] text-gray-500 truncate">
                  Waiting...
                </div>
              )}
              {rs.status === 'complete' && rs.rowCount !== undefined && (
                <div className="text-[10px] text-gray-500">
                  {rs.rowCount.toLocaleString()} rows
                </div>
              )}
              {rs.status === 'error' && (
                <div className="text-[10px] text-red-400 truncate">
                  Error
                </div>
              )}
              {rs.status === 'cancelled' && (
                <div className="text-[10px] text-orange-400 truncate">
                  Cancelled
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResultStatusIndicator({ status }: { status: ResultSet['status'] }) {
  if (status === 'pending') {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-gray-400 flex-shrink-0">
        <title>Waiting</title>
        <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM6 5v6h1V5H6zm3 0v6h1V5H9z" />
      </svg>
    );
  }
  if (status === 'running') {
    return (
      <span className="spinner w-3 h-3 border-2 border-vscode-accent border-t-transparent rounded-full flex-shrink-0" />
    );
  }
  if (status === 'error') {
    return (
      <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" title="Error" />
    );
  }
  if (status === 'cancelled') {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-orange-400 flex-shrink-0">
        <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm3.5 4.5L9.914 8l1.586 1.5-.707.707L9.207 8.707l-1.586 1.586-.707-.707L8.5 8l-1.586-1.586.707-.707L9.207 7.293l1.586-1.586z" />
      </svg>
    );
  }
  // Complete
  return (
    <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="Complete" />
  );
}
