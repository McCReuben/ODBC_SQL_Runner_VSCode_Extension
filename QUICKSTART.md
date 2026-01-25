# Quick Start Guide

Get up and running with the SQL Runner extension in 5 minutes.

## Option A: Quick Test with Mock Database (No ODBC Required)

Skip ODBC setup and test immediately with an in-memory SQLite database.

### Step 1: Build the Project

```bash
# Install extension dependencies
npm install

# Build the webview
cd webview
npm install
npm run build
cd ..

# Compile the extension
npm run compile
```

### Step 2: Enable Mock Mode

Create or edit `.vscode/settings.json`:

```json
{
  "sqlRunner.useMockDatabase": true
}
```

### Step 3: Launch and Test

1. Press **F5** to launch Extension Development Host
2. Open `examples/test_mock.sql` in the new window
3. Press **Cmd+Enter** on any query
4. Results appear instantly with pre-populated sample data!

The mock database includes sample tables: `people`, `products`, `sales`, and `DW_SITES`.

---

## Option B: Full Setup with ODBC Connection

For production use with your actual database.

## Step 1: Install Python Dependencies

```bash
pip3 install pyodbc pandas
```

## Step 2: Build the Project

```bash
# Install extension dependencies
npm install

# Build the webview
cd webview
npm install
npm run build
cd ..

# Compile the extension
npm run compile
```

## Step 3: Configure Your ODBC DSN

Create or edit your VS Code settings (`.vscode/settings.json`):

```json
{
  "sqlRunner.odbcDsn": "Hermes",
  "sqlRunner.pythonPath": "python3"
}
```

Update `"Hermes"` to match your ODBC DSN name.

## Step 4: Launch Extension Development Host

1. Open this project in VS Code
2. Press **F5** (or Run → Start Debugging)
3. A new VS Code window will open

## Step 5: Test the Extension

In the Extension Development Host window:

1. Create a new file: `test.sql`
2. Add some SQL:
   ```sql
   SELECT 1 as id, 'Alice' as name, 25 as age
   UNION ALL
   SELECT 2, 'Bob', 30
   UNION ALL
   SELECT 3, 'Charlie', 35;
   ```
3. Press **Cmd+Enter** (Mac) or **Ctrl+Enter** (Windows/Linux)
4. A webview panel should open showing your results!

## Key Features to Try

### Execute Selected Text
```sql
-- Select just this line and press Cmd+Enter
SELECT * FROM users WHERE active = 1;

-- Then select this line and press Cmd+Enter
SELECT COUNT(*) FROM users;
```

### Execute Multiple Statements
```sql
-- Select all three lines and press Cmd+Enter
DROP TABLE IF EXISTS tmp_test;
CREATE TEMPORARY TABLE tmp_test AS SELECT 1 as num;
SELECT * FROM tmp_test;
```

### Session Persistence
```sql
-- First, create a temp table (Cmd+Enter)
CREATE TEMPORARY TABLE my_temp AS
SELECT 1 as id, 'Test' as value;

-- Then query it (Cmd+Enter on this line only)
-- This works because it's in the same session!
SELECT * FROM my_temp;
```

## Troubleshooting

### Error: "Connection failed"
- Verify your ODBC DSN is configured correctly
- Test with: `python3 -c "import pyodbc; pyodbc.connect('DSN=Hermes')"`

### Error: "Webview not built"
- Run: `cd webview && npm install && npm run build`

### Extension not activating
- Make sure you're editing a `.sql` file
- Check the Debug Console for errors (View → Debug Console)

## Next Steps

See [EXTENSION_SETUP.md](EXTENSION_SETUP.md) for complete documentation.
