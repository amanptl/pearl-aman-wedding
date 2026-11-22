// Load the vendored SheetJS mini build in Node (for Playwright fixtures).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let cached;

export function loadXlsx() {
  if (cached) return cached;
  const code = fs.readFileSync(path.join(root, "vendor/xlsx.mini.min.js"), "utf8");
  const sandbox = {
    console,
    Array, Object, String, Number, Boolean, Math, Date, Error, TypeError, RegExp, JSON,
    parseInt, parseFloat, isNaN, isFinite,
    Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array,
    ArrayBuffer, DataView, Map, Set, Promise, TextEncoder, TextDecoder, Buffer,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  cached = sandbox.XLSX;
  if (!cached?.utils) throw new Error("SheetJS did not initialise");
  return cached;
}

/** Build an .xlsx Buffer from named sheets of 2D arrays. */
export function workbookBuffer(sheets) {
  const XLSX = loadXlsx();
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return Buffer.from(XLSX.write(wb, { bookType: "xlsx", type: "buffer" }));
}
