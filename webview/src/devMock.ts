/**
 * Development mock data for testing the webview outside of VS Code.
 * This simulates messages that would normally come from the extension.
 * 
 * Usage: Import and call initDevMock() in main.tsx when not in VS Code context.
 */

import type { ExtensionMessage } from './types';

// Sample data for testing
const sampleUsers = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com', age: 28, salary: 75000.50 },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com', age: 34, salary: 82000.00 },
  { id: 3, name: 'Carol Williams', email: 'carol@example.com', age: 29, salary: 69000.75 },
  { id: 4, name: 'David Brown', email: 'david@example.com', age: 45, salary: 95000.00 },
  { id: 5, name: 'Eva Martinez', email: 'eva@example.com', age: 31, salary: 78500.25 },
  { id: 6, name: 'Frank Lee', email: 'frank@example.com', age: 38, salary: 88000.00 },
  { id: 7, name: 'Grace Kim', email: 'grace@example.com', age: 26, salary: 65000.00 },
  { id: 8, name: 'Henry Chen', email: 'henry@example.com', age: 42, salary: 105000.50 },
];

const sampleOrders = [
  { order_id: 101, user_id: 1, product: 'Laptop', amount: 1299.99, date: '2024-01-15' },
  { order_id: 102, user_id: 2, product: 'Mouse', amount: 49.99, date: '2024-01-16' },
  { order_id: 103, user_id: 1, product: 'Keyboard', amount: 129.99, date: '2024-01-17' },
  { order_id: 104, user_id: 3, product: 'Monitor', amount: 399.99, date: '2024-01-18' },
  { order_id: 105, user_id: 4, product: 'Headphones', amount: 199.99, date: '2024-01-19' },
];

function postMockMessage(message: ExtensionMessage, delay = 0) {
  setTimeout(() => {
    window.postMessage(message, '*');
  }, delay);
}

/**
 * Simulate a complete query execution flow with multiple result sets.
 */
export function initDevMock() {
  console.log('[DEV] Initializing mock data...');

  // Simulate first query run
  const runId1 = 'run-1';
  
  postMockMessage({
    type: 'RUN_STARTED',
    payload: {
      runId: runId1,
      sql: 'SELECT * FROM users; SELECT * FROM orders WHERE user_id = 1;',
      title: 'Query 1',
      startedAt: Date.now(),
    },
  }, 500);

  // First result set: users
  postMockMessage({
    type: 'RESULT_SET_STARTED',
    payload: {
      runId: runId1,
      resultSetId: 'rs-1-1',
      title: 'users',
      statementIndex: 0,
    },
  }, 600);

  postMockMessage({
    type: 'RESULT_SET_SCHEMA',
    payload: {
      runId: runId1,
      resultSetId: 'rs-1-1',
      columns: [
        { name: 'id', type: 'number' },
        { name: 'name', type: 'string' },
        { name: 'email', type: 'string' },
        { name: 'age', type: 'number' },
        { name: 'salary', type: 'number' },
      ],
    },
  }, 700);

  postMockMessage({
    type: 'RESULT_SET_ROWS',
    payload: {
      runId: runId1,
      resultSetId: 'rs-1-1',
      rows: sampleUsers.slice(0, 4),
      append: false,
    },
  }, 800);

  // Simulate streaming more rows
  postMockMessage({
    type: 'RESULT_SET_ROWS',
    payload: {
      runId: runId1,
      resultSetId: 'rs-1-1',
      rows: sampleUsers.slice(4),
      append: true,
    },
  }, 1000);

  postMockMessage({
    type: 'RESULT_SET_COMPLETE',
    payload: {
      runId: runId1,
      resultSetId: 'rs-1-1',
      rowCount: sampleUsers.length,
      executionTimeMs: 42,
    },
  }, 1100);

  // Second result set: orders
  postMockMessage({
    type: 'RESULT_SET_STARTED',
    payload: {
      runId: runId1,
      resultSetId: 'rs-1-2',
      title: 'orders',
      statementIndex: 1,
    },
  }, 1200);

  postMockMessage({
    type: 'RESULT_SET_SCHEMA',
    payload: {
      runId: runId1,
      resultSetId: 'rs-1-2',
      columns: [
        { name: 'order_id', type: 'number' },
        { name: 'user_id', type: 'number' },
        { name: 'product', type: 'string' },
        { name: 'amount', type: 'number' },
        { name: 'date', type: 'string' },
      ],
    },
  }, 1300);

  postMockMessage({
    type: 'RESULT_SET_ROWS',
    payload: {
      runId: runId1,
      resultSetId: 'rs-1-2',
      rows: sampleOrders,
      append: false,
    },
  }, 1400);

  postMockMessage({
    type: 'RESULT_SET_COMPLETE',
    payload: {
      runId: runId1,
      resultSetId: 'rs-1-2',
      rowCount: sampleOrders.length,
      executionTimeMs: 18,
    },
  }, 1500);

  postMockMessage({
    type: 'RUN_COMPLETE',
    payload: { runId: runId1 },
  }, 1600);

  // Simulate a second query run with an error after some delay
  const runId2 = 'run-2';
  
  postMockMessage({
    type: 'RUN_STARTED',
    payload: {
      runId: runId2,
      sql: 'SELECT * FROM nonexistent_table',
      title: 'Query 2 (error)',
      startedAt: Date.now() + 3000,
    },
  }, 3000);

  postMockMessage({
    type: 'RESULT_SET_STARTED',
    payload: {
      runId: runId2,
      resultSetId: 'rs-2-1',
      title: 'Result 1',
      statementIndex: 0,
    },
  }, 3100);

  postMockMessage({
    type: 'RESULT_SET_ERROR',
    payload: {
      runId: runId2,
      resultSetId: 'rs-2-1',
      message: "ERROR: relation \"nonexistent_table\" does not exist\nLINE 1: SELECT * FROM nonexistent_table\n                      ^",
    },
  }, 3300);

  postMockMessage({
    type: 'RUN_ERROR',
    payload: {
      runId: runId2,
      message: 'Query execution failed',
    },
  }, 3400);

  console.log('[DEV] Mock data scheduled.');
}

// Export for explicit initialization from main.tsx
