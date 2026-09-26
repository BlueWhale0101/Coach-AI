import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
await rm(resolve(root, "dist"), { recursive: true, force: true });
await cp(resolve(root, "tablet-board"), resolve(root, "dist"), { recursive: true });
