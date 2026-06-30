import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import fs from "fs";

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let backendProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

const BACKEND_PORT = process.env.BACKEND_PORT || "3001";

const __dirname = import.meta.dirname;

function getBackendPath(): string {
  if (isDev) {
    return path.resolve(__dirname, "../../backend/src/index.ts");
  }
  // In production, the backend should be bundled next to the Electron binary.
  return path.join(process.resourcesPath, "backend", "dist", "index.js");
}

function startBackend(): void {
  const backendPath = getBackendPath();
  if (!fs.existsSync(backendPath)) {
    console.error(`Backend not found at ${backendPath}`);
    return;
  }

  const env = {
    ...process.env,
    BACKEND_PORT,
    NODE_ENV: isDev ? "development" : "production",
  };

  if (isDev) {
    backendProcess = spawn("npx", ["tsx", "watch", backendPath], {
      env,
      cwd: path.resolve(__dirname, "../.."),
      stdio: "inherit",
    });
  } else {
    backendProcess = spawn(process.execPath, [backendPath], {
      env,
      stdio: "inherit",
    });
  }

  backendProcess.on("error", (err) => {
    console.error("Backend failed to start:", err);
  });

  backendProcess.on("exit", (code) => {
    console.log(`Backend exited with code ${code}`);
    backendProcess = null;
  });
}

function stopBackend(): void {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Tardigrade",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopBackend();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopBackend();
});

// IPC handlers
ipcMain.handle("get-backend-url", () => {
  return `http://localhost:${BACKEND_PORT}`;
});

ipcMain.handle("open-external", (_event, url: string) => {
  shell.openExternal(url);
});

ipcMain.handle("get-platform", () => {
  return process.platform;
});
