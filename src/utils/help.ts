import * as vscode from "vscode";
import * as path from "path";
import { Parser, Language, Node } from "web-tree-sitter";
import { FunctionParam, MoveFunction } from "../types";
import { MoveStruct, StructField } from "../types";
import { MoveConstant } from "../types";
import { MoveEnum, MoveEnumVariant } from "../types";

let parser: Parser;
let MoveLang: Language;

async function initializeParser(context: vscode.ExtensionContext) {
  if (!parser) {
    try {
      // Import web-tree-sitter
      const { Parser, Language } = require("web-tree-sitter");

      if (!context?.extensionPath) {
        throw new Error("Could not find extension path");
      }

      // console.log("Extension Path:", context?.extensionPath);

      //   // Debug: List all available extensions
      //   console.log(
      //     "Available extensions:",
      //     vscode.extensions.all.map((ext) => ext.id),
      //   );

      // Initialize with fixed wasm paths
      const wasmBasePath = path.join(context?.extensionPath, "dist");
      const mainWasmPath = path.join(wasmBasePath, "tree-sitter.wasm");
      const moveWasmPath = path.join(wasmBasePath, "tree-sitter-move.wasm");

      // Debug log
      // console.log("Main WASM Path:", mainWasmPath);
      // console.log("Move WASM Path:", moveWasmPath);

      // Check if files exist
      const fs = require("fs");
      if (!fs.existsSync(mainWasmPath)) {
        console.error(`Main WASM file not found at: ${mainWasmPath}`);
      }

      if (!fs.existsSync(moveWasmPath)) {
        console.error(`Move WASM file not found at: ${moveWasmPath}`);
      }

      // Initialize with explicit wasm file location
      await Parser.init({
        locateFile(fileName: string) {
          return path.join(wasmBasePath, fileName);
        },
      });

      parser = new Parser();

      // Load language
      MoveLang = await Language.load(moveWasmPath);
      parser.setLanguage(MoveLang);
      return parser;
    } catch (error) {
      console.error("Failed to initialize parser:", error);
      throw error;
    }
  }
  return parser;
}

// Helper to associate comments with nodes
function associateCommentsWithNodes(nodes: Node[], text: string) {
  const result: Array<{ node: Node; comments: string[] }> = [];
  let commentsBuffer: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    // If this node is a comment, buffer it
    if (node.type === "block_comment" || node.type === "line_comment") {
      commentsBuffer.push(text.slice(node.startIndex, node.endIndex).trim());
      continue;
    }
    // If not a comment, attach buffered comments to this node
    result.push({ node, comments: commentsBuffer });
    commentsBuffer = [];
  }
  // Any remaining comments at the end are top-level
  return { nodesWithComments: result, trailingComments: commentsBuffer };
}

