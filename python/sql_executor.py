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
from typing import Optional, Dict, Any, List, Tuple
import time
import threading
from decimal import Decimal
from datetime import date, datetime, time as datetime_time
import re


class SparkErrorParser:
    """
    Parses verbose Spark/Hive ODBC errors into user-friendly messages.
    Extracts the core error message and provides helpful context while
    preserving the full error for debugging.
    """
    
    @staticmethod
    def parse_error(error_str: str) -> Tuple[str, str, Optional[Dict[str, Any]]]:
        """
        Parse a Spark/Hive error and extract meaningful information.
        
        Returns:
            Tuple of (user_friendly_message, error_type, additional_info)
        """
        # Handle pyodbc error tuples that come as strings
        if error_str.startswith("("):
            # Extract the actual error message from the tuple string
            match = re.search(r"'\[HY000\]\s+\[Simba\]\[ODBC\].*?Error running query:\s+(.+)", error_str)
            if match:
                error_str = match.group(1)
        
        # Try to identify the error type and extract the useful message
        error_patterns = [
            # TABLE_OR_VIEW_NOT_FOUND
            (
                r'\[TABLE_OR_VIEW_NOT_FOUND\].*?The table or view `([^`]+)` cannot be found\.',
                "Table Not Found",
                lambda m: SparkErrorParser._format_table_not_found(m.group(1), error_str)
            ),
            # UNRESOLVED_COLUMN with suggestions
            (
                r'\[UNRESOLVED_COLUMN\.WITH_SUGGESTION\].*?column or function parameter with name `([^`]+)` cannot be resolved\. Did you mean one of the following\? \[([^\]]+)\]',
                "Column Not Found",
                lambda m: SparkErrorParser._format_unresolved_column(m.group(1), m.group(2), error_str)
            ),
            # PARSE_SYNTAX_ERROR
            (
                r'\[PARSE_SYNTAX_ERROR\].*?Syntax error at or near ([^\(]+)\.\(line (\d+), pos (\d+)\)',
                "Syntax Error",
                lambda m: SparkErrorParser._format_syntax_error(m.group(1).strip(), m.group(2), m.group(3), error_str)
            ),
            # INVALID_TYPED_LITERAL
            (
                r'\[INVALID_TYPED_LITERAL\].*?The value of the typed literal "([^"]+)" is invalid: ([^\(]+)\.\(line (\d+), pos (\d+)\)',
                "Invalid Literal",
                lambda m: SparkErrorParser._format_invalid_literal(m.group(1), m.group(2), m.group(3), m.group(4), error_str)
            ),
            # Generic AnalysisException
            (
                r'org\.apache\.spark\.sql\.AnalysisException:\s*([^\n]+)',
                "Analysis Error",
                lambda m: SparkErrorParser._format_generic_analysis(m.group(1))
            ),
            # Generic HiveSQLException
            (
                r'org\.apache\.hive\.service\.cli\.HiveSQLException:\s*Error running query:\s*([^\n]+)',
                "Query Error",
                lambda m: SparkErrorParser._format_generic_query(m.group(1))
            ),
        ]
        
        # Try each pattern
        for pattern, error_type, formatter in error_patterns:
            match = re.search(pattern, error_str, re.DOTALL)
            if match:
                try:
                    result = formatter(match)
                    return result["message"], error_type, result.get("details")
                except Exception:
                    # If formatting fails, continue to next pattern
                    pass
        
        # If no pattern matches, try to extract the first meaningful line
        lines = error_str.split('\n')
        for line in lines:
            line = line.strip()
            if line and not line.startswith('at ') and not line.startswith('Caused by:'):
                return line[:500], "Database Error", None
        
        # Fallback: return truncated error
        return error_str[:500] + ("..." if len(error_str) > 500 else ""), "Database Error", None
    
    @staticmethod
    def _format_table_not_found(table_name: str, full_error: str) -> Dict[str, Any]:
        """Format TABLE_OR_VIEW_NOT_FOUND error"""
        # Extract line and position if available
        location = SparkErrorParser._extract_location(full_error)
        
        message = f"Table or view '{table_name}' not found."
        details = {
            "tableName": table_name,
            "suggestion": "Verify the table name spelling and that you have access to the schema."
        }
        
        if location:
            message += f" (line {location['line']}, position {location['pos']})"
            details.update(location)
        
        return {"message": message, "details": details}
    
    @staticmethod
    def _format_unresolved_column(column_name: str, suggestions: str, full_error: str) -> Dict[str, Any]:
        """Format UNRESOLVED_COLUMN error"""
        location = SparkErrorParser._extract_location(full_error)
        
        # Clean up suggestions
        suggestions_list = [s.strip().strip('`') for s in suggestions.split(',')]
        
        message = f"Column '{column_name}' not found."
        if suggestions_list:
            message += f" Did you mean: {', '.join(suggestions_list)}?"
        
        details = {
            "columnName": column_name,
            "suggestions": suggestions_list
        }
        
        if location:
            message += f" (line {location['line']}, position {location['pos']})"
            details.update(location)
        
        return {"message": message, "details": details}
    
    @staticmethod
    def _format_syntax_error(near_text: str, line: str, pos: str, full_error: str) -> Dict[str, Any]:
        """Format PARSE_SYNTAX_ERROR error"""
        # Extract SQL snippet if available
        sql_snippet = SparkErrorParser._extract_sql_snippet(full_error)
        
        message = f"Syntax error near '{near_text}' at line {line}, position {pos}."
        details = {
            "line": int(line),
            "position": int(pos),
            "nearText": near_text
        }
        
        if sql_snippet:
            details["sqlSnippet"] = sql_snippet
            message += f"\n\nProblematic SQL:\n{sql_snippet}"
        
        return {"message": message, "details": details}
    
    @staticmethod
    def _format_invalid_literal(literal_type: str, invalid_value: str, line: str, pos: str, full_error: str) -> Dict[str, Any]:
        """Format INVALID_TYPED_LITERAL error"""
        sql_snippet = SparkErrorParser._extract_sql_snippet(full_error)
        
        message = f"Invalid {literal_type} value: {invalid_value.strip()} (line {line}, position {pos})."
        details = {
            "literalType": literal_type,
            "invalidValue": invalid_value.strip(),
            "line": int(line),
            "position": int(pos)
        }
        
        if sql_snippet:
            details["sqlSnippet"] = sql_snippet
            message += f"\n\nProblematic SQL:\n{sql_snippet}"
        
        return {"message": message, "details": details}
    
    @staticmethod
    def _format_generic_analysis(error_msg: str) -> Dict[str, Any]:
        """Format generic AnalysisException"""
        # Clean up the message
        clean_msg = error_msg.split(';')[0].strip()
        return {"message": clean_msg, "details": None}
    
    @staticmethod
    def _format_generic_query(error_msg: str) -> Dict[str, Any]:
        """Format generic query error"""
        # Clean up the message
        clean_msg = error_msg.split('\n')[0].strip()
        return {"message": clean_msg, "details": None}
    
    @staticmethod
    def _extract_location(error_str: str) -> Optional[Dict[str, int]]:
        """Extract line and position from error string"""
        match = re.search(r'line (\d+).*?pos (\d+)', error_str)
        if match:
            return {
                "line": int(match.group(1)),
                "pos": int(match.group(2))
            }
        return None
    
    @staticmethod
    def _extract_sql_snippet(error_str: str) -> Optional[str]:
        """Extract SQL snippet from error (the part between == SQL ==)"""
        match = re.search(r'== SQL ==\n(.*?)\n\n', error_str, re.DOTALL)
        if match:
            snippet = match.group(1).strip()
            # Limit snippet length
            if len(snippet) > 500:
                snippet = snippet[:500] + "\n..."
            return snippet
        return None


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
        
        # Query cancellation support
        self.is_cancelled: bool = False
        self.current_result_set_id: Optional[str] = None

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
            error_str = str(e)
            
            # Check for "SSL_write: Broken pipe" error - SSH tunnel issue
            ssh_tunnel_hint = ""
            if "SSL_write: Broken pipe" in error_str or "Broken pipe" in error_str:
                ssh_tunnel_hint = "\n\n💡 Connection failed: Ensure your SSH tunnel is up, your DSN is set up correctly in VSCode settings, and try again."
            
            return {
                "success": False,
                "error": error_str + ssh_tunnel_hint,
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
                    error_str = str(e)
                    print(f"[DEBUG] Heartbeat failed: {error_str}", file=sys.stderr)
                    
                    # Check if this is the "No more data to read" error
                    if "No more data to read" in error_str:
                        print("[DEBUG] Detected 'No more data to read' error in heartbeat, attempting reconnection...", file=sys.stderr)
                        try:
                            # Attempt to reconnect
                            reconnect_result = self.reconnect()
                            if reconnect_result.get("success"):
                                print("[DEBUG] Heartbeat reconnection successful", file=sys.stderr)
                            else:
                                print(f"[DEBUG] Heartbeat reconnection failed: {reconnect_result.get('error')}", file=sys.stderr)
                        except Exception as reconnect_error:
                            print(f"[DEBUG] Heartbeat reconnection exception: {str(reconnect_error)}", file=sys.stderr)
                    # Don't break - keep trying

    def execute_query(self, sql: str, result_set_id: str, max_rows: int = 0) -> Dict[str, Any]:
        """Execute a single SQL statement and return results
        
        Args:
            sql: SQL query to execute
            result_set_id: Unique identifier for this result set
            max_rows: Maximum number of rows to return (0 = unlimited)
        """
        if not self.connection or not self.cursor:
            return {
                "success": False,
                "error": "Not connected to database"
            }

        # Try executing the query, with automatic reconnection on connection errors
        return self._execute_query_with_retry(sql, result_set_id, max_rows)
    
    def _execute_query_with_retry(self, sql: str, result_set_id: str, max_rows: int = 0, retry_count: int = 0) -> Dict[str, Any]:
        """Internal method to execute query with automatic reconnection on connection errors"""
        start_time = time.time()
        
        # Track current query and reset cancellation flag
        self.current_result_set_id = result_set_id
        self.is_cancelled = False

        try:
            # Execute the SQL (with lock to prevent heartbeat interference)
            with self.heartbeat_lock:
                self.cursor.execute(sql)
                self.last_activity_time = time.time()  # Update activity time
                
                # Check if query was cancelled during execution
                if self.is_cancelled:
                    execution_time_ms = int((time.time() - start_time) * 1000)
                    return {
                        "success": False,
                        "resultSetId": result_set_id,
                        "error": "Query was cancelled",
                        "errorType": "Cancelled",
                        "executionTimeMs": execution_time_ms,
                        "cancelled": True
                    }

                # Check if this query returns results
                if self.cursor.description is None:
                    # DDL/DML statement with no results (CREATE, DROP, INSERT, etc.)
                    execution_time_ms = int((time.time() - start_time) * 1000)

                    # Get affected rows if available
                    row_count = self.cursor.rowcount if self.cursor.rowcount != -1 else 0
                    
                    # Clear current result set tracking
                    self.current_result_set_id = None

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

                # Fetch rows with limit
                rows = []
                row_count = 0
                for row in self.cursor:
                    # Check if we've reached the limit
                    if max_rows > 0 and row_count >= max_rows:
                        break
                    
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
                    row_count += 1

            execution_time_ms = int((time.time() - start_time) * 1000)
            
            # Clear current result set tracking
            self.current_result_set_id = None

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
            
            # Clear current result set tracking
            self.current_result_set_id = None
            
            # Parse the error to extract user-friendly message
            error_str = str(e)
            full_traceback = traceback.format_exc()
            
            # Check for "No more data to read" error - this means we need to reconnect
            if "No more data to read" in error_str and retry_count == 0:
                print(f"[DEBUG] Detected 'No more data to read' error, attempting automatic reconnection...", file=sys.stderr)
                reconnect_result = self.reconnect()
                
                if reconnect_result.get("success"):
                    print(f"[DEBUG] Reconnection successful, retrying query...", file=sys.stderr)
                    # Retry the query once after successful reconnection
                    return self._execute_query_with_retry(sql, result_set_id, max_rows, retry_count=1)
                else:
                    print(f"[DEBUG] Reconnection failed: {reconnect_result.get('error')}", file=sys.stderr)
                    # Fall through to return the error
            
            # Check for "SSL_write: Broken pipe" error - SSH tunnel issue
            ssh_tunnel_hint = ""
            if "SSL_write: Broken pipe" in error_str or "Broken pipe" in error_str:
                ssh_tunnel_hint = "\n\n💡 Connection lost: Ensure your SSH tunnel is up, your DSN is set up correctly in VSCode settings, and try again."
            
            # Use our error parser to get a clean message
            clean_message, error_type, error_details = SparkErrorParser.parse_error(error_str)
            
            # Append SSH tunnel hint if applicable
            if ssh_tunnel_hint:
                clean_message += ssh_tunnel_hint
            
            return {
                "success": False,
                "resultSetId": result_set_id,
                "error": clean_message,  # User-friendly error message
                "errorType": error_type,  # Category of error
                "errorDetails": error_details,  # Structured details (line, pos, suggestions, etc.)
                "rawError": error_str,  # Full original error
                "traceback": full_traceback,  # Full traceback
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
            error_str = str(e)
            
            # Check for "SSL_write: Broken pipe" error - SSH tunnel issue
            ssh_tunnel_hint = ""
            if "SSL_write: Broken pipe" in error_str or "Broken pipe" in error_str:
                ssh_tunnel_hint = "\n\n💡 Connection failed: Ensure your SSH tunnel is up, your DSN is set up correctly in VSCode settings, and try again."
            
            return {
                "success": False,
                "error": error_str + ssh_tunnel_hint,
                "traceback": traceback.format_exc()
            }

    def cancel_query(self) -> Dict[str, Any]:
        """Cancel the currently executing query without closing the connection"""
        try:
            # Set cancellation flag
            self.is_cancelled = True
            
            # Try to cancel the cursor's current operation
            if self.cursor:
                try:
                    self.cursor.cancel()
                    print("[DEBUG] Query cancellation requested via cursor.cancel()", file=sys.stderr)
                except AttributeError:
                    # Some drivers don't support cancel()
                    print("[DEBUG] cursor.cancel() not supported by driver", file=sys.stderr)
                except Exception as e:
                    print(f"[DEBUG] cursor.cancel() failed: {str(e)}", file=sys.stderr)
            
            return {
                "success": True,
                "message": "Query cancellation requested",
                "resultSetId": self.current_result_set_id
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
                    max_rows = command.get("maxRows", 0)  # 0 means unlimited

                    result = executor.execute_query(sql, result_set_id, max_rows)
                    
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

                elif command_type == "CANCEL":
                    if not executor:
                        send_message({
                            "type": "CANCEL_RESULT",
                            "payload": {
                                "success": False,
                                "error": "No executor instance available"
                            }
                        })
                        continue
                    
                    result = executor.cancel_query()
                    send_message({
                        "type": "CANCEL_RESULT",
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
