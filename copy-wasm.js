const fs = require("fs");
const path = require("path");

// Create directory if it doesn't exist
if (!fs.existsSync("./dist")) {
  fs.mkdirSync("./dist", { recursive: true });
}

// Copy main tree-sitter WASM file
fs.copyFileSync(
  "./node_modules/web-tree-sitter/tree-sitter.wasm",
  "./dist/tree-sitter.wasm",
);

// Copy language-specific WASM file
if (fs.existsSync("./wasm/tree-sitter-move.wasm")) {
  fs.copyFileSync(
    "./wasm/tree-sitter-move.wasm",
    "./dist/tree-sitter-move.wasm",
  );
} else {
  console.error("Language WASM file not found!");
}

console.log("WASM files copied to dist directory");
