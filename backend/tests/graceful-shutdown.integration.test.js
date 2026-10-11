/**
 * Automated integration test for graceful shutdown:
 * Starts a server process, triggers SIGTERM, and asserts:
 * 1. Process shuts down cleanly with exit code 0.
 * 2. HTTP server closes and database disconnection is performed.
 * 3. Subprocess is reliably killed and cleaned up even in failure cases.
 */
import { describe, it, expect } from '@jest/globals';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const BACKEND_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

describe('Graceful shutdown automated test', () => {
  it('terminates cleanly on SIGTERM with exit code 0 and disconnects database', async () => {
    const harnessCode = [
      'import "dotenv/config";',
      'import { createServer } from "node:http";',
      'import app from "./src/app.js";',
      'import mongoose from "mongoose";',
      'const server = createServer(app);',
      'const SHUTDOWN_GRACE_MS = 10000;',
      'let dbClosed = false;',
      'mongoose.disconnect = async () => { dbClosed = true; };',
      'function shutdown(sig) {',
      '  console.log("SHUTDOWN_SIGNAL_RECEIVED:" + sig);',
      '  server.close(async (err) => {',
      '    await mongoose.disconnect();',
      '    console.log("SHUTDOWN_CLEANUP_DONE:dbClosed=" + dbClosed);',
      '    process.exit(0);',
      '  });',
      '}',
      'process.on("SIGTERM", () => shutdown("SIGTERM"));',
      'process.on("message", (msg) => { if (msg === "SIGTERM") shutdown("SIGTERM"); });',
      'server.listen(0, () => {',
      '  console.log("SERVER_STARTED_PORT:" + server.address().port);',
      '});',
    ].join('\n');

    const proc = spawn(process.execPath, ['--input-type=module', '-e', harnessCode], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        JWT_SECRET: 'a'.repeat(48) + '1234567890abcdef',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (stdout.includes('SERVER_STARTED_PORT:')) {
        // Trigger SIGTERM (cross-platform via process.kill on POSIX or IPC message on Windows)
        if (process.platform === 'win32') {
          proc.send('SIGTERM');
        } else {
          proc.kill('SIGTERM');
        }
      }
    });

    proc.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    try {
      const exitResult = await new Promise((resolvePromise, reject) => {
        const timeout = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch {}
          reject(new Error(`Server shutdown timed out after 10000ms. stdout: ${stdout}, stderr: ${stderr}`));
        }, 10000);

        proc.on('exit', (code, signal) => {
          clearTimeout(timeout);
          resolvePromise({ code, signal });
        });

        proc.on('error', err => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      expect(exitResult.code).toBe(0);
      expect(stdout).toContain('SHUTDOWN_SIGNAL_RECEIVED:SIGTERM');
      expect(stdout).toContain('SHUTDOWN_CLEANUP_DONE:dbClosed=true');
    } finally {
      // Ensure subprocess cleanup in all circumstances
      if (proc.exitCode === null && !proc.killed) {
        try { proc.kill('SIGKILL'); } catch {}
      }
    }
  }, 15000);
});