export async function parseMoveFile(
  context: vscode.ExtensionContext,
  data?: string,
): Promise<{
  imports: string[];
  testImports: string[];
  constants: (MoveConstant & { comments?: string[] })[];
  structs: (MoveStruct & { comments?: string[] })[];
  enums: (MoveEnum & { comments?: string[] })[];
  functions: (MoveFunction & { comments?: string[] })[];
  testFunctions: (MoveFunction & { comments?: string[] })[];
  annotations: Record<string, any>[];
  topLevelComments: string[];
}> {
  const parser = await initializeParser(context);
  const editor = vscode.window.activeTextEditor;
  const text = data ?? editor?.document.getText() ?? "";
  const tree = parser?.parse(text);
  if (!tree) {
    return {
      imports: [],
      testImports: [],
      constants: [],
      structs: [],
      enums: [],
      functions: [],
      testFunctions: [],
      annotations: [],
      topLevelComments: [],
    };
  }
  const root = tree.rootNode;

  // Only process module body children for comment association
  let moduleBody: Node | null | undefined;
  for (const child of root.children) {
    if (child && child.type === "module_definition") {
      moduleBody = child.children.find(
        (n) => n && (n.type === "block" || n.type === "module_body"),
      );
      break;
    }
  }
  // Filter out null/undefined nodes
  const nodes = (moduleBody ? moduleBody.children : root.children).filter(
    (n): n is Node => !!n,
  );
  const { nodesWithComments, trailingComments } = associateCommentsWithNodes(
    nodes,
    text,
  );

  // Prepare collections
  const imports: string[] = [];
  const testImports: string[] = [];
  const constants: (MoveConstant & { comments?: string[] })[] = [];
  const structs: (MoveStruct & { comments?: string[] })[] = [];
  const enums: (MoveEnum & { comments?: string[] })[] = [];
  const functions: (MoveFunction & { comments?: string[] })[] = [];
  const testFunctions: (MoveFunction & { comments?: string[] })[] = [];
  const annotations: Record<string, any>[] = [];
  const topLevelComments: string[] = [];

  // Walk through nodes and assign comments
  for (const { node, comments } of nodesWithComments) {
    switch (node.type) {
      case "use_declaration":
        processUseDeclaration(node, text, imports, testImports, annotations);
        break;

      case "constant":
        constants.push({ ...parseConstant(node, text), comments });
        break;

      case "struct_definition":
        structs.push({ ...parseStruct(node, text), comments });
        break;

      case "enum_definition":
        enums.push({ ...parseEnum(node, text), comments });
        break;

      case "function_definition":
      case "native_function_definition":
      case "macro_function_definition": {
        const func = parseFunction(node, text);
        const isTest = hasTestAnnotation(node, annotations);
        if (isTest) {
          testFunctions.push({ ...func, comments });
        } else {
          functions.push({ ...func, comments });
        }
        break;
      }

      case "annotation": {
        const annotation = parseAnnotation(node, text);
        if (annotation) {
          annotations.push(annotation);
        }
        break;
      }

      default:
        // Comments not attached to a node are top-level
        if (node.type === "block_comment" || node.type === "line_comment") {
          topLevelComments.push(...comments);
        }
        break;
    }
  }

  // Add any trailing comments as top-level
  if (trailingComments.length) {
    topLevelComments.push(...trailingComments);
  }

  return {
    imports,
    testImports,
    constants,
    structs,
    enums,
    functions,
    testFunctions,
    annotations,
    topLevelComments,
  };
}

function processUseDeclaration(
  node: Node,
  text: string,
  imports: string[],
  testImports: string[],
  annotations: Record<string, any>[],
) {
  const isTestOnly = hasTestOnlyAnnotation(node, annotations);
  const importText = text.slice(node.startIndex, node.endIndex).trim();
  if (
    importText.includes("::option::") ||
    importText.includes("sui::object::") ||
    importText.includes("sui::tx_context::")
  ) {
    return;
  }
  if (isTestOnly) {
    testImports.push(importText);
  } else {
    imports.push(importText);
  }
}

function processFunctionDefinition(
  node: Node,
  text: string,
  functions: MoveFunction[],
  testFunctions: MoveFunction[],
  annotations: Record<string, any>[],
) {
  const func = parseFunction(node, text);
  const isTest = hasTestAnnotation(node, annotations);

  if (isTest) {
    testFunctions.push(func);
  } else {
    functions.push(func);
  }
}

function hasTestAnnotation(
  node: Node,
  annotations: Record<string, any>[],
): boolean {
  // Check if there's a previous sibling annotation with 'test'
  let current = node.previousSibling;
  while (current && current.isExtra) {
    const annotationText = current.text;
    if (
      annotationText.includes("#[test") ||
      annotationText.includes("#[expected_failure")
    ) {
      return true;
    }
    current = current.previousSibling;
  }

  return false;
}

function hasTestOnlyAnnotation(
  node: Node,
  annotations: Record<string, any>[],
): boolean {
  // Similar to hasTestAnnotation but for test_only
  let current = node.previousSibling;
  while (current && current.isExtra) {
    const annotationText = current.text;
    if (annotationText.includes("#[test_only")) {
      return true;
    }
    current = current.previousSibling;
  }

  if (node.id) {
    const nodeAnnotations = annotations.filter(
      (a) => a.targetNodeId === node.id && a.name === "test_only",
    );
    return nodeAnnotations.length > 0;
  }

  return false;
}

