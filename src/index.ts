#!/usr/bin/env node

import { runServer, runHttpServer } from "./server.js";

const args = process.argv.slice(2);
const httpMode = args.includes("--http");
const portFlag = args.find((a) => a.startsWith("--port="));
const port = portFlag ? parseInt(portFlag.split("=")[1], 10) : 3000;

const start = httpMode ? () => runHttpServer(port) : runServer;

start().catch((error) => {
  console.error("Failed to start Haiku MCP server:", error);
  process.exit(1);
});
