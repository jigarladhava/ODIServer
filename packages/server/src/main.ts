import { startOdiServer } from "./index.js";

const handle = await startOdiServer();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    handle
      .stop()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
