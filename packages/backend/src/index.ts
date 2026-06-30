import { startServer } from "./server.js";
import { getDb } from "./db/store.js";

// Ensure DB is initialized on startup.
getDb();

startServer();
