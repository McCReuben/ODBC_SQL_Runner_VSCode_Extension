/**
 * Manages Python child processes for SQL execution
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

export interface PythonMessage {
  type: string;
  payload?: any;
}

export interface ExecuteRequest {
  sql: string;
  resultSetId: string;
}

export interface ExecuteResult {
  success: boolean;
  resultSetId: string;
  hasResults?: boolean;
  columns?: Array<{ name: string; type: string }>;
  rows?: any[];
  rowCount?: number;
  executionTimeMs?: number;
  error?: string;
  message?: string;
  traceback?: string;
}

export class PythonRunner {
  private process: ChildProcess | null = null;
  private messageHandlers: Map<string, (message: PythonMessage) => void> = new Map();
  private outputBuffer = '';
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolver!: () => void;

  constructor(
    private pythonPath: string,
    private scriptPath: string
  ) {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolver = resolve;
    });
  }

  async start(dsn: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Spawn the Python process
        this.process = spawn(this.pythonPath, [this.scriptPath], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        // Handle stdout (JSON messages)
        this.process.stdout?.on('data', (data: Buffer) => {
          this.handleStdout(data);
        });

        // Handle stderr (logs/errors)
        this.process.stderr?.on('data', (data: Buffer) => {
          console.error('[Python stderr]:', data.toString());
        });

        // Handle process exit
        this.process.on('exit', (code) => {
          console.log(`Python process exited with code ${code}`);
          this.isReady = false;
        });

        // Handle process errors
        this.process.on('error', (error) => {
          console.error('Python process error:', error);
          reject(error);
        });

        // Wait for ready message
        this.readyPromise.then(() => {
          // Send connect command
          this.sendCommand({ type: 'CONNECT', dsn })
            .then((result) => {
              if (result.payload?.success) {
                resolve();
              } else {
                reject(new Error(result.payload?.error || 'Connection failed'));
              }
            })
            .catch(reject);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  private handleStdout(data: Buffer) {
    this.outputBuffer += data.toString();

    // Process complete JSON messages (line by line)
    let newlineIndex: number;
    while ((newlineIndex = this.outputBuffer.indexOf('\n')) !== -1) {
      const line = this.outputBuffer.substring(0, newlineIndex).trim();
      this.outputBuffer = this.outputBuffer.substring(newlineIndex + 1);

      if (line.length === 0) {
        continue;
      }

      try {
        const message: PythonMessage = JSON.parse(line);
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse JSON from Python:', line, error);
      }
    }
  }

  private handleMessage(message: PythonMessage) {
    // Handle READY message
    if (message.type === 'READY') {
      this.isReady = true;
      this.readyResolver();
      return;
    }

    // Call registered handler
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler(message);
      this.messageHandlers.delete(message.type);
    }
  }

  private sendCommand(command: any): Promise<PythonMessage> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        reject(new Error('Python process not started'));
        return;
      }

      // Determine expected response type
      let responseType: string;
      switch (command.type) {
        case 'CONNECT':
          responseType = 'CONNECT_RESULT';
          break;
        case 'EXECUTE':
          responseType = 'EXECUTE_RESULT';
          break;
        case 'CLOSE':
          responseType = 'CLOSE_RESULT';
          break;
        default:
          responseType = 'ERROR';
      }

      // Register handler for response
      this.messageHandlers.set(responseType, (message) => {
        resolve(message);
      });

      // Send command
      try {
        this.process.stdin.write(JSON.stringify(command) + '\n');
      } catch (error) {
        this.messageHandlers.delete(responseType);
        reject(error);
      }
    });
  }

  async executeQuery(sql: string, resultSetId: string): Promise<ExecuteResult> {
    await this.readyPromise;

    const response = await this.sendCommand({
      type: 'EXECUTE',
      sql,
      resultSetId
    });

    return response.payload as ExecuteResult;
  }

  async close(): Promise<void> {
    if (this.process) {
      await this.sendCommand({ type: 'CLOSE' });
      this.process.kill();
      this.process = null;
    }
  }

  isRunning(): boolean {
    return this.process !== null && this.isReady;
  }
}

/**
 * Manages Python sessions per file
 */
export class SessionManager {
  private sessions: Map<string, PythonRunner> = new Map();
  private extensionPath: string;

  constructor(private context: vscode.ExtensionContext) {
    this.extensionPath = context.extensionPath;
  }

  async getOrCreateSession(fileUri: string): Promise<PythonRunner> {
    // Check if session already exists
    let session = this.sessions.get(fileUri);

    if (session && session.isRunning()) {
      return session;
    }

    // Create new session
    const config = vscode.workspace.getConfiguration('sqlRunner');
    const pythonPath = config.get<string>('pythonPath', 'python3');
    const dsn = config.get<string>('odbcDsn', 'Hermes');

    const scriptPath = path.join(this.extensionPath, 'python', 'sql_executor.py');

    session = new PythonRunner(pythonPath, scriptPath);

    try {
      await session.start(dsn);
      this.sessions.set(fileUri, session);
      return session;
    } catch (error) {
      throw new Error(`Failed to start Python session: ${error}`);
    }
  }

  async closeSession(fileUri: string): Promise<void> {
    const session = this.sessions.get(fileUri);
    if (session) {
      await session.close();
      this.sessions.delete(fileUri);
    }
  }

  async closeAllSessions(): Promise<void> {
    const promises = Array.from(this.sessions.values()).map(session => session.close());
    await Promise.all(promises);
    this.sessions.clear();
  }
}
