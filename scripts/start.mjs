const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1]))) {
  throw new Error("Usage: npm start -- [--port PORT]");
}
const port = Number(args[1] ?? process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
process.env.PORT = String(port);
process.env.HOSTNAME = process.env.TEAMPULSE_HOST ?? "127.0.0.1";
await import("../.next/standalone/server.js");
