# SQL Runner - VS Code Extension

Execute SQL queries with **Cmd+Enter** and view results in an interactive table with live aggregations, sorting, and multi-cell selection.

![SQL Runner Demo](https://via.placeholder.com/800x450/1e1e1e/ffffff?text=SQL+Runner+Extension)

## Features

- **Smart Execution**: Execute current statement, selection, or multiple statements
- **Query Cancellation**: Cancel running queries with a button in the status bar
- **Session Management**: One connection per file with temporary table persistence
- **Interactive Results**: Sort columns, select cells, view Sum/Avg/Max aggregations
- **Query History**: Switch between past query executions with tabs
- **Mock Mode**: Test instantly with SQLite (no ODBC setup required)
- **ODBC Support**: Connect to production databases via pyodbc

## Quick Start

### Test Immediately (No Database Setup)

```bash
# 1. Build
npm install && cd webview && npm install && npm run build && cd .. && npm run compile

# 2. Configure mock mode (.vscode/settings.json)
{ "sqlRunner.useMockDatabase": true }

# 3. Press F5, open examples/test_mock.sql, press Cmd+Enter
```

### Use with Your Database

```bash
# 1. Install Python dependencies
pip3 install pyodbc pandas

# 2. Build (same as above)
npm install && cd webview && npm install && npm run build && cd .. && npm run compile

# 3. Configure ODBC (.vscode/settings.json)
{
  "sqlRunner.useMockDatabase": false,
  "sqlRunner.odbcDsn": "YourDSN"
}

# 4. Press F5 and start querying
```

## Usage

### Execute Queries

- **Current Statement**: Place cursor in SQL, press **Cmd+Enter** (Mac) / **Ctrl+Enter** (Win/Linux)
- **Selection**: Select SQL text, press **Cmd+Enter**
- **Multiple Statements**: Select multiple statements separated by `;`, press **Cmd+Enter**

### Cancel Running Queries

When a query is running, a **Cancel** button appears in the status bar next to the "Running..." indicator. Click it to immediately stop query execution.

**Note**: Cancelling terminates the Python process, which ends the database session. Temporary tables will be lost. A new session is created on the next query execution.

### Example: Session Persistence

```sql
-- First query: Create temp table
CREATE TEMPORARY TABLE tmp_analysis AS
SELECT * FROM users WHERE active = 1;

-- Second query: Reference temp table (works in same session!)
SELECT COUNT(*) FROM tmp_analysis;
```

Each `.sql` file maintains its own database connection/session.

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `sqlRunner.useMockDatabase` | Use SQLite mock (no ODBC) | `false` |
| `sqlRunner.odbcDsn` | ODBC Data Source Name | `"Hermes"` |
| `sqlRunner.pythonPath` | Path to Python executable | `"python3"` |

## Mock Database

Perfect for testing without database setup. Includes sample tables:

- **people** - 10 employees (id, name, age, email, department)
- **products** - 10 items (id, name, category, price, stock)
- **sales** - 10 transactions (id, product_id, quantity, sale_date, revenue)
- **DW_SITES** - 5 sites (site_id, site_name, region, active)

See [examples/test_mock.sql](examples/test_mock.sql) for ready-to-run examples.

## Project Structure

```
.
├── src/                      # TypeScript extension code
│   ├── extension.ts          # Entry point & command registration
│   ├── sqlExecutor.ts        # Query execution coordinator
│   ├── pythonRunner.ts       # Python process management
│   ├── webviewManager.ts     # Webview panel management
│   └── statementParser.ts    # SQL parsing logic
├── python/
│   ├── sql_executor.py       # ODBC backend (pyodbc)
│   ├── sql_executor_mock.py  # SQLite mock backend
│   └── requirements.txt      # Python dependencies
├── webview/                  # React frontend
│   ├── src/                  # Source code
│   └── dist/                 # Built assets (webview.js, webview.css)
├── examples/
│   ├── test.sql              # ODBC examples
│   └── test_mock.sql         # Mock database examples
├── QUICKSTART.md             # 5-minute setup guide
└── EXTENSION_SETUP.md        # Comprehensive documentation
```

## Architecture

1. **User presses Cmd+Enter** → Extension activates
2. **SQL parsing** → Extract statement(s) based on cursor/selection
3. **Session lookup** → Get or create Python process for file
4. **Query execution** → Python backend executes via ODBC or SQLite
5. **Stream results** → Webview displays interactive table
6. **User interacts** → Sort, select cells, view aggregations

## Development

```bash
# Watch TypeScript changes
npm run watch

# Watch webview changes (dev mode with mock data)
cd webview && npm run dev

# Watch webview changes (for extension)
cd webview && npm run build -- --watch
```

### Debugging

1. Set breakpoints in TypeScript files
2. Press **F5** to launch Extension Development Host
3. Check Debug Console for logs and Python stderr

## Documentation

- [QUICKSTART.md](QUICKSTART.md) - Get running in 5 minutes
- [EXTENSION_SETUP.md](EXTENSION_SETUP.md) - Complete setup guide
- [webview/README.md](webview/README.md) - Webview message protocol

## Requirements

- **VS Code** 1.85.0 or later
- **Node.js** v18 or later
- **Python 3** (standard library for mock mode)
- **For ODBC**: pyodbc, pandas, configured ODBC DSN

## Troubleshooting

### "Connection failed"
- **Mock mode**: Ensure Python 3 is installed (sqlite3 is built-in)
- **ODBC mode**: Test with `python3 -c "import pyodbc; pyodbc.connect('DSN=YourDSN')"`

### "Webview not built"
```bash
cd webview && npm install && npm run build
```

### No results showing
- Check Debug Console (View → Debug Console) for errors
- Verify Python stderr output

### Temp tables not persisting
- Ensure executing from same file (each file = one session)

## Known Limitations

- One session per file (no multi-connection support per file)
- Large result sets (>10k rows) may impact performance
- Query cancellation terminates the session (temporary tables are lost)

## License

MIT

## Contributing

This is an internal development tool. For issues or suggestions, update the GitHub issues tracker.

## Credits

Built with:
- [Tabulator](http://tabulator.info/) - Interactive table library
- [pyodbc](https://github.com/mkleehammer/pyodbc) - ODBC database access
- [React](https://react.dev/) - UI framework
