import * as vscode from "vscode";
import { FunctionParam, MoveFunction } from "../panels/FunctionsView";
import { MoveStruct, StructField } from "../panels/StructsView";

export function extractFunctionsFromFile(data?: string): MoveFunction[] {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return [];
  }

  const text = data ? data : editor.document.getText();

  // First, split the text by functions to better handle nested braces
  const functionBlocks = splitFunctionBlocks(text);
  const functions: MoveFunction[] = [];

  for (const block of functionBlocks) {
    // Skip test functions
    if (block.includes("#[test]")) {
      continue;
    }

    // Extract the function signature and details first
    const signatureMatch = block.match(
      /(?:public\(package\)|public|entry|private)?\s*fun\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/,
    );

    if (!signatureMatch) {
      continue; // Not a valid function, skip
    }

    const fullSignature = signatureMatch[0];
    const name = signatureMatch[1];
    const paramsText = signatureMatch[2].trim();
    const returns = signatureMatch[3] ? signatureMatch[3].trim() : "";

    // Determine function type with support for public(package)
    let type = "private"; // Default is private
    if (fullSignature.includes("public(package)")) {
      type = "public(package)";
    } else if (fullSignature.includes("public")) {
      type = "public";
    } else if (fullSignature.includes("entry")) {
      type = "entry";
    }

    // Extract the comment block that appears right before the function signature
    const commentRegex =
      /\/\*\s*([\s\S]*?)\s*\*\/\s*(?:public\(package\)|public|entry|private)?\s*fun\s+\w+/;
    const commentMatch = block.match(commentRegex);

    let description = "";
    let paramDocMap = new Map();
    let returnDoc = "";

    if (commentMatch) {
      const commentContent = commentMatch[1];
      const commentLines = commentContent.split("\n");

      // The first non-empty line is the main description
      for (const line of commentLines) {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith("@")) {
          description = trimmedLine;
          break;
        }
      }

      // Extract @param documentation
      const paramRegex = /@param\s+(\w+)(?:\s*-\s*(.+))?/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(commentContent)) !== null) {
        const paramName = paramMatch[1];
        const paramDesc = paramMatch[2] ? paramMatch[2].trim() : "";
        paramDocMap.set(paramName, paramDesc);
      }

      // Extract @return documentation
      const returnMatch = commentContent.match(/@return\s*-\s*(.+)/);
      if (returnMatch) {
        returnDoc = returnMatch[1].trim();
      }
    }

    // Extract function body
    const bodyStartIndex = block.indexOf("{") + 1;
    let bodyEndIndex = block.lastIndexOf("}");

    // Handle nested braces in function body
    let openBraces = 1;
    let i = bodyStartIndex;
    while (i < block.length && openBraces > 0) {
      if (block[i] === "{") {
        openBraces++;
      } else if (block[i] === "}") {
        openBraces--;
      }
      i++;
    }
    if (openBraces === 0) {
      bodyEndIndex = i - 1;
    }

    const body = block.substring(bodyStartIndex, bodyEndIndex).trim();

    // Parse parameters from function signature
    const params: FunctionParam[] =
      paramsText !== ""
        ? paramsText.split(",").map((param) => {
            const parts = param.split(":").map((s) => s.trim());
            const paramName = parts[0];
            const paramType = parts.length > 1 ? parts[1] : "";
            const paramDesc = paramDocMap.get(paramName) || "";

            return {
              name: paramName,
              type: paramType,
              description: paramDesc,
            };
          })
        : [];

    functions.push({
      name,
      type,
      description,
      params,
      returns,
      body,
    });
  }

  return functions;
}

/**
 * Split the file content into function blocks, properly handling nested braces
 * and comment blocks above functions
 */
// function splitFunctionBlocks(text: string): string[] {
//   const functionBlocks: string[] = [];
//   const functionStartRegex =
//     /(?:#\[.*\]\s*\n)?\s*(?:public\(package\)|public|entry|private)?\s*fun\s+\w+\s*\(/g;

//   let match;
//   while ((match = functionStartRegex.exec(text)) !== null) {
//     const startIndex = match.index;

//     // Find the function body by balancing braces
//     let openBraces = 0;
//     let closeBraces = 0;
//     let foundOpeningBrace = false;
//     let endIndex = startIndex;

//     for (let i = startIndex; i < text.length; i++) {
//       if (text[i] === "{") {
//         foundOpeningBrace = true;
//         {openBraces++};
//       } else if (text[i] === "}") {
//         closeBraces++;
//       }

