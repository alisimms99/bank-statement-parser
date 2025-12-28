// This file must be imported FIRST before any other modules that read process.env
// It loads .env and .env.local files in the correct order

// Load .env first (dotenv/config does this)
import "dotenv/config";

// Then load .env.local (which should override .env values)
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local"), override: true });

