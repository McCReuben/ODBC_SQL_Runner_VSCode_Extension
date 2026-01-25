# SQL Runner Extension - Setup Guide

A VS Code extension for executing SQL queries via ODBC and displaying results in an interactive webview table.

## Prerequisites

1. **Node.js** (v18 or later)
2. **Python 3** with `pyodbc` and `pandas`
3. **ODBC Driver** configured with a DSN (e.g., "Hermes")

## Installation Steps

### 1. Install Python Dependencies

```bash
# Install Python packages
pip3 install pyodbc pandas

# Or use the requirements file
cd python
pip3 install -r requirements.txt
```

### 2. Install Node.js Dependencies

```bash
# Install extension dependencies
npm install

# Install webview dependencies
cd webview
npm install
cd ..
```

### 3. Build the Webview

```bash
cd webview
npm run build
cd ..
```

This creates `webview/dist/webview.js` and `webview/dist/webview.css` which are loaded by the extension.

### 4. Compile the Extension

```bash
# Compile TypeScript
npm run compile

# Or watch for changes during development
npm run watch
```

## Running the Extension

### Development Mode (Extension Development Host)

1. Open the project root in VS Code
2. Press **F5** to launch the Extension Development Host
3. In the new VS Code window:
   - Open or create a `.sql` file
   - Write some SQL (e.g., `SELECT * FROM users;`)
   - Press **Cmd+Enter** (Mac) or **Ctrl+Enter** (Windows/Linux)

### Configuration

Set your ODBC DSN in VS Code settings:

1. Open Settings (Cmd+, or Ctrl+,)
2. Search for "SQL Runner"
3. Configure:
   - **SQL Runner: ODBC DSN** - Your ODBC Data Source Name (default: "Hermes")
   - **SQL Runner: Python Path** - Path to Python executable (default: "python3")

Or edit `.vscode/settings.json`:

```json
{
  "sqlRunner.odbcDsn": "Hermes",
  "sqlRunner.pythonPath": "/usr/local/bin/python3"
}
```

## Usage

### Executing Queries

1. **Execute Current Statement**: Place cursor anywhere in a SQL statement and press **Cmd+Enter**
2. **Execute Selection**: Select SQL text and press **Cmd+Enter**
3. **Execute Multiple Statements**: Select multiple statements (separated by `;`) and press **Cmd+Enter**

### Session Management

- Each SQL file has its own database session/connection
- Sessions are created on first query execution
- Temporary tables created in one file persist for subsequent queries in that file
- Each file gets its own webview panel showing query history

### Example Workflow

```sql
-- File: analysis.sql

-- First query: Create temp table
CREATE TEMPORARY TABLE tmp_sites AS
SELECT * FROM DW_SITES;

-- Second query: Query the temp table
-- This works because it's in the same session
SELECT * FROM tmp_sites LIMIT 10;

-- Third query: Multiple statements
DROP TABLE IF EXISTS tmp_results;
CREATE TEMPORARY TABLE tmp_results AS SELECT * FROM tmp_sites WHERE active = 1;
SELECT COUNT(*) FROM tmp_results;
```

Execute each block with **Cmd+Enter**. The temp table persists across queries within the same file.

## Webview Features

The results panel includes:

- **Query History Tabs** (Top) - Switch between past query executions
- **Result Set Tabs** (Left) - For queries with multiple result sets
- **Interactive Table** - Sort columns, select multiple cells
- **Live Aggregation** - See Sum/Avg/Max of selected numeric cells in status bar

## Troubleshooting

### "Python process not started" Error

**Solution**: Check your Python path in settings
```bash
which python3  # Use this path in settings
```

### "Connection failed" or ODBC Errors

**Solution**: Verify your ODBC DSN configuration
```bash
# On macOS, check ODBC configuration
cat /Library/ODBC/odbc.ini

# Test ODBC connection with Python
python3 -c "import pyodbc; conn = pyodbc.connect('DSN=Hermes'); print('Success')"
```

### "Webview not built" Error

**Solution**: Build the webview assets
```bash
cd webview
npm install
npm run build
```

### No Results Showing

**Solution**: Check the Debug Console in the Extension Development Host
1. View → Debug Console
2. Look for Python stderr or error messages

### Temporary Tables Not Persisting

**Issue**: Make sure you're executing queries from the same file. Each file has its own session.

## Project Structure

```
.
├── src/
│   ├── extension.ts          # Main entry point
│   ├── sqlExecutor.ts        # Query execution coordinator
│   ├── pythonRunner.ts       # Python process management
│   ├── webviewManager.ts     # Webview panel management
│   └── statementParser.ts    # SQL parsing logic
├── python/
│   ├── sql_executor.py       # Python ODBC backend
│   └── requirements.txt      # Python dependencies
├── webview/
│   ├── src/                  # React frontend source
│   └── dist/                 # Built webview assets
├── package.json              # Extension manifest
└── tsconfig.json             # TypeScript config
```

## Development Tips

### Watching for Changes

```bash
# Terminal 1: Watch TypeScript
npm run watch

# Terminal 2: Watch Webview
cd webview
npm run dev  # For standalone testing with mock data
# OR
npm run build -- --watch  # For extension integration
```

### Debugging

1. Set breakpoints in TypeScript files
2. Press **F5** to launch Extension Development Host
3. Debug Console shows:
   - Extension logs
   - Python process stderr
   - Error messages

### Testing Python Backend Standalone

```bash
cd python
python3 sql_executor.py

# Send JSON commands via stdin:
{"type":"CONNECT","dsn":"Hermes"}
{"type":"EXECUTE","sql":"SELECT 1 as test","resultSetId":"rs1"}
{"type":"CLOSE"}
```

## Known Limitations

- Only supports ODBC connections via pyodbc
- One session per file (no multi-connection support per file)
- Large result sets (>10k rows) may cause performance issues
- No query cancellation support yet

## Next Steps

- Add query cancellation
- Support for saving results to CSV/Excel
- Query history persistence
- Connection pooling
- Syntax highlighting in result SQL display