//       if (foundOpeningBrace && openBraces === closeBraces) {
//         endIndex = i + 1;
//         break;
//       }
//     }

//     // Get complete function including any attributes/comments before it
//     // Find a good starting point (looking for block comments too)
//     let blockStartIndex = startIndex;

//     // Look backwards for comment blocks or attributes
//     // We'll use a more aggressive approach to find comments
//     let tempIndex = startIndex;

//     // Maximum number of characters to look back (should be enough for most comment blocks)
//     const maxLookback = 500;
//     const lookStartIndex = Math.max(0, startIndex - maxLookback);

//     for (let i = startIndex; i > lookStartIndex; i--) {
//       // Check for block comment start
//       if (i > 1 && text.substring(i - 2, i) === "/*") {
//         blockStartIndex = i - 2;
//         break;
//       }

//       // Check for line comment start
//       if (i > 1 && text.substring(i - 2, i) === "//") {
//         // Found a line comment, keep looking back for multi-line comments
//         blockStartIndex = i - 2;
//       }

//       // Check for attribute
//       if (i > 0 && text[i - 1] === "#" && text[i] === "[") {
//         blockStartIndex = i - 1;
//         break;
//       }

//       // Stop at empty lines before non-comment content
//       if (
//         text[i] === "\n" &&
//         i > 0 &&
//         text[i - 1] === "\n" &&
//         !text.substring(Math.max(0, i - 20), i).includes("*/") &&
//         !text.substring(Math.max(0, i - 20), i).includes("//")
//       ) {
//         break;
//       }
//     }

//     const functionBlock = text.substring(blockStartIndex, endIndex);
//     functionBlocks.push(functionBlock);
//   }

//   return functionBlocks;
// }

export function extractStructsFromFile(): MoveStruct[] {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return [];
  }

  const text = editor.document.getText();
  const structRegex =
    /(?:public\s+)?struct\s+(\w+)\s*(?:has\s+((?:key|store|copy|drop)(?:\s*,\s*(?:key|store|copy|drop))*))?\s*{([^}]*)}/g;
  let match;
  const structs: MoveStruct[] = [];

  while ((match = structRegex.exec(text)) !== null) {
    const name = match[1].trim();
    const abilities = match[2] ? match[2].split(",").map((a) => a.trim()) : [];
    const fieldsText = match[3].trim();

    const fields: StructField[] = fieldsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(":"))
      .map((line) => {
        const [fieldName, fieldType] = line
          .split(":")
          .map((s) => s.trim().replace(",", ""));
        return { name: fieldName, type: fieldType };
      });

    structs.push({ name, abilities, fields });
  }
  return structs;
}

// interface MoveFunction {
//   name: string;
//   type: string;
//   description: string;
//   params: FunctionParam[];
//   returns: string;
//   returnDoc: string;
//   body: string;
// }

// interface FunctionParam {
//   name: string;
//   type: string;
//   description: string;
// }

// interface MoveStruct {
//   name: string;
//   abilities: string[];
//   fields: StructField[];
// }

// interface StructField {
//   name: string;
//   type: string;
// }

export interface MoveConstant {
  name: string;
  type: string;
  value: string;
}

