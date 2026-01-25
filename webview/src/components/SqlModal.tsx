type SqlModalProps = {
  sql: string;
  title: string;
  onClose: () => void;
};

/**
 * Modal dialog for viewing SQL query text.
 */
export function SqlModal({ sql, title, onClose }: SqlModalProps) {
  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div 
        className="bg-vscode-bg border-2 border-vscode-border rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col m-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-vscode-border">
          <h2 className="text-base font-semibold text-vscode-fg">
            SQL Query: {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-vscode-hover text-vscode-fg"
            title="Close (Esc)"
          >
            <CloseIcon />
          </button>
        </div>

        {/* SQL Content */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="font-vscode-mono text-sm text-vscode-fg whitespace-pre-wrap break-words bg-vscode-input-bg p-4 rounded border border-vscode-border">
            {sql}
          </pre>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-vscode-border">
          <button
            onClick={() => {
              navigator.clipboard.writeText(sql);
            }}
            className="px-3 py-1.5 text-sm rounded bg-vscode-input-bg hover:bg-vscode-hover border border-vscode-border text-vscode-fg"
          >
            Copy to Clipboard
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded bg-vscode-accent hover:opacity-90 text-white font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.707.708L8 8.707z" />
    </svg>
  );
}
