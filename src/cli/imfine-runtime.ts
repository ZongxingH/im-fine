#!/usr/bin/env node
import { runCli } from "../core/cli.js";

await runCli("imfine-runtime", process.argv.slice(2));
