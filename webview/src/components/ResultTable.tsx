import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import type { ResultSet, SelectionStats } from '../types';

type ResultTableProps = {
  resultSet: ResultSet | null;
  onSelectionChange: (stats: SelectionStats | null) => void;
  onCopyComplete?: () => void;
};

export type ResultTableHandle = {
  copyToClipboard: () => void;
};

/**
 * Main table component using Tabulator for rendering SQL results.
 * Supports sorting, multi-cell selection, and clipboard copy.
 */
export const ResultTable = forwardRef<ResultTableHandle, ResultTableProps>(
  function ResultTable({ resultSet, onSelectionChange, onCopyComplete }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<Tabulator | null>(null);
    const resultSetIdRef = useRef<string | null>(null);

    // Expose copy method to parent via ref
    useImperativeHandle(ref, () => ({
      copyToClipboard: () => {
        if (tableRef.current) {
          tableRef.current.copyToClipboard('all');
          onCopyComplete?.();
        }
      }
    }), [onCopyComplete]);

    // Compute selection stats from selected cells
    const computeSelectionStats = useCallback((table: Tabulator): SelectionStats | null => {
      // Get selected data - Tabulator's range selection
      const selectedRanges = table.getRanges?.() ?? [];

      if (selectedRanges.length === 0) {
        return null;
      }

      const numericValues: number[] = [];
      let totalCells = 0;

      for (const range of selectedRanges) {
        const cellRows = range.getCells?.() ?? [];
        // getCells returns a 2D array: array of rows, each containing cells
        for (const row of cellRows) {
          for (const cell of row) {
            totalCells++;
            const value = (cell as any)._cell?.value;
            const numValue = parseFloat(String(value));
            if (!isNaN(numValue) && isFinite(numValue)) {
              numericValues.push(numValue);
            }
          }
        }
      }

      if (totalCells === 0) {
        return null;
      }

      if (numericValues.length === 0) {
        return {
          cellCount: totalCells,
          numericCellCount: 0,
          sum: 0,
          avg: 0,
          max: 0,
        };
      }

      const sum = numericValues.reduce((a, b) => a + b, 0);
      const avg = sum / numericValues.length;
      const max = Math.max(...numericValues);

      return {
        cellCount: totalCells,
        numericCellCount: numericValues.length,
        sum,
        avg,
        max,
      };
    }, []);

    // Initialize or update Tabulator
    useEffect(() => {
      if (!containerRef.current) return;

      // If result set changed, destroy and recreate table
      if (resultSetIdRef.current !== resultSet?.id) {
        if (tableRef.current) {
          tableRef.current.destroy();
          tableRef.current = null;
        }
        // Clear the container to remove any leftover DOM elements
        // containerRef.current.innerHTML = '';
        resultSetIdRef.current = resultSet?.id ?? null;
        onSelectionChange(null);
      }

      // No result set - show nothing
      if (!resultSet || resultSet.columns.length === 0) {
        // Make sure table is destroyed if it exists
        if (tableRef.current) {
          tableRef.current.destroy();
          tableRef.current = null;
          // containerRef.current.innerHTML = '';
        }
        return;
      }

      // Create table if not exists
      if (!tableRef.current) {
        const columns = resultSet.columns.map((col) => ({
          title: col.name,
          field: col.name,
          headerSort: true,
          // Responsive column width
          // minWidth: 80,
          // Format cells based on type hint
          formatter: col.type === 'number' ? 'money' : undefined,
          formatterParams: col.type === 'number' ? { precision: false, thousand: ',' } : undefined,
        }));

        tableRef.current = new Tabulator(containerRef.current, {
          data: resultSet.rows,
          columns,
          layout: 'fitDataFill',
          resizableColumns: true,
          // Selection
          selectableRange: true, // Enable range selection
          selectableRangeColumns: true,
          headerSortClickElement: 'icon',
          // Clipboard
          clipboard: true,
          clipboardCopyStyled: false,
          clipboardCopyConfig: {
            columnHeaders: true,
            rowHeaders: false,
          },
          clipboardCopyRowRange: 'range',
          // Sorting
          initialSort: [],
          // Performance
          renderVerticalBuffer: 300,
          // Placeholder for empty data
          placeholder: 'No data',

        });

        // Listen for selection changes
        tableRef.current.on('rangeChanged', () => {
          if (tableRef.current) {
            const stats = computeSelectionStats(tableRef.current);
            onSelectionChange(stats);
          }
        });

        // Also handle clipboard copy event
        tableRef.current.on('clipboardCopied', (...args: unknown[]) => {
          const data = args[0] as string;
          console.log('Copied to clipboard:', data.slice(0, 100) + '...');

        });
      } else {
        // Table exists - update data incrementally
        // Tabulator's replaceData is efficient for updates
        tableRef.current.replaceData(resultSet.rows);
      }

      return () => {
        // Cleanup on unmount
      };
    }, [resultSet, computeSelectionStats, onSelectionChange]);

    // Handle Cmd+Shift+C / Ctrl+Shift+C to copy entire table to clipboard
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Check for Cmd+Shift+C (Mac) or Ctrl+Shift+C (Windows/Linux)
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'c') {
          // Check if we have a table and it has data
          if (!tableRef.current || !resultSet || resultSet.rows.length === 0) {
            return;
          }

          // Check if the event target is within the table container
          const target = e.target as HTMLElement;
          if (!containerRef.current?.contains(target)) {
            return;
          }

          // Prevent the default behavior
          e.preventDefault();
          e.stopPropagation();

          // Copy entire table to clipboard using Tabulator's clipboard API
          tableRef.current.copyToClipboard('all');
          onCopyComplete?.();

          console.log('Copied entire table to clipboard');
        }
      };

      // Add event listener to the container
      const container = containerRef.current;
      if (container) {
        container.addEventListener('keydown', handleKeyDown, true);
      }

      return () => {
        if (container) {
          container.removeEventListener('keydown', handleKeyDown, true);
        }
      };
    }, [resultSet, onCopyComplete]);

    // Cleanup on component unmount
    useEffect(() => {
      return () => {
        if (tableRef.current) {
          tableRef.current.destroy();
          tableRef.current = null;
        }
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
        }
      };
    }, []);

    // Render loading/error states
    if (!resultSet) {
      return (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <div className="text-4xl mb-2">📊</div>
            <div>Run a query to see results</div>
          </div>
        </div>
      );
    }

    if (resultSet.status === 'error') {
      return (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 max-w-lg">
            <div className="text-red-400 font-medium mb-2">Query Error</div>
            <div className="text-sm text-red-300 font-mono whitespace-pre-wrap">
              {resultSet.errorMessage || 'An unknown error occurred'}
            </div>
          </div>
        </div>
      );
    }

    if (resultSet.status === 'cancelled') {
      return (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-orange-900/20 border border-orange-700 rounded-lg p-4 max-w-lg">
            <div className="text-center">
              <svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor" className="text-orange-400 mx-auto mb-3">
                <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm3.5 4.5L9.914 8l1.586 1.5-.707.707L9.207 8.707l-1.586 1.586-.707-.707L8.5 8l-1.586-1.586.707-.707L9.207 7.293l1.586-1.586z" />
              </svg>
              <div className="text-orange-400 font-medium mb-1">Query Cancelled</div>
              <div className="text-sm text-orange-300">
                The query was cancelled before it could complete
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (resultSet.status === 'pending') {
      return (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <div className="spinner w-8 h-8 border-4 border-vscode-accent border-t-transparent rounded-full mx-auto mb-3" />
            <div>Waiting for results...</div>
          </div>
        </div>
      );
    }

    if (resultSet.columns.length === 0 && resultSet.status === 'running') {
      return (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <div className="spinner w-8 h-8 border-4 border-vscode-accent border-t-transparent rounded-full mx-auto mb-3" />
            <div>Fetching schema...</div>
          </div>
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        className="flex-1"
        style={{ minHeight: 0, overflow: 'auto' }} // Allow scrolling for table
        tabIndex={0} // Make container focusable for keyboard events
      />
    );
  });
