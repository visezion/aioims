// @ts-nocheck
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendPort = 8001;
const backendHost = '127.0.0.1';

function backendIsHealthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get({ hostname: backendHost, port: backendPort, path: '/health', timeout: 1200 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

function backendLauncherPlugin() {
  return {
    name: 'aims-backend-launcher',
    configureServer(server) {
      server.middlewares.use('/__aims/start-backend', async (_request, response) => {
        response.setHeader('Content-Type', 'application/json');
        if (await backendIsHealthy()) {
          response.end(JSON.stringify({ ok: true, status: 'running', message: 'Backend is already running.' }));
          return;
        }

        const root = process.cwd();
        const python = path.join(root, '.venv', 'Scripts', process.platform === 'win32' ? 'python.exe' : 'python');
        const backendDir = path.join(root, 'python_backend');
        const child = spawn(python, ['server.py', '--port', String(backendPort)], {
          cwd: backendDir,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
        response.end(JSON.stringify({ ok: true, status: 'starting', message: 'Backend start requested.' }));
      });
    },
  };
}

export default defineConfig({ plugins: [react(), backendLauncherPlugin()] });
