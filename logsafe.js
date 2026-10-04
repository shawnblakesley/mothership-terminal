// Imported first by server.js: from then on every console line is redacted
// (redact.js), so an LLM key can never end up in the server's logs.
import { guardConsole } from "./redact.js";
guardConsole();