function processModuleDefinition(
  moduleNode: Node,
  text: string,
  collections: {
    imports: string[];
    testImports: string[];
    constants: MoveConstant[];
    structs: MoveStruct[];
    enums: MoveEnum[];
    functions: MoveFunction[];
    testFunctions: MoveFunction[];
    annotations: Record<string, any>[];
    lineComments: string[];
    blockComments: string[];
  },
) {
  // Find the module block node (which contains all the module contents)
  const moduleBlock = moduleNode.children.find(
    (node) => node?.type === "block" || node?.type === "module_body",
  );

  if (!moduleBlock) {
    console.log("No module block found", moduleBlock);
    return;
  }

  // Process all nodes inside the module block
  for (const node of moduleBlock.children) {
    if (!node) {
      continue;
    }

    switch (node.type) {
      case "block_comment":
        const blockCommentText = text
          .slice(node.startIndex, node.endIndex)
          .trim();
        collections.blockComments.push(blockCommentText);
        break;

      case "line_comment":
        const lineCommentText = text
          .slice(node.startIndex, node.endIndex)
          .trim();
        collections.lineComments.push(lineCommentText);
        break;

      case "annotation":
        const annotation = parseAnnotation(node, text);
        if (annotation) {
          collections.annotations.push(annotation);
        }
        break;

      case "use_declaration":
        processUseDeclaration(
          node,
          text,
          collections.imports,
          collections.testImports,
          collections.annotations,
        );
        break;

      case "constant":
        collections.constants.push(parseConstant(node, text));
        break;

      case "struct_definition":
        collections.structs.push(parseStruct(node, text));
        break;

      case "enum_definition":
        collections.enums.push(parseEnum(node, text));
        break;

      case "function_definition":
      case "native_function_definition":
      case "macro_function_definition":
        processFunctionDefinition(
          node,
          text,
          collections.functions,
          collections.testFunctions,
          collections.annotations,
        );
        break;
    }
  }
}

function parseAnnotation(
  node: Node,
  sourceText: string,
): Record<string, any> | null {
  if (node.type !== "annotation") {
    return null;
  }

  const annotationText = sourceText
    .slice(node.startIndex, node.endIndex)
    .trim();
  const result: Record<string, any> = {
    text: annotationText,
    targetNodeId: node.nextSibling?.id,
    items: [],
  };

  // Process annotation items
  for (const child of node.children) {
    if (child?.type === "annotation_item") {
      // Handle annotation expressions or lists
      const exprNode = child.childForFieldName("annotation_expr");
      const listNode = child.childForFieldName("annotation_list");

      if (exprNode) {
        const nameNode = exprNode.childForFieldName("name");
        const valueNode = exprNode.childForFieldName("value");

        const item: Record<string, any> = {
          name: nameNode
            ? sourceText.slice(nameNode.startIndex, nameNode.endIndex)
            : "",
        };

        if (valueNode) {
          item.value = sourceText.slice(
            valueNode.startIndex,
            valueNode.endIndex,
          );
        }

        result.items.push(item);

        // Set the name as a top-level property for easier access
        if (nameNode) {
          const name = sourceText.slice(nameNode.startIndex, nameNode.endIndex);
          result.name = name;
        }
      } else if (listNode) {
        const nameNode = listNode.childForFieldName("name");
        const name = nameNode
          ? sourceText.slice(nameNode.startIndex, nameNode.endIndex)
          : "";

        const values = [];
        // Extract list items (could be more complex depending on your needs)
        for (let i = 1; i < listNode.children.length; i++) {
          const itemNode = listNode.children[i];
          if (
            itemNode &&
            itemNode.type !== "(" &&
            itemNode.type !== ")" &&
            itemNode.type !== ","
          ) {
            values.push(
              sourceText.slice(itemNode.startIndex, itemNode.endIndex),
            );
          }
        }

        result.items.push({ name, values });
        result.name = name;
      }
    }
  }

  return result;
}

function parseConstant(node: Node, sourceText: string): MoveConstant {
  const nameNode = node.childForFieldName("name");
  const typeNode = node.childForFieldName("type");
  const valueNode = node.childForFieldName("expr");

  return {
    name: nameNode
      ? sourceText.slice(nameNode.startIndex, nameNode.endIndex)
      : "",
    type: typeNode
      ? sourceText.slice(typeNode.startIndex, typeNode.endIndex)
      : "",
    value: valueNode
      ? sourceText.slice(valueNode.startIndex, valueNode.endIndex)
      : "",
  };
}

