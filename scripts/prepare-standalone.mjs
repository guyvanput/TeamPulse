import { cpSync } from "node:fs";
import { join } from "node:path";

cpSync(join(".next", "static"), join(".next", "standalone", ".next", "static"), { recursive: true });
