import { useEffect, useRef, useCallback } from 'react';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import type { ResultSet, SelectionStats } from '../types';

type ResultTableProps = {
  resultSet: ResultSet | null;
  onSelectionChange: (stats: SelectionStats | null) => void;
};

/**
 * Main table component using Tabulator for rendering SQL results.
 * Supports sorting, multi-cell selection, and clipboard copy.
 */
export function ResultTable({ resultSet, onSelectionChange }: ResultTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<Tabulator | null>(null);
  const resultSetIdRef = useRef<string | null>(null);

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
      const cells = range.getCells?.() ?? [];
      for (const cell of cells) {
        totalCells++;
        const value = cell.getValue();
        const numValue = parseFloat(value);
        if (!isNaN(numValue) && isFinite(numValue)) {
          numericValues.push(numValue);
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
      resultSetIdRef.current = resultSet?.id ?? null;
      onSelectionChange(null);
    }

    // No result set - show nothing
    if (!resultSet || resultSet.columns.length === 0) {
      return;
    }

    // Create table if not exists
    if (!tableRef.current) {
      const columns = resultSet.columns.map((col) => ({
        title: col.name,
        field: col.name,
        headerSort: true,
        // Responsive column width
        minWidth: 80,
        // Format cells based on type hint
        formatter: col.type === 'number' ? 'money' : undefined,
        formatterParams: col.type === 'number' ? { precision: false, thousand: ',' } : undefined,
      }));

      tableRef.current = new Tabulator(containerRef.current, {
        data: resultSet.rows,
        columns,
        layout: 'fitDataFill',
        height: '100%',
        // Enable features
        movableColumns: true,
        resizableColumns: true,
        // Selection
        selectableRange: true, // Enable range selection
        selectableRangeColumns: true,
        selectableRangeRows: true,
        selectableRangeClearCells: true,
        // Clipboard
        clipboard: true,
        clipboardCopyStyled: false,
        clipboardCopyConfig: {
          columnHeaders: true,
          rowHeaders: false,
        },
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
      tableRef.current.on('clipboardCopied', (data: string) => {
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

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (tableRef.current) {
        tableRef.current.destroy();
        tableRef.current = null;
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
      className="flex-1 overflow-hidden"
      style={{ minHeight: 0 }} // Important for flexbox height calculation
    />
  );
}