function parseStruct(node: Node, sourceText: string): MoveStruct {
  const nameNode = node.childForFieldName("name");
  const abilitiesNode = node.childForFieldName("ability_declarations");
  const postfixAbilitiesNode = node.childForFieldName(
    "postfix_ability_declarations",
  );
  const fieldsNode = node.childForFieldName("struct_fields");
  const typeParamsNode = node.childForFieldName("type_parameters");

  // Handle abilities from both locations
  const abilities: string[] = [];

  if (abilitiesNode) {
    for (const abilityNode of abilitiesNode.children) {
      if (abilityNode?.type === "ability") {
        abilities.push(
          sourceText.slice(abilityNode.startIndex, abilityNode.endIndex).trim(),
        );
      }
    }
  }

  if (postfixAbilitiesNode) {
    for (const abilityNode of postfixAbilitiesNode.children) {
      if (abilityNode?.type === "ability") {
        abilities.push(
          sourceText.slice(abilityNode.startIndex, abilityNode.endIndex).trim(),
        );
      }
    }
  }

  // Parse type parameters if they exist
  const typeParameters: string[] = [];
  if (typeParamsNode) {
    for (const paramNode of typeParamsNode.children) {
      if (paramNode?.type === "type_parameter") {
        typeParameters.push(
          sourceText.slice(paramNode.startIndex, paramNode.endIndex).trim(),
        );
      }
    }
  }

  const fields: StructField[] = [];

  if (fieldsNode) {
    for (const field of fieldsNode.children) {
      if (!field) {
        console.log("No Field");
        return { name: "", abilities: [], typeParameters: [], fields: [] };
      }
      if (field.type === "named_fields") {
        for (const a of field.children) {
          const fieldName = a?.childForFieldName("field");
          const fieldType = a?.childForFieldName("type");
          if (fieldName && fieldType) {
            fields.push({
              name: sourceText.slice(fieldName.startIndex, fieldName.endIndex),
              type: sourceText.slice(fieldType.startIndex, fieldType.endIndex),
            });
          }
        }
      }
    }
  }
  return {
    name: nameNode
      ? sourceText.slice(nameNode.startIndex, nameNode.endIndex)
      : "",
    abilities,
    typeParameters,
    fields,
  };
}

// function parseStruct(node: Node, sourceText: string): MoveStruct {
//   const nameNode = node.childForFieldName("name");
//   const abilitiesNode = node.childForFieldName("ability_declarations");
//   const fieldsNode = node.childForFieldName("struct_fields");
//   const typeParamsNode = node.childForFieldName("type_parameters");

//   const abilities = abilitiesNode
//     ? sourceText
//         .slice(abilitiesNode.startIndex, abilitiesNode.endIndex)
//         .split(",")
//         .map((a) => a.trim())
//     : [];

//   const fields: StructField[] = [];
//   if (fieldsNode) {
//     for (const field of fieldsNode.children) {
//       if (!field) {
//         console.log("No Field");
//         return { name: "", abilities: [], fields: [] };
//       }
//       if (field.type === "named_fields") {
//         for (const a of field.children) {
//           const fieldName = a?.childForFieldName("field");
//           const fieldType = a?.childForFieldName("type");
//           if (fieldName && fieldType) {
//             fields.push({
//               name: sourceText.slice(fieldName.startIndex, fieldName.endIndex),
//               type: sourceText.slice(fieldType.startIndex, fieldType.endIndex),
//             });
//           }
//         }
//       }
//     }
//   }

//   return {
//     name: nameNode
//       ? sourceText.slice(nameNode.startIndex, nameNode.endIndex)
//       : "",
//     abilities,
//     fields,
//   };
// }