export function parseMoveFile(data?: string): {
  imports: string[];
  testImports: string[];
  constants: MoveConstant[];
  structs: MoveStruct[];
  functions: MoveFunction[];
  testFunctions: MoveFunction[];
} {
  const editor = vscode.window.activeTextEditor;
  const text = data ?? editor?.document.getText() ?? "";

  // Extract use imports and separate test-only imports
  const imports: string[] = [];
  const testImports: string[] = [];

  const useRegex = /(?:#\[\s*test_only\s*\]\s*)?use\s+.*?;/g;
  let useMatch;

  while ((useMatch = useRegex.exec(text)) !== null) {
    const matchedImport = useMatch[0].trim();

    if (matchedImport.startsWith("#[test_only]")) {
      testImports.push(matchedImport);
    } else {
      imports.push(matchedImport);
    }
  }

  // Extract constants (uppercase)
  const constants: MoveConstant[] = [];
  const constRegex =
    /const\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+?)\s*=\s*([^;]+);/g;

  let constMatch;
  while ((constMatch = constRegex.exec(text)) !== null) {
    constants.push({
      name: constMatch[1].trim(),
      type: constMatch[2].trim(),
      value: constMatch[3].trim(),
    });
  }

  // Extract structs
  const structs: MoveStruct[] = [];
  const structRegex =
    /(?:public\s+)?struct\s+(\w+)\s*(?:has\s+((?:key|store|copy|drop)(?:\s*,\s*(?:key|store|copy|drop))*))?\s*{([^}]*)}/g;
  let structMatch;
  while ((structMatch = structRegex.exec(text)) !== null) {
    const name = structMatch[1].trim();
    const abilities = structMatch[2]
      ? structMatch[2].split(",").map((a) => a.trim())
      : [];
    const fieldsText = structMatch[3].trim();
    const fields: StructField[] = fieldsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(":"))
      .map((line) => {
        const [fieldName, fieldType] = line
          .split(":")
          .map((s) => s.trim().replace(/,/g, ""));
        return { name: fieldName, type: fieldType };
      });
    structs.push({ name, abilities, fields });
  }

  // Extract functions and test functions
  const functionBlocks = splitFunctionBlocks(text);
  // console.log(functionBlocks[0], "split functions");
  const functions: MoveFunction[] = [];
  const testFunctions: MoveFunction[] = [];
  for (const block of functionBlocks) {
    const func = parseFunctionBlock(block);
    if (!func) {
      continue;
    }
    if (block.includes("#[test]")) {
      testFunctions.push(func);
    } else {
      functions.push(func);
    }
  }

  return { imports, testImports, constants, structs, functions, testFunctions };
}

function parseFunctionBlock(block: string): MoveFunction | null {
  const signatureMatch = block.match(
    /(?:public\(package\)|public|entry|private)?\s*fun\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/,
  );
  if (!signatureMatch) {
    return null;
  }

  const fullSignature = signatureMatch[0];
  const name = signatureMatch[1];
  const paramsText = signatureMatch[2].trim();
  const returns = signatureMatch[3] ? signatureMatch[3].trim() : "";

  let type = "private";
  if (fullSignature.includes("public(package)")) {
    type = "public(package)";
  } else if (fullSignature.includes("public")) {
    type = "public";
  } else if (fullSignature.includes("entry")) {
    type = "entry";
  }

  // Extract comments
  const commentRegex =
    /\/\*\s*([\s\S]*?)\s*\*\/\s*(?:public\(package\)|public|entry|private)?\s*fun\s+\w+/;
  const commentMatch = block.match(commentRegex);

  let description = "";
  const paramDocMap = new Map<string, string>();
  let returnDoc = "";

  if (commentMatch) {
    const commentContent = commentMatch[1];
    const commentLines = commentContent.split("\n");

    for (const line of commentLines) {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith("@")) {
        description = trimmedLine;
        break;
      }
    }

    // Extract @param and @return
    const paramRegex = /@param\s+(\w+)(?:\s*-\s*(.+))?/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(commentContent)) !== null) {
      const paramName = paramMatch[1];
      const paramDesc = paramMatch[2] ? paramMatch[2].trim() : "";
      paramDocMap.set(paramName, paramDesc);
    }

    const returnMatch = commentContent.match(/@return\s*-\s*(.+)/);
    if (returnMatch) {
      returnDoc = returnMatch[1].trim();
    }
  }

  // Extract body with proper nested brace handling
  let body = "";
  const bodyStartIndex = block.indexOf("{") + 1;
  let bodyEndIndex = -1;
  let braceCount = 1;

  // Scan through the block counting braces until we find the matching closing brace
  for (let i = bodyStartIndex; i < block.length; i++) {
    const char = block[i];
    if (char === "{") {
      braceCount++;
    } else if (char === "}") {
      braceCount--;
      if (braceCount === 0) {
        bodyEndIndex = i;
        break;
      }
    }
  }

  if (bodyEndIndex === -1) {
    // No matching closing brace found
    return null;
  }

  // Extract the body content and preserve indentation
  body = block
    .substring(bodyStartIndex, bodyEndIndex)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n    "); // Preserve indentation with 4 spaces

  // Parse parameters
  const params: FunctionParam[] = paramsText
    ? paramsText.split(",").map((param) => {
        const parts = param.split(":").map((s) => s.trim());
        const paramName = parts[0];
        const paramType = parts[1] || "";
        return {
          name: paramName,
          type: paramType,
          description: paramDocMap.get(paramName) || "",
        };
      })
    : [];

  return {
    name,
    type,
    description,
    params,
    returns,
    body,
  };
}

