#!/usr/bin/env node
import net from "node:net";

const [host = "127.0.0.1", portArg, serviceName = "Service"] = process.argv.slice(2);

if (!portArg) {
  console.error("Usage: node scripts/assert-port-free.mjs <host> <port> [service-name]");
  process.exit(2);
}

const port = Number(portArg);
if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  console.error("port must be an integer between 1 and 65535");
  process.exit(2);
}

const server = net.createServer();

server.once("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `${serviceName} port ${host}:${port} is already in use; stop the existing process or run make dev-clean.`
    );
    process.exit(1);
  }
  console.error(`${serviceName} port ${host}:${port} is not available: ${error.message}`);
  process.exit(1);
});

server.listen({ host, port }, () => {
  server.close(() => {
    process.exit(0);
  });
});