function parseEnum(node: Node, sourceText: string): MoveEnum {
  const nameNode = node.childForFieldName("name");
  const abilitiesNode = node.childForFieldName("ability_declarations");
  const postfixAbilitiesNode = node.childForFieldName(
    "postfix_ability_declarations",
  );
  const typeParamsNode = node.childForFieldName("type_parameters");
  const variantsNode = node.childForFieldName("enum_variants");

  // Parse name
  const name = nameNode
    ? sourceText.slice(nameNode.startIndex, nameNode.endIndex)
    : "";

  // Parse abilities
  const abilities: string[] = [];

  if (abilitiesNode) {
    for (const abilityNode of abilitiesNode.children) {
      if (abilityNode?.type === "ability") {
        abilities.push(
          sourceText.slice(abilityNode.startIndex, abilityNode.endIndex).trim(),
        );
      }
    }
  }

  if (postfixAbilitiesNode) {
    for (const abilityNode of postfixAbilitiesNode.children) {
      if (abilityNode?.type === "ability") {
        abilities.push(
          sourceText.slice(abilityNode.startIndex, abilityNode.endIndex).trim(),
        );
      }
    }
  }

  // Parse type parameters
  const typeParameters: string[] = [];
  if (typeParamsNode) {
    for (const paramNode of typeParamsNode.children) {
      if (paramNode?.type === "type_parameter") {
        typeParameters.push(
          sourceText.slice(paramNode.startIndex, paramNode.endIndex).trim(),
        );
      }
    }
  }

  // Parse variants
  const variants: MoveEnumVariant[] = [];
  if (variantsNode) {
    for (const variantNode of variantsNode.children) {
      if (variantNode?.type === "variant") {
        const variantNameNode = variantNode.childForFieldName("variant_name");
        const fieldsNode = variantNode.childForFieldName("fields");

        const variantName = variantNameNode
          ? sourceText.slice(
              variantNameNode.startIndex,
              variantNameNode.endIndex,
            )
          : "";

        const variantFields: StructField[] = [];

        if (fieldsNode) {
          // Handle different field types according to grammar
          if (fieldsNode.type === "datatype_fields") {
            const namedFieldsNode =
              fieldsNode.childForFieldName("named_fields");
            const positionalFieldsNode =
              fieldsNode.childForFieldName("positional_fields");

            if (namedFieldsNode) {
              for (const fieldNode of namedFieldsNode.children) {
                if (fieldNode?.type === "field_annotation") {
                  const fieldNameNode = fieldNode.childForFieldName("field");
                  const fieldTypeNode = fieldNode.childForFieldName("type");

                  if (fieldNameNode && fieldTypeNode) {
                    variantFields.push({
                      name: sourceText.slice(
                        fieldNameNode.startIndex,
                        fieldNameNode.endIndex,
                      ),
                      type: sourceText.slice(
                        fieldTypeNode.startIndex,
                        fieldTypeNode.endIndex,
                      ),
                    });
                  }
                }
              }
            } else if (positionalFieldsNode) {
              // Handle positional fields if needed
              let index = 0;
              for (const fieldNode of positionalFieldsNode.children) {
                if (
                  fieldNode?.type !== "(" &&
                  fieldNode?.type !== ")" &&
                  fieldNode?.type !== ","
                ) {
                  variantFields.push({
                    name: `_${index}`,
                    type: sourceText.slice(
                      fieldNode?.startIndex,
                      fieldNode?.endIndex,
                    ),
                  });
                  index++;
                }
              }
            }
          }
        }

        variants.push({
          name: variantName,
          fields: variantFields,
        });
      }
    }
  }

  return {
    name,
    abilities,
    typeParameters,
    variants,
  };
}

