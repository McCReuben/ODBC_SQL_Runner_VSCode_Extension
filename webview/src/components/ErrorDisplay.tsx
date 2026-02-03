import { useState } from 'react';
import type { QueryError } from '../types';

type ErrorDisplayProps = {
  error?: QueryError;
  legacyMessage?: string; // For backward compatibility
  sql?: string; // The SQL statement that caused the error
};

/**
 * Highlights the error location in SQL by showing the relevant lines and a caret pointer
 */
function highlightSqlError(sql: string, line: number, position: number): JSX.Element {
  const lines = sql.split('\n');
  
  // Show context: 2 lines before and 2 lines after the error line (or less if near boundaries)
  const errorLineIdx = line - 1; // Convert to 0-based index
  const startLine = Math.max(0, errorLineIdx - 2);
  const endLine = Math.min(lines.length - 1, errorLineIdx + 2);
  
  const contextLines = lines.slice(startLine, endLine + 1);
  
  return (
    <div className="mt-3 p-3 bg-black/30 rounded border border-red-800/50">
      <div className="text-xs text-red-400 font-medium mb-2">SQL with Error Location:</div>
      <div className="text-xs font-mono overflow-x-auto">
        {contextLines.map((lineText, idx) => {
          const currentLineNum = startLine + idx + 1;
          const isErrorLine = currentLineNum === line;
          
          return (
            <div key={idx}>
              <div className={`${isErrorLine ? 'text-red-300 bg-red-900/30' : 'text-gray-400'}`}>
                <span className="inline-block w-8 text-right mr-3 select-none opacity-60">
                  {currentLineNum}
                </span>
                <span className="text-red-200">{lineText || ' '}</span>
              </div>
              {isErrorLine && position > 0 && (
                <div className="text-red-400">
                  <span className="inline-block w-8 mr-3"></span>
                  <span>{' '.repeat(position - 1)}^</span>
                  <span className="ml-2 text-xs">└─ Error here</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Displays SQL query errors in a user-friendly format.
 * Shows a clean error message by default with an expandable section for full details.
 */
export function ErrorDisplay({ error, legacyMessage, sql }: ErrorDisplayProps) {
  const [showFullError, setShowFullError] = useState(false);
  const [showTraceback, setShowTraceback] = useState(false);

  // Handle legacy error format
  if (!error && legacyMessage) {
    return (
      <div className="flex-1 flex flex-col p-4 overflow-auto">
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 max-w-2xl w-full mx-auto">
          <div className="text-red-400 font-medium mb-2">Query Error</div>
          <div className="text-sm text-red-300 font-mono whitespace-pre-wrap max-h-[60vh] overflow-y-auto">
            {legacyMessage}
          </div>
        </div>
      </div>
    );
  }

  if (!error) {
    return (
      <div className="flex-1 flex flex-col p-4 overflow-auto">
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 max-w-2xl w-full mx-auto">
          <div className="text-red-400 font-medium mb-2">Query Error</div>
          <div className="text-sm text-red-300">An unknown error occurred</div>
        </div>
      </div>
    );
  }

  const hasFullError = Boolean(error.rawError || error.traceback);

  return (
    <div className="flex-1 flex flex-col p-4 overflow-auto">
      <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 max-w-2xl w-full mx-auto max-h-[80vh] overflow-y-auto">
        {/* Error Type Badge */}
        {error.type && (
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-block px-2 py-1 bg-red-800/50 text-red-300 text-xs font-medium rounded">
              {error.type}
            </span>
          </div>
        )}

        {/* Main Error Message */}
        <div className="text-red-400 font-medium mb-3">Query Error</div>
        <div className="text-sm text-red-200 whitespace-pre-wrap mb-4">
          {error.message}
        </div>

        {/* Structured Details */}
        {error.details && (
          <div className="mb-4 space-y-2">
            {/* Location Information with SQL Highlighting */}
            {(error.details.line !== undefined && error.details.position !== undefined && sql) ? (
              // Show SQL with error location highlighted
              highlightSqlError(sql, error.details.line, error.details.position)
            ) : (error.details.line !== undefined || error.details.position !== undefined) ? (
              // Fallback to text-only location if SQL not available
              <div className="text-xs text-red-300">
                <span className="text-red-400 font-medium">Location: </span>
                {error.details.line !== undefined && `Line ${error.details.line}`}
                {error.details.position !== undefined && `, Position ${error.details.position}`}
              </div>
            ) : null}

            {/* Column Suggestions */}
            {error.details.suggestions && error.details.suggestions.length > 0 && (
              <div className="text-xs text-red-300">
                <span className="text-red-400 font-medium">Suggestions: </span>
                <span className="font-mono">
                  {error.details.suggestions.join(', ')}
                </span>
              </div>
            )}

            {/* Table Name */}
            {error.details.tableName && (
              <div className="text-xs text-red-300">
                <span className="text-red-400 font-medium">Table: </span>
                <span className="font-mono">{error.details.tableName}</span>
              </div>
            )}

            {/* Column Name */}
            {error.details.columnName && (
              <div className="text-xs text-red-300">
                <span className="text-red-400 font-medium">Column: </span>
                <span className="font-mono">{error.details.columnName}</span>
              </div>
            )}

            {/* SQL Snippet */}
            {error.details.sqlSnippet && (
              <div className="mt-3 p-2 bg-black/30 rounded border border-red-800/50">
                <div className="text-xs text-red-400 font-medium mb-1">SQL Context:</div>
                <pre className="text-xs text-red-200 font-mono whitespace-pre overflow-x-auto">
                  {error.details.sqlSnippet}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Expandable Full Error Section */}
        {hasFullError && (
          <div className="border-t border-red-800 pt-3 mt-3">
            <button
              onClick={() => setShowFullError(!showFullError)}
              className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition-colors mb-2"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
                className={`transition-transform ${showFullError ? 'rotate-90' : ''}`}
              >
                <path d="M6 4l4 4-4 4V4z" />
              </svg>
              <span className="font-medium">
                {showFullError ? 'Hide' : 'Show'} Full Error Details
              </span>
            </button>

            {showFullError && (
              <div className="space-y-3">
                {/* Raw Error */}
                {error.rawError && (
                  <div className="p-3 bg-black/30 rounded border border-red-800/50">
                    <div className="text-xs text-red-400 font-medium mb-2">Original Error:</div>
                    <pre className="text-xs text-red-200 font-mono whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
                      {error.rawError}
                    </pre>
                  </div>
                )}

                {/* Traceback (collapsible within full error) */}
                {error.traceback && (
                  <div>
                    <button
                      onClick={() => setShowTraceback(!showTraceback)}
                      className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition-colors mb-2"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className={`transition-transform ${showTraceback ? 'rotate-90' : ''}`}
                      >
                        <path d="M6 4l4 4-4 4V4z" />
                      </svg>
                      <span className="font-medium">
                        {showTraceback ? 'Hide' : 'Show'} Python Traceback
                      </span>
                    </button>

                    {showTraceback && (
                      <div className="p-3 bg-black/30 rounded border border-red-800/50">
                        <pre className="text-xs text-red-200 font-mono whitespace-pre-wrap overflow-x-auto max-h-96 overflow-y-auto">
                          {error.traceback}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
