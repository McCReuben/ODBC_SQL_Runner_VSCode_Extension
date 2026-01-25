type QueryToolbarProps = {
  queryTitle: string;
  onShowSql: () => void;
  onCopyTable: () => void;
};

/**
 * Toolbar above the result table with actions like "View SQL".
 */
export function QueryToolbar({ queryTitle, onShowSql, onCopyTable }: QueryToolbarProps) {
  return (
    <div className="h-8 flex items-center justify-between px-3 border-b border-vscode-border bg-vscode-tab-inactive">
      <div className="text-xs text-gray-500">
        {queryTitle}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onCopyTable}
          className="flex items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-vscode-hover border border-transparent hover:border-vscode-border text-vscode-fg"
          title="Copy entire table to clipboard (Cmd+Shift+C)"
        >
          <CopyIcon />
          <span>Copy Table</span>
        </button>
        <button
          onClick={onShowSql}
          className="flex items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-vscode-hover border border-transparent hover:border-vscode-border text-vscode-fg"
          title="View SQL Query"
        >
          <CodeIcon />
          <span>View SQL</span>
        </button>
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z" />
      <path d="M3 1L2 2v10l1 1V2h6.414l-1-1H3z" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M4.708 5.578L2.061 8.224l2.647 2.646-.708.708-3-3V7.87l3-3 .708.708zm7-.708L11 5.578l2.647 2.646L11 10.87l.708.708 3-3V7.87l-3-3zM4.908 13l.894.448 5-10L9.908 3l-5 10z" />
    </svg>
  );
}
