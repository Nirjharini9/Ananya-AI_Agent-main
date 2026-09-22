/**
 * Ananya System Agent Server
 * Grants Ananya the ability to perform Windows system tasks:
 * - Open applications
 * - Create files and folders
 * - Search for files
 * - Run safe PowerShell commands
 * - Get system information
 * 
 * Launch: node system-agent.js
 * Listens on port 3002
 */

import express from "express";
import cors from "cors";
import { exec } from "child_process";
import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";

const app = express();
const PORT = 3002;

app.use(cors({ origin: "*" }));
app.use(express.json());

let lastActionStatus = "Standing by...";
let logsList = [];

function log(message, type = "info") {
  const timestamp = new Date().toLocaleTimeString();
  const entry = { id: Math.random().toString(), text: `[${timestamp}] ${message}`, type };
  console.log(`[${type.toUpperCase()}] ${message}`);
  logsList.push(entry);
  if (logsList.length > 50) logsList.shift();
  lastActionStatus = message;
}

// Safety: block dangerous commands
const BLOCKED_PATTERNS = [
  /\brm\s+(-rf|-r)\b/i,
  /\bformat\b/i,
  /\bdel\s+\/s/i,
  /\bshutdown\b/i,
  /\brestart\b/i,
  /\brmdir\s+\/s/i,
  /\bRemove-Item\s+.*-Recurse.*-Force/i,
  /\breg\s+delete/i,
  /\bdiskpart\b/i,
  /\bcmd\s+\/c\s+.*del/i,
  /\bStop-Computer\b/i,
  /\bRestart-Computer\b/i,
  /\bclear-recyclebin/i,
  /\bSet-ExecutionPolicy\b/i,
  /\bInvoke-WebRequest.*\|\s*iex/i,
  /\bNew-Service\b/i,
];

function isCommandSafe(cmd) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return false;
    }
  }
  return true;
}

