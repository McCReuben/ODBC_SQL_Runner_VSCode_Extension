#!/usr/bin/env python3
"""
SQL Executor Mock Backend (SQLite3)
Handles in-memory SQLite database for testing/debugging without ODBC setup
Uses the same JSON protocol as sql_executor.py
"""

import sys
import json
import traceback
import sqlite3
from typing import Optional, Dict, Any, List
import time


class SqlExecutorMock:
    def __init__(self):
        self.connection: Optional[sqlite3.Connection] = None
        self.cursor: Optional[sqlite3.Cursor] = None

    def connect(self) -> Dict[str, Any]:
        """Establish SQLite in-memory connection and populate sample data"""
        try:
            # Create in-memory database
            self.connection = sqlite3.connect(":memory:")
            self.connection.row_factory = sqlite3.Row  # Enable column access by name
            self.cursor = self.connection.cursor()
            
            # Simulate slow connection (for testing)
            print("Pausing for 5 seconds to simulate slow connection", flush=True)
            time.sleep(5)
            print("Connection established", flush=True)

            # Create sample tables
            self._create_sample_data()

            return {
                "success": True,
                "message": "Connected to Mock SQLite Database (in-memory)"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "traceback": traceback.format_exc()
            }

    def _create_sample_data(self):
        """Create sample tables with data for testing"""

        # Table 1: people
        self.cursor.execute("""
            CREATE TABLE people (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                age INTEGER,
                email TEXT,
                department TEXT
            )
        """)

        people_data = [
            ("Alice", 30, "alice@example.com", "Engineering"),
            ("Bob", 25, "bob@example.com", "Sales"),
            ("Charlie", 35, "charlie@example.com", "Engineering"),
            ("Diana", 28, "diana@example.com", "Marketing"),
            ("Eve", 32, "eve@example.com", "Engineering"),
            ("Frank", 29, "frank@example.com", "Sales"),
            ("Grace", 26, "grace@example.com", "HR"),
            ("Henry", 31, "henry@example.com", "Engineering"),
            ("Ivy", 27, "ivy@example.com", "Marketing"),
            ("Jack", 33, "jack@example.com", "Sales")
        ]

        self.cursor.executemany(
            "INSERT INTO people (name, age, email, department) VALUES (?, ?, ?, ?)",
            people_data
        )

        # Table 2: products
        self.cursor.execute("""
            CREATE TABLE products (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT,
                price REAL,
                stock INTEGER
            )
        """)

        products_data = [
            ("Laptop", "Electronics", 999.99, 50),
            ("Mouse", "Electronics", 29.99, 200),
            ("Keyboard", "Electronics", 79.99, 150),
            ("Monitor", "Electronics", 299.99, 75),
            ("Desk Chair", "Furniture", 249.99, 30),
            ("Desk", "Furniture", 399.99, 20),
            ("Notebook", "Stationery", 4.99, 500),
            ("Pen Set", "Stationery", 12.99, 300),
            ("Water Bottle", "Accessories", 19.99, 100),
            ("Backpack", "Accessories", 49.99, 80)
        ]

        self.cursor.executemany(
            "INSERT INTO products (name, category, price, stock) VALUES (?, ?, ?, ?)",
            products_data
        )

        # Table 3: sales
        self.cursor.execute("""
            CREATE TABLE sales (
                id INTEGER PRIMARY KEY,
                product_id INTEGER,
                quantity INTEGER,
                sale_date TEXT,
                revenue REAL,
                FOREIGN KEY (product_id) REFERENCES products(id)
            )
        """)

        sales_data = [
            (1, 5, "2024-01-15", 4999.95),
            (2, 20, "2024-01-16", 599.80),
            (3, 10, "2024-01-17", 799.90),
            (1, 3, "2024-01-18", 2999.97),
            (5, 2, "2024-01-19", 499.98),
            (7, 50, "2024-01-20", 249.50),
            (8, 30, "2024-01-21", 389.70),
            (4, 5, "2024-01-22", 1499.95),
            (6, 1, "2024-01-23", 399.99),
            (9, 10, "2024-01-24", 199.90)
        ]

        self.cursor.executemany(
            "INSERT INTO sales (product_id, quantity, sale_date, revenue) VALUES (?, ?, ?, ?)",
            sales_data
        )

        # Table 4: DW_SITES (for compatibility with example queries)
        self.cursor.execute("""
            CREATE TABLE DW_SITES (
                site_id INTEGER PRIMARY KEY,
                site_name TEXT NOT NULL,
                region TEXT,
                active INTEGER DEFAULT 1
            )
        """)

        sites_data = [
            ("Site A", "North", 1),
            ("Site B", "South", 1),
            ("Site C", "East", 0),
            ("Site D", "West", 1),
            ("Site E", "North", 1)
        ]

        self.cursor.executemany(
            "INSERT INTO DW_SITES (site_name, region, active) VALUES (?, ?, ?)",
            sites_data
        )

        # Create a view as well
        self.cursor.execute("""
            CREATE VIEW active_sites AS
            SELECT * FROM DW_SITES WHERE active = 1
        """)

        self.connection.commit()

    def execute_query(self, sql: str, result_set_id: str) -> Dict[str, Any]:
        """Execute a single SQL statement and return results"""
        if not self.connection or not self.cursor:
            return {
                "success": False,
                "error": "Not connected to database"
            }

        start_time = time.time()

        try:
            # Check for slow query simulation trigger
            # Usage: Add -- SLOW_QUERY or /* SLOW_QUERY */ to your SQL
            if "SLOW_QUERY" in sql.upper():
                # Simulate a slow query with 5 second delay
                time.sleep(10)
            
            # Execute the SQL
            self.cursor.execute(sql)

            # Check if this query returns results
            # For SQLite, we check if there are column descriptions
            if self.cursor.description is None:
                # DDL/DML statement with no results (CREATE, DROP, INSERT, etc.)
                execution_time_ms = int((time.time() - start_time) * 1000)

                # Commit the transaction
                self.connection.commit()

                # Get affected rows
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
                    "type": self._infer_column_type(col[0])
                }
                for col in self.cursor.description
            ]

            # Fetch all rows
            rows = []
            for row in self.cursor:
                row_dict = {}
                for key in row.keys():
                    value = row[key]
                    # SQLite data is already JSON-serializable
                    row_dict[key] = value
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

    def _infer_column_type(self, col_name: str) -> str:
        """Infer JavaScript type from column name (simple heuristic)"""
        col_lower = col_name.lower()

        # Number types
        if any(keyword in col_lower for keyword in ['id', 'age', 'quantity', 'stock', 'count']):
            return "number"

        # Price/revenue types
        if any(keyword in col_lower for keyword in ['price', 'revenue', 'amount', 'cost', 'total']):
            return "number"

        # Date types
        if any(keyword in col_lower for keyword in ['date', 'time', 'timestamp', 'created', 'updated']):
            return "date"

        # Boolean types
        if any(keyword in col_lower for keyword in ['active', 'enabled', 'is_', 'has_']):
            return "boolean"

        # Default to string
        return "string"

    def close(self):
        """Close the connection"""
        if self.cursor:
            self.cursor.close()
        if self.connection:
            self.connection.close()


def main():
    """Main loop - read JSON commands from stdin, write JSON responses to stdout"""
    executor: Optional[SqlExecutorMock] = None

    # Send ready message
    send_message({"type": "READY"})

    try:
        for line in sys.stdin:
            try:
                command = json.loads(line)
                command_type = command.get("type")

                if command_type == "CONNECT":
                    # Note: DSN is ignored for mock mode
                    executor = SqlExecutorMock()
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
                send_message({
                    "type": "ERROR",
                    "payload": {
                        "error": f"Invalid JSON: {str(e)}"
                    }
                })
            except Exception as e:
                send_message({
                    "type": "ERROR",
                    "payload": {
                        "error": str(e),
                        "traceback": traceback.format_exc()
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