function parseFunction(node: Node, sourceText: string): MoveFunction {
  const nameNode = node.childForFieldName("name");
  const paramsNode = node.childForFieldName("parameters");
  const returnTypeNode = node.childForFieldName("return_type");
  const bodyNode = node.childForFieldName("body");
  const typeParamsNode = node.childForFieldName("type_parameters");

  // Handle modifiers
  let visibility = "private"; // Default

  // Check for all modifiers in the node's children
  for (const child of node.children) {
    if (child?.type === "modifier") {
      const modifierText = sourceText
        .slice(child.startIndex, child.endIndex)
        .trim();
      visibility = modifierText;

      // If you need to handle combined modifiers like 'public(friend)'
      if (modifierText.includes("public")) {
        // Check for more specific public variants
        if (modifierText.includes("(friend)")) {
          visibility = "public(friend)";
        } else if (modifierText.includes("(package)")) {
          visibility = "public(package)";
        } else {
          visibility = "public";
        }
      } else if (modifierText.includes("entry")) {
        visibility = "entry";
      } else if (modifierText.includes("native")) {
        visibility = "native";
      }
    }
  }

  // Parse type parameters
  const typeParameters: string[] = [];
  if (typeParamsNode) {
    for (const paramNode of typeParamsNode.children) {
      if (paramNode?.type === "type_parameter") {
        typeParameters.push(
          sourceText.slice(paramNode.startIndex, paramNode.endIndex).trim(),
        );
      }
    }
  }

  const params: FunctionParam[] = [];

  if (paramsNode) {
    for (const paramNode of paramsNode.children) {
      if (
        paramNode?.type === "function_parameter" ||
        paramNode?.type === "mut_function_parameter"
      ) {
        let isMutable = paramNode.type === "mut_function_parameter";

        // For mut_function_parameter, we need to get the actual parameter node
        const actualParamNode = isMutable
          ? paramNode.childForFieldName("function_parameter") ||
            paramNode.children[1]
          : paramNode;

        if (!actualParamNode) {
          continue;
        }

        const paramName = actualParamNode.childForFieldName("name");
        const paramType = actualParamNode.childForFieldName("type");

        if (paramName && paramType) {
          params.push({
            name: sourceText.slice(paramName.startIndex, paramName.endIndex),
            type: sourceText.slice(paramType.startIndex, paramType.endIndex),
            isMutable,
            description: "", // Add doc comment parsing if needed
          });
        }
      }
    }
  }

  // Parse docstring if available (usually from a preceding block_comment)
  let description = "";
  let prevSibling = node.previousSibling;
  while (
    prevSibling &&
    (prevSibling.type === "block_comment" ||
      prevSibling.type === "line_comment")
  ) {
    if (
      prevSibling.type === "block_comment" ||
      prevSibling.type === "line_comment"
    ) {
      // Extract the comment without comment syntax
      let commentText = sourceText
        .slice(prevSibling.startIndex, prevSibling.endIndex)
        .trim();

      // Remove comment markers
      if (commentText.startsWith("/*")) {
        commentText = commentText.substring(2, commentText.length - 2).trim();
      } else if (commentText.startsWith("//")) {
        commentText = commentText.substring(2).trim();
      }

      // Add to description (prepend since we're going backwards)
      description = commentText + (description ? "\n" + description : "");
    }
    prevSibling = prevSibling.previousSibling;
  }

  return {
    name: nameNode
      ? sourceText.slice(nameNode.startIndex, nameNode.endIndex)
      : "",
    type: visibility,
    typeParameters,
    params,
    returns: returnTypeNode
      ? sourceText.slice(returnTypeNode.startIndex, returnTypeNode.endIndex)
      : "",
    description,
    body: bodyNode
      ? sourceText.slice(bodyNode.startIndex, bodyNode.endIndex).trim()
      : "",
    isNative: node.type === "native_function_definition",
    isMacro: node.type === "macro_function_definition",
  };
}

function getFieldNames(node: Node): string[] {
  const fieldNames: string[] = [];
  const cursor = node.walk();

  cursor.gotoFirstChild();
  do {
    const fieldName = cursor.currentFieldName;
    if (fieldName) {
      fieldNames.push(fieldName);
    }
  } while (cursor.gotoNextSibling());

  cursor.delete();
  return fieldNames;
}

