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
import threading
from decimal import Decimal
from datetime import date, datetime, time as datetime_time


class SqlExecutor:
    def __init__(self, dsn: str):
        self.dsn = dsn
        self.connection: Optional[pyodbc.Connection] = None
        self.cursor: Optional[pyodbc.Cursor] = None
        
        # Heartbeat management
        self.last_activity_time: float = 0
        self.heartbeat_thread: Optional[threading.Thread] = None
        self.heartbeat_stop_event: threading.Event = threading.Event()
        self.heartbeat_interval: int = 120  # Send heartbeat every 2 minutes
        self.heartbeat_lock: threading.Lock = threading.Lock()  # Protect cursor access

    def connect(self) -> Dict[str, Any]:
        """Establish ODBC connection"""
        try:
            self.connection = pyodbc.connect(f"DSN={self.dsn}", autocommit=True)
            self.cursor = self.connection.cursor()
            
            # Set default schema to ACCESS_VIEWS
            self.cursor.execute("USE ACCESS_VIEWS")
            
            # Update last activity time and start heartbeat thread
            self.last_activity_time = time.time()
            self._start_heartbeat()
            
            return {
                "success": True,
                "message": f"Connected to {self.dsn} (schema: ACCESS_VIEWS)"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "traceback": traceback.format_exc()
            }

    def _start_heartbeat(self):
        """Start the heartbeat thread to keep connection alive"""
        if self.heartbeat_thread and self.heartbeat_thread.is_alive():
            return  # Already running
        
        self.heartbeat_stop_event.clear()
        self.heartbeat_thread = threading.Thread(target=self._heartbeat_worker, daemon=True)
        self.heartbeat_thread.start()
        print(f"[DEBUG] Heartbeat thread started (interval: {self.heartbeat_interval}s)", file=sys.stderr)
    
    def _stop_heartbeat(self):
        """Stop the heartbeat thread"""
        if self.heartbeat_thread and self.heartbeat_thread.is_alive():
            self.heartbeat_stop_event.set()
            self.heartbeat_thread.join(timeout=5)
            print("[DEBUG] Heartbeat thread stopped", file=sys.stderr)
    
    def _heartbeat_worker(self):
        """Background worker that sends keepalive queries"""
        while not self.heartbeat_stop_event.is_set():
            # Wait for the interval, but check stop event periodically
            if self.heartbeat_stop_event.wait(timeout=self.heartbeat_interval):
                break  # Stop event was set
            
            # Check if connection needs a heartbeat
            time_since_last_activity = time.time() - self.last_activity_time
            
            # Only send heartbeat if we're approaching the timeout (within 30 seconds of interval)
            if time_since_last_activity >= (self.heartbeat_interval - 30):
                try:
                    with self.heartbeat_lock:
                        if self.cursor and self.connection:
                            # Send a lightweight keepalive query
                            self.cursor.execute("SELECT 1")
                            # Consume the result to complete the query
                            self.cursor.fetchall()
                            self.last_activity_time = time.time()
                            print(f"[DEBUG] Heartbeat sent (idle for {time_since_last_activity:.1f}s)", file=sys.stderr)
                except Exception as e:
                    print(f"[DEBUG] Heartbeat failed: {str(e)}", file=sys.stderr)
                    # Don't break - keep trying

    def execute_query(self, sql: str, result_set_id: str) -> Dict[str, Any]:
        """Execute a single SQL statement and return results"""
        if not self.connection or not self.cursor:
            return {
                "success": False,
                "error": "Not connected to database"
            }

        start_time = time.time()

        try:
            # Execute the SQL (with lock to prevent heartbeat interference)
            with self.heartbeat_lock:
                self.cursor.execute(sql)
                self.last_activity_time = time.time()  # Update activity time

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
                            if isinstance(value, Decimal):
                                value = float(value)
                            elif isinstance(value, (bytes, bytearray)):
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

    def reconnect(self) -> Dict[str, Any]:
        """Reconnect to the database (close and reopen connection)"""
        try:
            # Stop heartbeat thread
            self._stop_heartbeat()
            
            # Close existing connection
            if self.cursor:
                self.cursor.close()
            if self.connection:
                self.connection.close()
            
            # Reestablish connection
            self.connection = pyodbc.connect(f"DSN={self.dsn}", autocommit=True)
            self.cursor = self.connection.cursor()
            
            # Set default schema to ACCESS_VIEWS
            self.cursor.execute("USE ACCESS_VIEWS")
            
            # Update last activity time and restart heartbeat thread
            self.last_activity_time = time.time()
            self._start_heartbeat()
            
            return {
                "success": True,
                "message": f"Reconnected to {self.dsn} (schema: ACCESS_VIEWS)"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "traceback": traceback.format_exc()
            }

    def close(self):
        """Close the connection"""
        # Stop heartbeat thread first
        self._stop_heartbeat()
        
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

                elif command_type == "RECONNECT":
                    if not executor:
                        send_message({
                            "type": "RECONNECT_RESULT",
                            "payload": {
                                "success": False,
                                "error": "No executor instance available"
                            }
                        })
                        continue
                    
                    result = executor.reconnect()
                    send_message({
                        "type": "RECONNECT_RESULT",
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


class CustomJSONEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles Decimal, datetime, and other non-serializable types"""
    def default(self, obj):
        if isinstance(obj, Decimal):
            # Convert Decimal to float
            return float(obj)
        elif isinstance(obj, (datetime, date)):
            # Convert datetime/date to ISO format string
            return obj.isoformat()
        elif isinstance(obj, datetime_time):
            # Convert time to string
            return obj.isoformat()
        elif isinstance(obj, (bytes, bytearray)):
            # Convert bytes to string
            return obj.decode('utf-8', errors='replace')
        # Let the base class raise TypeError for other types
        return super().default(obj)


def send_message(message: Dict[str, Any]):
    """Send a JSON message to stdout"""
    sys.stdout.write(json.dumps(message, cls=CustomJSONEncoder) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
