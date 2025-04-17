declare module "web-tree-sitter" {
  interface EmscriptenModule {
    locateFile?(path: string, scriptDirectory: string): string;
    print?(text: string): void;
    printErr?(text: string): void;
    quit?(status: number, toThrow: Error): void;
    [key: string]: any;
  }

  // ... rest of your tree-sitter type definitions if needed
}
