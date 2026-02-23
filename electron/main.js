import { app, BrowserWindow, nativeImage } from "electron";
import { createServer } from "net";
import path from "path";
import { pathToFileURL } from "url";

// Fix PATH for packaged app — macOS Finder launches with minimal PATH (/usr/bin:/bin)
if (process.platform === "darwin") {
  const extra = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/local/sbin"];
  process.env.PATH = [process.env.PATH, ...extra].join(":");
} else if (process.platform === "win32") {
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const appData = process.env.APPDATA || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  const extra = [
    path.join(pf, "nodejs"),
    appData ? path.join(appData, "npm") : "",
    localAppData ? path.join(localAppData, "Programs", "nodejs") : "",
  ].filter(Boolean);
  process.env.PATH = [process.env.PATH, ...extra].join(";");
} else if (process.platform === "linux") {
  const extra = ["/usr/local/bin"];
  process.env.PATH = [process.env.PATH, ...extra].join(":");
}

const ROOT = app.getAppPath();
const ICON_FILE =
  process.platform === "win32" ? "icon.ico" :
  process.platform === "darwin" ? "icon.icns" : "icon.png";
const ICON = nativeImage.createFromPath(path.join(ROOT, "build", ICON_FILE));

function findAvailablePort(preferred) {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(preferred, () => {
      srv.close(() => resolve(preferred));
    });
    srv.on("error", () => {
      const srv2 = createServer();
      srv2.listen(0, () => {
        const addr = srv2.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        srv2.close(() => (port ? resolve(port) : reject(new Error("No port available"))));
      });
    });
  });
}

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      fetch(url)
        .then((res) => {
          if (res.ok) resolve();
          else retry();
        })
        .catch(retry);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Server failed to start within timeout"));
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

const LOADING_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head><style>
  body { margin:0; background:#09090b; color:#a1a1aa; display:flex;
         align-items:center; justify-content:center; height:100vh;
         font-family:system-ui,sans-serif; -webkit-app-region:drag; }
  .loader { text-align:center; }
  .spinner { width:32px; height:32px; border:3px solid #27272a;
             border-top-color:#a1a1aa; border-radius:50%;
             animation:spin 0.8s linear infinite; margin:0 auto 16px; }
  @keyframes spin { to { transform:rotate(360deg) } }
</style></head>
<body><div class="loader">
  <div class="spinner"></div>
  <div>Starting KlustrEye...</div>
</div></body>
</html>
`)}`;

let mainWindow = null;
let server = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#09090b",
    icon: ICON,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Show loading screen immediately
  mainWindow.loadURL(LOADING_HTML);
  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Show window with loading screen right away
  createWindow();

  // Set CWD to app root so Next.js can find .next/ and other files
  process.chdir(ROOT);

  // Set database path to user data directory
  const dbPath = path.join(app.getPath("userData"), "klustreye.db");
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.NODE_ENV = "production";
  process.env.NEXT_TELEMETRY_DISABLED = "1";

  // Database tables are created automatically via src/instrumentation.ts
  // (Next.js register hook) using CREATE TABLE IF NOT EXISTS statements,
  // so no external Prisma CLI dependency is needed in the packaged app.

  // Find available port and start server
  const port = await findAvailablePort(3000);

  try {
    // Import pre-compiled server bundle (built by esbuild in electron:dev/make)
    const { startServer } = await import(pathToFileURL(path.join(ROOT, "server.bundle.mjs")).href);
    server = await startServer({ dev: false, port, dir: ROOT });

    // Wait until the server actually responds before navigating
    const url = `http://localhost:${port}`;
    await waitForServer(url);
    mainWindow?.loadURL(url);
  } catch (err) {
    console.error("Server start failed:", err);
    mainWindow?.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`
        <!DOCTYPE html><html><head><style>
          body{margin:0;background:#09090b;color:#ef4444;display:flex;
          align-items:center;justify-content:center;height:100vh;
          font-family:system-ui,sans-serif;}
          pre{white-space:pre-wrap;max-width:600px;}
        </style></head><body><pre>Failed to start server:\n${err?.message || err}</pre></body></html>
      `)}`
    );
  }
});

app.on("window-all-closed", () => {
  if (server) {
    server.close();
  }
  app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
    const addr = server?.address();
    const port = typeof addr === "object" && addr ? addr.port : 3000;
    if (server) {
      mainWindow?.loadURL(`http://localhost:${port}`);
    }
  }
});