function splitFunctionBlocks(text: string): string[] {
  const functionBlocks: string[] = [];
  const functionStartRegex =
    /(?:#\[.*\]\s*\n)?\s*(?:public\(package\)|public|entry|private)?\s*fun\s+\w+\s*\(/g;

  let match;
  while ((match = functionStartRegex.exec(text)) !== null) {
    const startIndex = match.index;

    let openBraces = 0;
    let closeBraces = 0;
    let foundOpeningBrace = false;
    let endIndex = startIndex;

    for (let i = startIndex; i < text.length; i++) {
      if (text[i] === "{") {
        foundOpeningBrace = true;
        {
          openBraces++;
        }
      } else if (text[i] === "}") {
        closeBraces++;
      }

      if (foundOpeningBrace && openBraces === closeBraces) {
        endIndex = i + 1;
        break;
      }
    }

    let blockStartIndex = startIndex;
    const maxLookback = 500;
    const lookStartIndex = Math.max(0, startIndex - maxLookback);

    for (let i = startIndex; i > lookStartIndex; i--) {
      if (i > 1 && text.substring(i - 2, i) === "/*") {
        blockStartIndex = i - 2;
        break;
      }

      if (i > 1 && text.substring(i - 2, i) === "//") {
        blockStartIndex = i - 2;
      }

      if (i > 0 && text[i - 1] === "#" && text[i] === "[") {
        blockStartIndex = i - 1;
        break;
      }

      if (
        text[i] === "\n" &&
        i > 0 &&
        text[i - 1] === "\n" &&
        !text.substring(Math.max(0, i - 20), i).includes("*/") &&
        !text.substring(Math.max(0, i - 20), i).includes("//")
      ) {
        break;
      }
    }

    const functionBlock = text.substring(blockStartIndex, endIndex);
    functionBlocks.push(functionBlock);
  }

  return functionBlocks;
}

// Helper to apply alias replacements
export function normalizeAlias(modulePath: string): string {
  return modulePath
    .replace(/^Sui::/i, "sui::")
    .replace(/^MoveStdlib::/i, "std::");
}

export function formatMoveFile(): string {
  // Extract imports, constants, structs, and functions using parseMoveFile
  const { imports, testImports, constants, structs, functions, testFunctions } =
    parseMoveFile();

  // Format imports
  const formattedImports = `/*==============================================================================================
  Dependencies - DO NOT MODIFY
==============================================================================================*/
${[...imports].join("\n")}`;

  // Format constants
  const generalConstants = constants.filter((c) => !c.name.startsWith("E"));
  const errorConstants = constants.filter((c) => c.name.startsWith("E"));

  const formattedConstants = `/*==============================================================================================
  Constants - Add your constants here (if any)
==============================================================================================*/
${generalConstants
  .map((c) => `const ${c.name}: ${c.type} = ${c.value};`)
  .join("\n")}

  /*==============================================================================================
  Error codes - DO NOT MODIFY
==============================================================================================*/
${errorConstants
  .map(
    (c) => `/// ${c.name}
const ${c.name}: ${c.type} = ${c.value};`,
  )
  .join("\n")}`;

  // Format structs
  const formattedStructs = `/*==============================================================================================
  Module Structs - DO NOT MODIFY
==============================================================================================*/
${structs
  .map((s) => {
    const fields = s.fields.map((f) => `\t${f.name}: ${f.type},`).join("\n");
    return `struct ${s.name} has ${s.abilities.join(", ")} {\n${fields}\n}`;
  })
  .join("\n\n")}`;

  // Format functions
  const formattedFunctions = `/*==============================================================================================
  Functions
==============================================================================================*/
${functions
  .map((f) => {
    const params = f.params.map((p) => `${p.name}: ${p.type}`).join(", ");
    const visibility = f.type === "private" ? "" : f.type ? `${f.type} ` : "";
    return `${visibility} fun ${f.name}(${params}): ${f.returns} {\n\t${f.body}\n}`;
  })
  .join("\n\n")}`;

  // Format functions
  const formattedTestFunctions = `/*==============================================================================================
  Tests
==============================================================================================*/

${[...testImports].join("\n\n")}
${testFunctions
  .map((f) => {
    const params = f.params.map((p) => `${p.name}: ${p.type}`).join(", ");
    return `fun ${f.name}(${params}): ${f.returns} {\n\t${f.body}\n}`;
  })
  .join("\n\n")}`;

  // Combine all sections
  return [
    formattedImports,
    formattedConstants,
    formattedStructs,
    formattedFunctions,
  ].join("\n\n");
}
