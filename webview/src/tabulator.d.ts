// Type declarations for Tabulator
// These cover the APIs we use - full types available via @types/tabulator-tables

declare module 'tabulator-tables' {
  export interface ColumnDefinition {
    title: string;
    field: string;
    headerSort?: boolean;
    minWidth?: number;
    formatter?: string;
    formatterParams?: Record<string, unknown>;
    getField?(): string;
  }

  export interface Range {
    getCells(): Cell[][];  // Returns 2D array: rows of cells
  }

  export interface Cell {
    getValue(): unknown;
    getField(): string;
    getRow(): Row;
  }

  export interface Row {
    getData(): Record<string, unknown>;
    getIndex(): number;
    getCell(field: string | ColumnDefinition): Cell;
  }

  export interface TabulatorOptions {
    data?: unknown[];
    columns?: ColumnDefinition[];
    layout?: "fitData" | "fitDataFill" | "fitDataTable" | "fitColumns";
    height?: string | number;
    movableColumns?: boolean;
    resizableColumns?: boolean;
    selectableRange?: boolean | number;
    selectableRangeColumns?: boolean;
    selectableRangeRows?: boolean;
    selectableRangeClearCells?: boolean;
    clipboard?: boolean | string;
    clipboardCopyStyled?: boolean;
    clipboardCopyRowRange?: string;
    clipboardCopyConfig?: {
      columnHeaders?: boolean;
      rowHeaders?: boolean;
    };
    headerSortClickElement?: 'icon' | 'header';
    renderHorizontal?: string; // "virtual" for virtual horizontal rendering
    initialSort?: Array<{ column: string; dir: 'asc' | 'desc' }>;
    renderVerticalBuffer?: number;
    placeholder?: string;
  }

  export class TabulatorFull {
    constructor(element: HTMLElement | string, options: TabulatorOptions);
    destroy(): void;
    replaceData(data: unknown[]): Promise<void>;
    setData(data: unknown[]): Promise<void>;
    getData(): unknown[];
    getColumns(): ColumnDefinition[];
    getRows(): Row[];
    getRanges(): Range[];
    selectRow(rows?: Row | Row[]): void;
    copyToClipboard(selector?: 'all' | 'selected' | 'active'): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
    off(event: string, callback?: (...args: unknown[]) => void): void;
  }
}
