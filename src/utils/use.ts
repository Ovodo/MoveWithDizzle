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

      console.log("Extension Path:", context?.extensionPath);

      // Initialize with fixed wasm paths
      const wasmBasePath = path.join(context?.extensionPath, "dist");
      const mainWasmPath = path.join(wasmBasePath, "tree-sitter.wasm");
      const moveWasmPath = path.join(wasmBasePath, "tree-sitter-move.wasm");

      // Debug log
      console.log("Main WASM Path:", mainWasmPath);
      console.log("Move WASM Path:", moveWasmPath);

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

export async function parseMoveFile(
  context: vscode.ExtensionContext,
  data?: string,
): Promise<{
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
}> {
  const parser = await initializeParser(context);
  const editor = vscode.window.activeTextEditor;
  const text = data ?? editor?.document.getText() ?? "";

  const imports: string[] = [];
  const testImports: string[] = [];
  const constants: MoveConstant[] = [];
  const structs: MoveStruct[] = [];
  const enums: MoveEnum[] = [];
  const functions: MoveFunction[] = [];
  const testFunctions: MoveFunction[] = [];
  const annotations: Record<string, any>[] = [];
  const lineComments: string[] = [];
  const blockComments: string[] = [];

  const tree = parser?.parse(text);
  if (!tree) {
    console.log("No tree");
    return {
      imports,
      testImports,
      constants,
      structs,
      enums,
      functions,
      testFunctions,
      annotations,
      lineComments,
      blockComments,
    };
  }

  const root = tree.rootNode;

  // Walk through all top-level nodes
  for (const child of root.children) {
    if (!child) {
      console.log("No Child");
      continue;
    }

    // Handle top-level nodes
    switch (child.type) {
      case "use_declaration":
        processUseDeclaration(child, text, imports, testImports, annotations);
        break;

      case "constant":
        constants.push(parseConstant(child, text));
        break;

      case "struct_definition":
        structs.push(parseStruct(child, text));
        break;

      case "enum_definition":
        enums.push(parseEnum(child, text));
        break;

      case "function_definition":
      case "native_function_definition":
      case "macro_function_definition":
        processFunctionDefinition(
          child,
          text,
          functions,
          testFunctions,
          annotations,
        );
        break;

      case "module_definition":
        processModuleDefinition(child, text, {
          imports,
          testImports,
          constants,
          structs,
          enums,
          functions,
          testFunctions,
          annotations,
          lineComments,
          blockComments,
        });
        break;

      case "line_comment":
        const lineCommentText = text
          .slice(child.startIndex, child.endIndex)
          .trim();
        lineComments.push(lineCommentText);
        break;

      case "block_comment":
        const blockCommentText = text
          .slice(child.startIndex, child.endIndex)
          .trim();
        blockComments.push(blockCommentText);
        break;

      case "annotation":
        const annotation = parseAnnotation(child, text);
        if (annotation) {
          annotations.push(annotation);
        }
        break;
    }
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
    lineComments,
    blockComments,
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
  while (current && current.type === "annotation") {
    const annotationText = current.text;
    if (
      annotationText.includes("#[test") ||
      annotationText.includes("#[expected_failure")
    ) {
      return true;
    }
    current = current.previousSibling;
  }

  // Also check the annotations array if we're tracking them separately
  if (node.id) {
    const nodeAnnotations = annotations.filter(
      (a) =>
        a.targetNodeId === node.id &&
        (a.name === "test" || a.name === "expected_failure"),
    );
    return nodeAnnotations.length > 0;
  }

  return false;
}

function hasTestOnlyAnnotation(
  node: Node,
  annotations: Record<string, any>[],
): boolean {
  // Similar to hasTestAnnotation but for test_only
  let current = node.previousSibling;
  while (current && current.type === "annotation") {
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
  if (node.type !== "annotation") return null;

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
    // Handle different field types according to grammar
    if (fieldsNode.type === "datatype_fields") {
      const namedFieldsNode = fieldsNode.childForFieldName("named_fields");
      const positionalFieldsNode =
        fieldsNode.childForFieldName("positional_fields");

      if (namedFieldsNode) {
        for (const fieldNode of namedFieldsNode.children) {
          if (fieldNode?.type === "field_annotation") {
            const fieldNameNode = fieldNode.childForFieldName("field");
            const fieldTypeNode = fieldNode.childForFieldName("type");

            if (fieldNameNode && fieldTypeNode) {
              fields.push({
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
          if (fieldNode?.type === "_type") {
            fields.push({
              name: `_${index}`,
              type: sourceText.slice(fieldNode.startIndex, fieldNode.endIndex),
            });
            index++;
          }
        }
      }
    } else {
      // Direct check for named_fields
      if (fieldsNode.type === "named_fields") {
        for (const fieldNode of fieldsNode.children) {
          if (fieldNode?.type === "field_annotation") {
            const fieldNameNode = fieldNode.childForFieldName("field");
            const fieldTypeNode = fieldNode.childForFieldName("type");

            if (fieldNameNode && fieldTypeNode) {
              fields.push({
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

        if (!actualParamNode) continue;

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
