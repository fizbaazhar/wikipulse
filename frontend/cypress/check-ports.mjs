// Run before `npm run e2e`: the tests need a fresh back end and dashboard on
// these ports. start-server-and-test only waits for the URLs to answer, so a
// server left over from an earlier run would be used silently, with stale data.
import net from "node:net";

const PORTS = { 8001: "e2e back end", 5174: "e2e dashboard" };

function isFreeOn(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => resolve(err.code === "EADDRNOTAVAIL")); // no IPv6 here: nothing to clash with
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

// Vite listens on "localhost", which may be IPv4 or IPv6, so check both.
async function isFree(port) {
  return (await isFreeOn(port, "127.0.0.1")) && (await isFreeOn(port, "::1"));
}

const busy = [];
for (const [port, name] of Object.entries(PORTS)) {
  if (!(await isFree(Number(port)))) busy.push(`${port} (${name})`);
}
if (busy.length) {
  console.error(`Port already in use: ${busy.join(", ")}.`);
  console.error("Stop the server left over from an earlier e2e run (e.g. close the Cypress window), then try again.");
  process.exit(1);
}
