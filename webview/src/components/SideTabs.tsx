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

  // Don't show side tabs if there's only one result
  if (results.length === 1) {
    return null;
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
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResultStatusIndicator({ status }: { status: ResultSet['status'] }) {
  if (status === 'running' || status === 'pending') {
    return (
      <span className="spinner w-3 h-3 border-2 border-vscode-accent border-t-transparent rounded-full flex-shrink-0" />
    );
  }
  if (status === 'error') {
    return (
      <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" title="Error" />
    );
  }
  // Complete
  return (
    <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="Complete" />
  );
}
