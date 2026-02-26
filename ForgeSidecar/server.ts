// src/sidecar/server.ts

import { WebSocketServer, WebSocket } from "ws";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import chokidar from "chokidar";
import { parseLogLine, getInitialState, GameState } from "./app/parser.js"; // We'll move the parser logic into its own file

// --- Server State ---

// This simple state machine prevents multiple matches from running at once.
let simulationStatus: "idle" | "running" | "finished" = "idle";
let activeGameState: GameState = getInitialState(); // Get a fresh state object

// --- WebSocket Server Setup ---

const wss = new WebSocketServer({ port: 8080 });
console.log("Sidecar WebSocket server started on port 8080");

wss.on("connection", (ws) => {
  console.log("Client connected");

  // Send the current status to newly connecting clients
  ws.send(JSON.stringify({ type: "CONNECTION_ESTABLISHED", status: simulationStatus, state: activeGameState }));

  ws.on("message", (message) => {
    const messageString = message.toString();
    if (messageString === "START_MATCH") {
      if (simulationStatus === "running") {
        ws.send(JSON.stringify({ type: "ERROR", message: "A match is already in progress." }));
        return;
      }
      // Reset state and start the simulation
      activeGameState = getInitialState();
      startForgeSimulation(ws);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

// --- Forge Simulation Logic ---

function startForgeSimulation(ws: WebSocket) {
  simulationStatus = "running";

  // Use a generic log file name. Forge will create this.
  const logFileName = "gamelog.txt";
  const logFilePath = path.join(process.cwd(), logFileName);

  // Announce the start to all clients
  broadcast({ type: "SIMULATION_STARTING" });

  // Clean up any old log file before starting
  if (fs.existsSync(logFilePath)) {
    fs.unlinkSync(logFilePath);
  }

  // TODO: Replace with dynamic decks from the database/matchmaking logic
  const deck1 = "creeps-deck.dck";
  const deck2 = "ninja-deck.dck";
  const aiProfile1 = "Control";
  const aiProfile2 = "Aggro";

  const forgeProcess = spawn("java", [
    "-jar",
    "forgeSim.jar",
    "sim",
    "-d", deck1, deck2,
    "-a", aiProfile1, aiProfile2, // The custom flag from Step 1
    "-l", logFileName, // Explicitly tell Forge to use this log file
    "-n", "1", // Number of games
  ]);

  // Use chokidar to watch the log file for appends
  const watcher = chokidar.watch(logFilePath, {
    persistent: true,
    usePolling: true, // Necessary for some container/filesystem environments
    interval: 100, // Poll every 100ms
  });

  console.log(`Watching for log file at: ${logFilePath}`);

  // We need to handle reading the file content when it changes
  let lastSize = 0;
  watcher.on("change", (path) => {
      fs.stat(path, (err, stats) => {
          if (err) {
              console.error("Error stating file:", err);
              return;
          }
          if (stats.size > lastSize) {
              const stream = fs.createReadStream(path, { start: lastSize, end: stats.size, encoding: 'utf8' });
              stream.on('data', (chunk) => processLogChunk(chunk.toString()));
              lastSize = stats.size;
          }
      });
  });

  const processLogChunk = (chunk: string) => {
    const lines = chunk.split('\n').filter(line => line.trim() !== '');
    for (const line of lines) {
      console.log(`[RAW LOG]: ${line}`); // Helpful for debugging
      const updatedState = parseLogLine(line, activeGameState);
      if (updatedState) {
        activeGameState = updatedState;
        broadcast({ type: "STATE_UPDATE", state: activeGameState });
      }
    }
  };

  forgeProcess.on("close", (code) => {
    console.log(`Forge process exited with code ${code}`);
    simulationStatus = "finished";
    broadcast({ type: "SIMULATION_COMPLETE", finalState: activeGameState });
    watcher.close(); // Stop watching the file
  });

  forgeProcess.stderr.on('data', (data) => {
    console.error(`Forge STDERR: ${data}`);
    broadcast({ type: "ERROR", message: `Forge Error: ${data}` });
  });
}

// --- Helper to Broadcast to All Connected Clients ---

function broadcast(data: object) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}