// Run a command in PowerShell and return output
function runPowershell(command, timeout = 15000) {
  return new Promise((resolve, reject) => {
    exec(`powershell.exe -NoProfile -Command "${command.replace(/"/g, '\\"')}"`, {
      timeout,
      maxBuffer: 1024 * 512,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error && error.killed) {
        reject(new Error("Command timed out after " + (timeout / 1000) + " seconds."));
      } else if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// Well-known app name to executable mappings
const APP_MAPPINGS = {
  "notepad": "notepad.exe",
  "calculator": "calc.exe",
  "paint": "mspaint.exe",
  "wordpad": "wordpad.exe",
  "snipping tool": "SnippingTool.exe",
  "task manager": "taskmgr.exe",
  "file explorer": "explorer.exe",
  "explorer": "explorer.exe",
  "command prompt": "cmd.exe",
  "cmd": "cmd.exe",
  "powershell": "powershell.exe",
  "terminal": "wt.exe",
  "control panel": "control.exe",
  "settings": "ms-settings:",
  "chrome": "chrome.exe",
  "google chrome": "chrome.exe",
  "edge": "msedge.exe",
  "microsoft edge": "msedge.exe",
  "firefox": "firefox.exe",
  "brave": "brave.exe",
  "vscode": "code",
  "vs code": "code",
  "visual studio code": "code",
  "spotify": "spotify.exe",
  "discord": "discord.exe",
  "telegram": "telegram.exe",
  "whatsapp": "WhatsApp.exe",
  "vlc": "vlc.exe",
  "obs": "obs64.exe",
  "zoom": "zoom.exe",
  "teams": "ms-teams.exe",
  "microsoft teams": "ms-teams.exe",
  "word": "winword.exe",
  "excel": "excel.exe",
  "powerpoint": "powerpnt.exe",
  "outlook": "outlook.exe",
};

// Status endpoint
app.get("/api/status", (req, res) => {
  res.json({
    connected: true,
    lastAction: lastActionStatus,
    logs: logsList
  });
});

// Main action endpoint
app.post("/api/action", async (req, res) => {
  const { type, args } = req.body;
  if (!type) {
    return res.status(400).json({ error: "Missing 'type' parameter." });
  }

  log(`System action received: ${type}`, "action");

  try {
    switch (type) {

      case "systemOpenApp": {
        const appName = (args.appName || args.name || "").toLowerCase().trim();
        if (!appName) throw new Error("Application name is required.");

        log(`Opening application: "${appName}"`, "info");

        // Check known mappings first
        const mapped = APP_MAPPINGS[appName];
        if (mapped) {
          if (mapped.startsWith("ms-")) {
            // URI-based launch (Settings, Teams, etc.)
            await runPowershell(`Start-Process "${mapped}"`);
          } else {
            await runPowershell(`Start-Process "${mapped}"`);
          }
          log(`Launched ${appName} successfully.`, "success");
          return res.json({ result: `Opened ${appName} for you!` });
        }

        // Try direct Start-Process with the name
        try {
          await runPowershell(`Start-Process "${appName}"`);
          log(`Launched ${appName} successfully.`, "success");
          return res.json({ result: `Opened ${appName} for you!` });
        } catch (e) {
          // Try searching in Start Menu
          try {
            const searchResult = await runPowershell(
              `Get-ChildItem -Path "$env:ProgramData\\Microsoft\\Windows\\Start Menu", "$env:APPDATA\\Microsoft\\Windows\\Start Menu" -Recurse -Filter "*.lnk" | Where-Object { $_.BaseName -match '${appName}' } | Select-Object -First 1 -ExpandProperty FullName`
            );
            if (searchResult) {
              await runPowershell(`Start-Process "${searchResult}"`);
              log(`Found and launched ${appName} via Start Menu.`, "success");
              return res.json({ result: `Found and opened ${appName}!` });
            }
          } catch (e2) {}
          throw new Error(`Could not find application "${appName}" on this system.`);
        }
      }

      case "systemCreateFile": {
        let filePath = args.path || args.filePath || "";
        const content = args.content || "";
        const fileName = args.fileName || args.name || "";

        if (!filePath && fileName) {
          // Default to Desktop
          filePath = join(homedir(), "Desktop", fileName);
        }
        if (!filePath) throw new Error("File path or name is required.");

        log(`Creating file: ${filePath}`, "info");
        
        // Ensure parent directory exists
        const parentDir = filePath.substring(0, filePath.lastIndexOf("\\") || filePath.lastIndexOf("/"));
        if (parentDir) {
          await fs.mkdir(parentDir, { recursive: true });
        }

        await fs.writeFile(filePath, content, "utf-8");
        log(`File created: ${filePath}`, "success");
        return res.json({ result: `Created file at ${filePath}${content ? " with your content" : ""}.` });
      }

      case "systemCreateFolder": {
        let folderPath = args.path || args.folderPath || "";
        const folderName = args.folderName || args.name || "";

        if (!folderPath && folderName) {
          folderPath = join(homedir(), "Desktop", folderName);
        }
        if (!folderPath) throw new Error("Folder path or name is required.");

        log(`Creating folder: ${folderPath}`, "info");
        await fs.mkdir(folderPath, { recursive: true });
        log(`Folder created: ${folderPath}`, "success");
        return res.json({ result: `Created folder at ${folderPath}.` });
      }

      case "systemSearch": {
        const query = args.query || args.name || "";
        const searchPath = args.path || homedir();
        if (!query) throw new Error("Search query is required.");

        log(`Searching for "${query}" in ${searchPath}`, "info");

        const results = await runPowershell(
          `Get-ChildItem -Path "${searchPath}" -Recurse -Filter "*${query}*" -ErrorAction SilentlyContinue | Select-Object -First 10 FullName, Length, LastWriteTime | Format-Table -AutoSize | Out-String`,
          20000
        );

        log(`Search completed for "${query}".`, "success");
        return res.json({
          result: results
            ? `Found these matches for "${query}":\n${results}`
            : `No files matching "${query}" found in ${searchPath}.`
        });
      }

      case "systemRunCommand": {
        const command = args.command || args.cmd || "";
        if (!command) throw new Error("Command is required.");

        if (!isCommandSafe(command)) {
          log(`BLOCKED dangerous command: ${command}`, "error");
          return res.status(403).json({
            error: `This command was blocked for safety: "${command}". Dangerous operations like delete, format, shutdown are not allowed.`
          });
        }

        log(`Running command: ${command}`, "info");
        const output = await runPowershell(command, 30000);
        log(`Command completed successfully.`, "success");
        return res.json({ result: output || "Command executed successfully (no output)." });
      }

      case "systemInfo": {
        const infoType = (args.type || args.info || "general").toLowerCase();
        log(`Getting system info: ${infoType}`, "info");

        let result = "";

        if (infoType === "battery" || infoType === "general") {
          try {
            const battery = await runPowershell(
              `(Get-WmiObject Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus) | Format-List | Out-String`
            );
            result += `Battery:\n${battery || "No battery detected (desktop PC)."}\n`;
          } catch (e) {
            result += "Battery: Not available\n";
          }
        }

        if (infoType === "disk" || infoType === "storage" || infoType === "general") {
          const disk = await runPowershell(
            `Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N='Used(GB)';E={[math]::Round($_.Used/1GB,1)}}, @{N='Free(GB)';E={[math]::Round($_.Free/1GB,1)}} | Format-Table -AutoSize | Out-String`
          );
          result += `Disk:\n${disk}\n`;
        }

        if (infoType === "memory" || infoType === "ram" || infoType === "general") {
          const mem = await runPowershell(
            `$os = Get-CimInstance Win32_OperatingSystem; $total = [math]::Round($os.TotalVisibleMemorySize/1MB,1); $free = [math]::Round($os.FreePhysicalMemory/1MB,1); $used = $total - $free; Write-Output "Total: $($total)GB, Used: $($used)GB, Free: $($free)GB"`
          );
          result += `Memory:\n${mem}\n`;
        }

        if (infoType === "cpu" || infoType === "processor" || infoType === "general") {
          const cpu = await runPowershell(
            `(Get-CimInstance Win32_Processor).Name`
          );
          result += `CPU: ${cpu}\n`;
        }

        if (infoType === "os" || infoType === "general") {
          const os = await runPowershell(
            `(Get-CimInstance Win32_OperatingSystem).Caption + ' ' + (Get-CimInstance Win32_OperatingSystem).Version`
          );
          result += `OS: ${os}\n`;
        }

        log(`System info retrieved.`, "success");
        return res.json({ result: result.trim() });
      }

      default:
        throw new Error(`Unknown system action: "${type}".`);
    }
  } catch (err) {
    log(`Error: ${err.message}`, "error");
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n======================================================`);
  console.log(`🖥️  Ananya System Agent Server Running!`);
  console.log(`📡 Listening on: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