export async function updateMoveFileGeneral(
  context: vscode.ExtensionContext,
  updates: Partial<{
    imports: string[];
    testImports: string[];
    constants: (MoveConstant & { comments?: string[] })[];
    structs: (MoveStruct & { comments?: string[] })[];
    enums: (MoveEnum & { comments?: string[] })[];
    functions: (MoveFunction & { comments?: string[] })[];
    testFunctions: (MoveFunction & { comments?: string[] })[];
  }> = {},
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  // Parse the file and get all sections, including comments
  const parsed = await parseMoveFile(context);

  // Merge updates
  const merged = { ...parsed, ...updates };
  console.log("Parsed:", parsed);
  console.log("Merged:", merged);

  // Extract the module declaration (header)
  const text = editor.document.getText();
  const moduleMatch = text.match(/module\s+[\w:]+\s*/);
  let moduleHeader = "";
  if (moduleMatch) {
    moduleHeader = moduleMatch[0].trim();
  }

  // Reconstruct the file, preserving comments as much as possible
  const sections: string[] = [];

  // Add the module declaration at the top
  if (moduleHeader) {
    sections.push(moduleHeader.concat(";"));
  }

  // Add top-level comments
  if (merged.topLevelComments && merged.topLevelComments.length) {
    sections.push(merged.topLevelComments.join("\n"));
  }

  // Imports
  if (merged.imports.length || merged.testImports.length) {
    sections.push([...merged.imports, ...merged.testImports].join("\n"));
  }

  // Constants
  if (merged.constants.length) {
    const generalConstants = merged.constants.filter(
      (c) => !c.name.startsWith("E"),
    );
    const errorConstants = merged.constants.filter((c) =>
      c.name.startsWith("E"),
    );
    if (generalConstants.length) {
      sections.push(
        `\t/*============================Constants - Add your constants here (if any)=================*/`,
        generalConstants
          .map((c) =>
            renderWithComments(
              c.comments,
              `const ${c.name}: ${c.type} = ${c.value};`,
            ),
          )
          .join("\n"),
      );
    }
    if (errorConstants.length) {
      sections.push(
        `\t/*========================Error codes - DO NOT MODIFY========================*/`,
        errorConstants
          .map((c) =>
            renderWithComments(
              c.comments,
              `/// ${c.name}\nconst ${c.name}: ${c.type} = ${c.value};`,
            ),
          )
          .join("\n"),
      );
    }
  }

  // Structs
  if (merged.structs.length) {
    sections.push(
      `\t/*=============================Module Structs =====================*/`,
      merged.structs
        .map((s) =>
          renderWithComments(
            s.comments,
            `public struct ${s.name}${
              s.typeParameters?.length ? `<${s.typeParameters.join(", ")}>` : ""
            }${
              s.abilities.length ? ` has ${s.abilities.join(", ")}` : ""
            } {\n${s.fields
              .map((f) => `    ${f.name}: ${f.type},`)
              .join("\n")}\n}`,
          ),
        )
        .join("\n\n"),
    );
  }

  // Enums
  if (merged.enums && merged.enums.length) {
    sections.push(
      `\t/*==========================================Enums========================================*/`,
      merged.enums
        .map((e) =>
          renderWithComments(
            e.comments,
            `enum ${e.name}${
              e.typeParameters?.length ? `<${e.typeParameters.join(", ")}>` : ""
            }${
              e.abilities.length ? ` has ${e.abilities.join(", ")}` : ""
            } {\n${e.variants
              .map(
                (v) =>
                  `    ${v.name}${
                    v.fields.length
                      ? ` { ${v.fields
                          .map((f) => `${f.name}: ${f.type}`)
                          .join(", ")} }`
                      : ""
                  }`,
              )
              .join(",\n")}\n}`,
          ),
        )
        .join("\n\n"),
    );
  }

  // Functions
  if (merged.functions.length) {
    sections.push(
      `\t/*================================================Functions==============================================*/`,
      merged.functions
        .map((f) =>
          renderWithComments(
            f.comments,
            `${f.description ? `/*\n${f.description}\n*/\n` : ""}${
              f.type === "private" ? "" : f.type ? `${f.type} ` : ""
            }fun ${f.name}${
              f.typeParameters?.length ? `<${f.typeParameters.join(", ")}>` : ""
            }(${f.params
              ?.map((p) => `${p.isMutable ? "mut " : ""}${p.name}: ${p.type}`)
              ?.join(", ")})${f.returns ? `: ${f.returns}` : ""} {\n    ${
              f.body
            }\n}`,
          ),
        )
        .join("\n\n"),
    );
  }

  // Test Functions
  if (merged.testFunctions.length) {
    sections.push(
      `\t/*================================================Tests==============================================*/`,
      merged.testFunctions
        .map((f) =>
          renderWithComments(
            f.comments,
            `${f.description ? `/*\n${f.description}\n*/\n` : ""}#[test]\nfun ${
              f.name
            }${
              f.typeParameters?.length ? `<${f.typeParameters.join(", ")}>` : ""
            }(${f.params
              .map((p) => `${p.isMutable ? "mut " : ""}${p.name}: ${p.type}`)
              .join(", ")})${f.returns ? `: ${f.returns}` : ""} {\n    ${
              f.body
            }\n}`,
          ),
        )
        .join("\n\n"),
    );
  }

  // Compose the new file content
  let newText = sections.filter(Boolean).join("\n\n");

  // If we had a module header, ensure we close the module with a brace
  if (moduleHeader) {
    if (!newText.trim().endsWith("}")) {
      newText = newText.trimEnd() + "\n}";
    }
  }

  // Apply to the editor
  await editor.edit((editBuilder) => {
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length),
    );
    editBuilder.replace(fullRange, newText);
  });
}

// Helper to render a node with its comments
function renderWithComments(
  comments: string[] | undefined,
  content: string,
): string {
  return (
    (comments && comments.length ? comments.join("\n") + "\n" : "") + content
  );
}
