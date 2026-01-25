import type { QueryRun } from '../types';

type TopTabsProps = {
  runs: QueryRun[];
  activeRunId: string | null;
  onSelectRun: (runId: string) => void;
  onCloseRun: (runId: string) => void;
};

/**
 * Horizontal tabs at the top showing query execution history.
 * Each tab represents one "run" (execution of one or more SQL statements).
 */
export function TopTabs({ runs, activeRunId, onSelectRun, onCloseRun }: TopTabsProps) {
  if (runs.length === 0) {
    return (
      <div className="h-9 flex items-center px-3 border-b border-vscode-border bg-vscode-tab-inactive text-sm text-gray-500">
        No query results yet
      </div>
    );
  }

  return (
    <div className="h-9 flex items-end border-b border-vscode-border bg-vscode-tab-inactive overflow-x-auto">
      {runs.map((run) => {
        const isActive = run.id === activeRunId;
        return (
          <div
            key={run.id}
            className={`
              tab-item group flex items-center gap-1 px-3 py-1.5 cursor-pointer
              border-r border-vscode-border select-none
              transition-colors duration-100
              ${isActive 
                ? 'bg-vscode-tab-active border-t-2 border-t-vscode-accent' 
                : 'bg-vscode-tab-inactive hover:bg-vscode-hover'
              }
            `}
            onClick={() => onSelectRun(run.id)}
          >
            {/* Status indicator */}
            <StatusIndicator status={run.status} />
            
            {/* Tab title */}
            <span className="text-xs font-medium truncate max-w-[150px]">
              {run.title}
            </span>
            
            {/* Close button */}
            <button
              className="tab-close-btn ml-1 p-0.5 rounded hover:bg-vscode-hover"
              onClick={(e) => {
                e.stopPropagation();
                onCloseRun(run.id);
              }}
              title="Close"
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function StatusIndicator({ status }: { status: QueryRun['status'] }) {
  if (status === 'running') {
    return (
      <span className="spinner w-3 h-3 border-2 border-vscode-accent border-t-transparent rounded-full" />
    );
  }
  if (status === 'error') {
    return (
      <span className="w-2 h-2 rounded-full bg-red-500" title="Error" />
    );
  }
  // Complete - show nothing or a subtle indicator
  return null;
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="opacity-60 hover:opacity-100"
    >
      <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.707.708L8 8.707z" />
    </svg>
  );
}
