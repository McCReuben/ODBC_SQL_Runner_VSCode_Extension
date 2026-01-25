#!/usr/bin/env python3
"""
SQL Executor Backend
Handles ODBC connections and SQL execution via stdin/stdout JSON protocol
"""

import sys
import json
import traceback
import pyodbc
import pandas as pd
from typing import Optional, Dict, Any, List
import time


class SqlExecutor:
    def __init__(self, dsn: str):
        self.dsn = dsn
        self.connection: Optional[pyodbc.Connection] = None
        self.cursor: Optional[pyodbc.Cursor] = None

    def connect(self) -> Dict[str, Any]:
        """Establish ODBC connection"""
        try:
            self.connection = pyodbc.connect(f"DSN={self.dsn}", autocommit=True)
            self.cursor = self.connection.cursor()
            return {
                "success": True,
                "message": f"Connected to {self.dsn}"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "traceback": traceback.format_exc()
            }

    def execute_query(self, sql: str, result_set_id: str) -> Dict[str, Any]:
        """Execute a single SQL statement and return results"""
        if not self.connection or not self.cursor:
            return {
                "success": False,
                "error": "Not connected to database"
            }

        start_time = time.time()

        try:
            # Execute the SQL
            self.cursor.execute(sql)

            # Check if this query returns results
            if self.cursor.description is None:
                # DDL/DML statement with no results (CREATE, DROP, INSERT, etc.)
                execution_time_ms = int((time.time() - start_time) * 1000)

                # Get affected rows if available
                row_count = self.cursor.rowcount if self.cursor.rowcount != -1 else 0

                return {
                    "success": True,
                    "resultSetId": result_set_id,
                    "hasResults": False,
                    "rowCount": row_count,
                    "executionTimeMs": execution_time_ms,
                    "message": f"Query executed successfully ({row_count} rows affected)"
                }

            # Query returns results - extract schema
            columns = [
                {
                    "name": col[0],
                    "type": self._map_sql_type_to_js(col[1])
                }
                for col in self.cursor.description
            ]

            # Fetch all rows
            rows = []
            for row in self.cursor:
                row_dict = {}
                for i, col in enumerate(self.cursor.description):
                    value = row[i]
                    # Convert non-JSON-serializable types
                    if value is not None:
                        if isinstance(value, (bytes, bytearray)):
                            value = value.decode('utf-8', errors='replace')
                        elif hasattr(value, 'isoformat'):
                            value = value.isoformat()
                    row_dict[col[0]] = value
                rows.append(row_dict)

            execution_time_ms = int((time.time() - start_time) * 1000)

            return {
                "success": True,
                "resultSetId": result_set_id,
                "hasResults": True,
                "columns": columns,
                "rows": rows,
                "rowCount": len(rows),
                "executionTimeMs": execution_time_ms
            }

        except Exception as e:
            execution_time_ms = int((time.time() - start_time) * 1000)
            return {
                "success": False,
                "resultSetId": result_set_id,
                "error": str(e),
                "traceback": traceback.format_exc(),
                "executionTimeMs": execution_time_ms
            }

    def _map_sql_type_to_js(self, sql_type) -> str:
        """Map SQL data types to JavaScript types for the frontend"""
        # pyodbc type constants
        if sql_type in (pyodbc.SQL_INTEGER, pyodbc.SQL_SMALLINT, pyodbc.SQL_BIGINT,
                       pyodbc.SQL_TINYINT, pyodbc.SQL_NUMERIC, pyodbc.SQL_DECIMAL,
                       pyodbc.SQL_FLOAT, pyodbc.SQL_REAL, pyodbc.SQL_DOUBLE):
            return "number"
        elif sql_type in (pyodbc.SQL_BIT,):
            return "boolean"
        elif sql_type in (pyodbc.SQL_TYPE_DATE, pyodbc.SQL_TYPE_TIME,
                         pyodbc.SQL_TYPE_TIMESTAMP):
            return "date"
        else:
            return "string"

    def close(self):
        """Close the connection"""
        if self.cursor:
            self.cursor.close()
        if self.connection:
            self.connection.close()


def main():
    """Main loop - read JSON commands from stdin, write JSON responses to stdout"""
    executor: Optional[SqlExecutor] = None

    # Send ready message
    send_message({"type": "READY"})

    try:
        for line in sys.stdin:
            try:
                command = json.loads(line)
                command_type = command.get("type")

                if command_type == "CONNECT":
                    dsn = command.get("dsn", "Hermes")
                    executor = SqlExecutor(dsn)
                    result = executor.connect()
                    send_message({
                        "type": "CONNECT_RESULT",
                        "payload": result
                    })

                elif command_type == "EXECUTE":
                    if not executor:
                        send_message({
                            "type": "EXECUTE_RESULT",
                            "payload": {
                                "success": False,
                                "error": "Not connected"
                            }
                        })
                        continue

                    sql = command.get("sql", "")
                    result_set_id = command.get("resultSetId", "")

                    result = executor.execute_query(sql, result_set_id)
                    
                    # DEBUG: Log the result before sending
                    print(f"[DEBUG] Sending EXECUTE_RESULT for resultSetId={result_set_id}", file=sys.stderr)
                    print(f"[DEBUG] Result success={result.get('success')}, hasResults={result.get('hasResults')}, rowCount={result.get('rowCount')}", file=sys.stderr)
                    if result.get('columns'):
                        print(f"[DEBUG] Columns: {[col['name'] for col in result['columns']]}", file=sys.stderr)
                    print(f"[DEBUG] Full result keys: {list(result.keys())}", file=sys.stderr)
                    
                    send_message({
                        "type": "EXECUTE_RESULT",
                        "payload": result
                    })

                elif command_type == "CLOSE":
                    if executor:
                        executor.close()
                    send_message({
                        "type": "CLOSE_RESULT",
                        "payload": {"success": True}
                    })
                    break

                else:
                    send_message({
                        "type": "ERROR",
                        "payload": {
                            "error": f"Unknown command type: {command_type}"
                        }
                    })

            except json.JSONDecodeError as e:
                error_msg = f"Invalid JSON: {str(e)}"
                print(f"[DEBUG] JSON decode error: {error_msg}", file=sys.stderr)
                send_message({
                    "type": "ERROR",
                    "payload": {
                        "error": error_msg
                    }
                })
            except Exception as e:
                error_msg = str(e)
                tb = traceback.format_exc()
                print(f"[DEBUG] Exception in main loop: {error_msg}", file=sys.stderr)
                print(f"[DEBUG] Traceback:\n{tb}", file=sys.stderr)
                send_message({
                    "type": "ERROR",
                    "payload": {
                        "error": error_msg,
                        "traceback": tb
                    }
                })

    finally:
        if executor:
            executor.close()


def send_message(message: Dict[str, Any]):
    """Send a JSON message to stdout"""
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
