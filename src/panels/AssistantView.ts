import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

import { z } from "zod";
import { MoveFunction } from "../types";
import { MoveStruct } from "./StructsView";
import { TestFunction } from "./TestFunctionsView";
import { MoveConstant } from "../types";
import { parseMoveFile } from "../utils/help";

// Initialize dotenv when the module loads
dotenv.config();

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// MongoDB connection details
const mongoUrl =
  process.env.MONGODB_URI ||
  "mongodb+srv://username:password@cluster.mongodb.net/";
const dbName = process.env.MONGODB_DBNAME || "move_book_db";
const collectionName = process.env.MONGODB_COLLECTION || "vector_documents";
const indexName = process.env.MONGODB_INDEX_NAME || "vector_index";

export class AssistantView implements vscode.WebviewViewProvider {
  public static readonly viewType = "moveAssistant.assistant";
  private _view?: vscode.WebviewView;
  private _chatHistory: ChatMessage[] = [];
  private _storageKey = "moveAssistant.savedChatHistory";
  private _isProcessing: boolean = false;

  // RAG components
  private _vectorStore: any | null = null;
  private _mongoClient: any | null = null;
  private _agenticWorkflow: any = null;

  constructor(private readonly _context: vscode.ExtensionContext) {
    // Load saved chat history on initialization
    this.loadSavedHistory();

    // Initialize RAG components
    this.initializeRAG().catch((error) => {
      console.error("Failed to initialize RAG:", error);
      vscode.window.showErrorMessage(
        "Failed to initialize Sui Move Assistant. Check your MongoDB connection.",
      );
    });

    // Listen for file save events
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document === vscode.window.activeTextEditor?.document) {
        this.refreshView(); // Refresh when the active file is saved
      }
    });
  }

  private async initializeRAG() {
    // Set up MongoDB and vector store
    const { vectorStore, client } = await this.setupMongoVectorStore();
    this._vectorStore = vectorStore;
    this._mongoClient = client;
    // Initialize the workflow
    this._agenticWorkflow = await this.createAgenticWorkflow(vectorStore);
    const statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    statusBarItem.text = "$(rocket) Sui Move Assistant initialized";
    statusBarItem.show();
    setTimeout(() => {
      statusBarItem.hide();
      statusBarItem.dispose();
    }, 5000); // Auto-hide after 3 seconds
  }

  private async setupMongoVectorStore() {
    console.log("Connecting to MongoDB...");
    try {
      const { MongoClient } = await import("mongodb");
      const { MongoDBAtlasVectorSearch } = await import("@langchain/mongodb");
      const { OpenAIEmbeddings } = await import("@langchain/openai");

      const client = new MongoClient(mongoUrl);
      await client.connect();
      console.log("Connected to MongoDB successfully");

      const db = client.db(dbName);
      const collection = db.collection(collectionName);

      const vectorStore = new MongoDBAtlasVectorSearch(
        new OpenAIEmbeddings({ model: "text-embedding-ada-002" }),
        {
          collection,
          indexName,
          textKey: "text",
          embeddingKey: "embeddings",
        },
      );

      console.log("MongoDB Vector Store initialized successfully");
      return { vectorStore, client };
    } catch (error) {
      console.error("Failed to connect to MongoDB:", error);
      throw new Error("Failed to connect to MongoDB vector store");
    }
  }

  private async testVectorStore(query: string) {
    try {
      const { OpenAIEmbeddings } = await import("@langchain/openai");
      const embeddings = new OpenAIEmbeddings({
        model: "text-embedding-ada-002",
      });

      const queryEmbedding = await embeddings.embedQuery(query);

      console.log(
        "Generated query embedding with length:",
        queryEmbedding.length,
      );

      // Try direct similarity search
      // const results = await this._vectorStore.similaritySearch(query, 3);
      const results = await this._vectorStore?.similaritySearch(query, 3, {
        score_threshold: 0.01, // Lower threshold significantly
      });
      console.log("Direct similarity search results:", results);

      return results;
    } catch (error) {
      console.error("Vector store test failed:", error);
      throw error;
    }
  }

  private async testRawVectorSearch(query: string) {
    try {
      const { OpenAIEmbeddings } = await import("@langchain/openai");
      const embeddings = new OpenAIEmbeddings({
        model: "text-embedding-ada-002",
      });
      const queryEmbedding = await embeddings.embedQuery(query);

      // Get the MongoDB collection directly
      console.log(dbName, collectionName, indexName);
      const db = this._mongoClient.db(dbName);
      const collection = db.collection(collectionName);

      // Execute raw vector search
      const results = await collection
        .aggregate([
          {
            $vectorSearch: {
              queryVector: queryEmbedding,
              path: "embeddings",
              // numCandidates: 100, // Try a higher number
              limit: 5,
              index: indexName,
              exact: true,
            },
          },
        ])
        .toArray();

      console.log(
        "Raw vector search results:",
        JSON.stringify(results, null, 2),
      );
      return results;
    } catch (error) {
      console.error("Raw vector search failed:", error);
      throw error;
    }
  }

  private async createAgenticWorkflow(vectorStore: any) {
    const { Annotation, END, StateGraph, START } = await import(
      "@langchain/langgraph"
    );
    const { createRetrieverTool } = await import("langchain/tools/retriever");
    const { ToolNode } = await import("@langchain/langgraph/prebuilt");
    const { BaseMessage } = await import("@langchain/core/messages");

    const retriever = vectorStore.asRetriever({
      searchType: "similarity",
      k: 5,
    });
    const GraphState = Annotation.Root({
      messages: Annotation<(typeof BaseMessage)[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
      }),
      imports: Annotation<string[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
      }),
      testFunctions: Annotation<TestFunction[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
      }),
      constants: Annotation<MoveConstant[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
      }),
      structs: Annotation<MoveStruct[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
      }),
      functions: Annotation<MoveFunction[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
      }),
    });

    const tool = createRetrieverTool(retriever, {
      name: "retrieve_sui_move_docs",
      description:
        "Search for information about the Sui  Move language to help with debugging and writing smart contracts.",
    });

    const tools = [tool];

    const workflow = new StateGraph(GraphState)
      .addNode("agent", (state: any) => this.agent(state))
      .addNode("retrieve", new ToolNode<typeof GraphState.State>(tools))
      .addNode("gradeDocuments", (state: any) => this.gradeDocuments(state))
      .addNode("generate", (state: any) => this.generate(state))
      .addNode("analyzeMoveCode", async (state: any) => {
        const fileState = await this.getFileState();
        state.imports = fileState.imports;
        state.functions = fileState.functions;
        state.testFunctions = fileState.testFunctions;
        state.structs = fileState.structs;
        state.constants = fileState.constants;
        return this.analyzeMoveCode(state);
      });

    // workflow.addEdge(START, "analyzeMoveCode");
    workflow.addEdge(START, "agent");
    workflow.addEdge("agent", "retrieve");
    workflow.addEdge("retrieve", END);
    workflow.addEdge("analyzeMoveCode", "agent");
    workflow.addConditionalEdges("agent", (state: any) =>
      this.shouldRetrieve(state),
    );
    // workflow.addEdge("retrieve", "gradeDocuments");
    workflow.addConditionalEdges(
      "gradeDocuments",
      (state: any) => this.checkRelevance(state),
      {
        yes: "generate",
        no: "generate",
      },
    );
    workflow.addEdge("generate", END);

    return workflow.compile();
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this._context.extensionPath, "src", "media")),
      ],
    };

    // Set webview HTML with chat interface
    webviewView.webview.html = this.getWebviewContent(
      this._context,
      webviewView.webview,
    );

    // Send chat history to webview
    this.sendChatHistory();

    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "sendMessage":
            await this.handleUserMessage(message.text, "assistant");
            // await this.testVectorStore(message.text);
            // await this.testRawVectorSearch(message.text);
            return;
          case "insertCode":
            await this.insertCodeToEditor(message.code);
            return;
          case "clearChat":
            this.clearChatHistory();
            return;
          case "loadChatHistory":
            this.sendChatHistory();
            return;
          default:
            console.log("Unknown command:", message?.command);
        }
      },
      undefined,
      this._context.subscriptions,
    );
  }

  public async handleUserMessage(
    text: string,
    type: string,
  ): Promise<void | string> {
    if (this._isProcessing) {
      return;
    }

    // this.testVectorStore(text);
    // this.testRawVectorSearch(text);
    // return;

    // Add user message to chat history
    if (type === "assistant") {
      this.addMessage("user", text);
    }
    // Set processing flag
    this._isProcessing = true;
    this.updateWebviewProcessingState(true);

    try {
      // Get current file content if available
      const fileContent = this.getCurrentFileContent();
      const fileName = this.getCurrentFileName();

      // Create context for the LLM
      const context = fileContent
        ? `Current file (${fileName}):\n\`\`\`\n${fileContent}\n\`\`\``
        : "No file is currently open.";

      // Combine file context with user question
      const combinedPrompt = `${context}\n\nUser question: ${text}`;

      // Process using the agentic RAG workflow
      const response = await this.processWithAgenticRAG(text, fileContent);

      if (type === "assistant") {
        // Add LLM response to chat history
        this.addMessage("assistant", response);
      } else if (type === "function") {
        this.addMessage("assistant", response);
        return response;
      }
    } catch (error) {
      console.error("Error processing message:", error);
      this.addMessage(
        "assistant",
        "Sorry, I encountered an error processing your request. Please check if the MongoDB connection is properly configured.",
      );
    } finally {
      this._isProcessing = false;
      this.updateWebviewProcessingState(false);
    }
  }

  private async processWithAgenticRAG(
    userQuery: string,
    fileContent?: string | null,
  ): Promise<string> {
    if (!this._agenticWorkflow) {
      throw new Error("Agentic workflow not initialized");
    }
    const { HumanMessage } = await import("@langchain/core/messages");

    // Include file content in the message if available
    let messageContent = userQuery;
    // if (fileContent) {
    //   messageContent = `${userQuery}\n\nHere's the current file content:\n\`\`\`move\n${fileContent}\n\`\`\``;
    // }

    const inputs = {
      messages: [new HumanMessage(messageContent)],
    };

    let finalResponse = "I couldn't process your request.";

    try {
      // Stream the response from the workflow
      for await (const output of await this._agenticWorkflow.stream(inputs)) {
        for (const [key, value] of Object.entries(output)) {
          // @ts-ignore - access messages property of the output
          const lastMsg = output[key].messages[output[key].messages.length - 1];
          console.log(
            `Output from node: '${key}'\n ${JSON.stringify(value, null, 2)}`,
          );

          if (
            key === "generate" ||
            (key === "agent" && this.shouldRetrieve(output[key]) === "__end__")
          ) {
            finalResponse = lastMsg.content;

            // Update the UI with intermediate results if needed
            if (this._view) {
              this._view.webview.postMessage({
                command: "updateProcessingMessage",
                text: `Processing: ${key} step complete`,
              });
            }
          }
        }
      }

      return finalResponse;
    } catch (error) {
      console.error("Error in agentic RAG workflow:", error);
      throw new Error("Failed to process with agentic RAG");
    }
  }

  // Core RAG components from the original code
  private shouldRetrieve(state: any): string {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1];

    if (
      "tool_calls" in lastMessage &&
      Array.isArray(lastMessage.tool_calls) &&
      lastMessage.tool_calls.length
    ) {
      return "retrieve";
    }
    return "__end__";
  }

  private async gradeDocuments(state: any): Promise<any> {
    const { ChatPromptTemplate } = await import("@langchain/core/prompts");
    const { ChatOpenAI } = await import("@langchain/openai");
    const { messages } = state;
    const tool = {
      name: "give_relevance_score",
      description: "Give a relevance score to the retrieved documents.",
      schema: z.object({
        binaryScore: z.string().describe("Relevance score 'yes' or 'no'"),
      }),
    };

    const prompt = ChatPromptTemplate.fromTemplate(
      `You are a grader assessing relevance of retrieved docs to a user question about Sui blockchain or Move programming language.
      Here are the retrieved docs:
      \n ------- \n
      {context}
      \n ------- \n
      Here is the user question: {question}
      If the content of the docs are relevant to the user's question about Sui Move development, score them as relevant.
      Give a binary score 'yes' or 'no' score to indicate whether the docs are relevant to the question.
      Yes: The docs are relevant to the question.
      No: The docs are not relevant to the question.`,
    );

    const model = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0,
    }).bindTools([tool], {
      tool_choice: tool.name,
    });

    const chain = prompt.pipe(model);
    const lastMessage = messages[messages.length - 1];

    const score = await chain.invoke({
      question: messages[0].content as string,
      context: lastMessage.content as string,
    });

    return {
      messages: [score],
    };
  }

  private checkRelevance(state: any): string {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1];
    if (!("tool_calls" in lastMessage)) {
      throw new Error(
        "The 'checkRelevance' node requires the most recent message to contain tool calls.",
      );
    }
    const toolCalls = lastMessage?.tool_calls;
    if (!toolCalls || !toolCalls.length) {
      throw new Error("Last message was not a function message");
    }

    if (toolCalls[0].args.binaryScore === "yes") {
      return "yes";
    }
    return "no";
  }

  private async analyzeMoveCode(state: any): Promise<any> {
    const { ChatPromptTemplate } = await import("@langchain/core/prompts");
    const { ChatOpenAI } = await import("@langchain/openai");
    const { ToolMessage } = await import("@langchain/core/messages");

    const { messages } = state;
    // Check if the user's message contains Move code
    const userMessage = messages[0].content as string;
    const containsCode =
      userMessage.includes("module") &&
      (userMessage.includes("struct") ||
        userMessage.includes("public fun") ||
        userMessage.includes("public entry fun"));

    if (!containsCode) {
      // Skip analysis if no code detected
      console.log("No Code Detected");
      return { messages };
    }

    const tool = {
      name: "code_analysis",
      description: "Analyze Move code for bugs and issues",
      schema: z.object({
        issues: z.array(z.string()).describe("List of potential issues found"),
        suggestions: z
          .array(z.string())
          .describe("List of improvement suggestions"),
      }),
    };

    const prompt = ChatPromptTemplate.fromTemplate(
      `You are an expert Sui Move code analyzer. Analyze the following Move code for bugs, security issues, and best practices:

      \`\`\`move
      {code}
      \`\`\`

      Focus on:
      1. Security vulnerabilities
      2. Logical bugs
      3. Gas optimization
      4. Sui-specific best practices
      5. Potential ownership issues
      6. Type safety issues

      Provide your analysis.`,
    );

    const model = new ChatOpenAI({
      model: "gpt-4.1",
      temperature: 0,
    }).bindTools([tool], {
      tool_choice: tool.name,
    });

    const chain = prompt.pipe(model);
    const analysis = await chain.invoke({ code: userMessage });

    // Check if the response includes tool calls
    if (analysis.tool_calls && analysis.tool_calls.length > 0) {
      // Create a ToolMessage for each tool_call
      const toolMessages = await Promise.all(
        analysis.tool_calls.map(async (toolCall: any) => {
          // Normally you would execute the tool here, but since code_analysis
          // is just returning structured data, we can create a dummy response
          const result = {
            issues: toolCall.args.issues || [],
            suggestions: toolCall.args.suggestions || [],
          };

          // Create a tool message with the result
          return new ToolMessage({
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
            name: toolCall.name,
          });
        }),
      );

      // Add the tool messages to the conversation
      return {
        messages: [analysis, ...toolMessages],
      };
    }

    return {
      messages: [analysis],
    };
  }

  private async agent(state: any): Promise<any> {
    const { ChatOpenAI } = await import("@langchain/openai");
    const { createRetrieverTool } = await import("langchain/tools/retriever");
    const { SystemMessage } = await import("@langchain/core/messages");

    const { messages } = state;
    // Filter out relevance score messages
    const filteredMessages = messages.filter((message: any) => {
      if (
        "tool_calls" in message &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0
      ) {
        return message.tool_calls[0].name !== "give_relevance_score";
      }
      return true;
    });

    const systemPrompt = `You are a Sui Move smart contract assistant, specialized in helping developers write, debug, and optimize Move code on the Sui blockchain.

      Focus areas:
      - Writing idiomatic Move code for Sui blockchain
      - Debugging compiler errors and runtime issues
      - Explaining Sui-specific concepts and patterns
      - Suggesting security best practices for Move smart contracts
      - Providing code examples that follow Sui's object-centric model

      When providing code examples, make sure they:
      - Follow Sui's ownership model (owned vs shared objects)
      - Use proper object capabilities and abilities
      - Handle errors appropriately
      - Follow gas optimization best practices

      Use your knowledge of Move and Sui to help developers create secure, efficient smart contracts.`;

    // Get retriever tool from the initialized vector store
    const retriever = this._vectorStore?.asRetriever({
      searchType: "similarity",
      k: 3,
    });

    if (!retriever) {
      throw new Error("Retriever not initialized");
    }

    const tool = createRetrieverTool(retriever, {
      name: "retrieve_sui_move_docs",
      description:
        "Search for information about Sui blockchain and Move language to help with debugging and writing smart contracts.",
    });
    const tools = [tool];

    const model = new ChatOpenAI({
      model: "gpt-4.1",
      temperature: 0,
    }).bindTools(tools, { tool_choice: "retrieve_sui_move_docs" });

    const systemMessage = new SystemMessage(systemPrompt);

    const response = await model.invoke([systemMessage, ...filteredMessages]);
    return {
      messages: [response],
    };
  }

  private async generate(state: any): Promise<any> {
    const { ChatPromptTemplate } = await import("@langchain/core/prompts");
    const { ChatOpenAI } = await import("@langchain/openai");

    const { messages } = state;
    const question = messages[0].content as string;
    // Extract the most recent ToolMessage
    const lastToolMessage = messages
      .slice()
      .reverse()
      .find((msg: any) => msg._getType() === "tool");
    if (!lastToolMessage) {
      throw new Error("No tool message found in the conversation history");
    }

    const docs = lastToolMessage.content as string;

    // Custom RAG prompt for Sui Move
    const prompt = ChatPromptTemplate.fromTemplate(
      `You are an expert Sui Move developer helping with smart contract development.

        CONTEXT INFORMATION:
        {context}

        USER QUESTION:
        {question}

        Using the context information provided and your knowledge of Sui Move development, provide a comprehensive answer to the user's question.

        If the question involves code, include clear, well-commented example code that:
        1. Follows Sui's ownership model correctly
        2. Uses appropriate abilities and type constraints
        3. Implements proper error handling
        4. Follows best practices for gas optimization
        5. Is secure by design

        If the documentation isn't sufficient to answer the question completely, be honest about limitations while providing the best possible guidance based on general Sui Move principles.`,
    );

    const llm = new ChatOpenAI({
      model: "gpt-4.1",
      temperature: 0,
    });

    const ragChain = prompt.pipe(llm);

    const response = await ragChain.invoke({
      context: docs,
      question,
    });

    return {
      messages: [response],
    };
  }

  // Original VS Code extension methods
  private addMessage(role: "user" | "assistant", content: string) {
    const message: ChatMessage = {
      role,
      content,
      timestamp: Date.now(),
    };

    this._chatHistory.push(message);
    this.saveChatHistory();
    this.updateChatWebview();
  }

  private getCurrentFileContent(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }
    return editor.document.getText();
  }

  private getCurrentFileName(): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return "No file";
    }
    return path.basename(editor.document.uri.fsPath);
  }

  private async insertCodeToEditor(code: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("No active editor found to insert code");
      return;
    }

    // Get selection or insert at cursor position
    const selection = editor.selection;

    await editor.edit((editBuilder) => {
      if (selection.isEmpty) {
        // Insert at cursor position
        editBuilder.insert(selection.active, code);
      } else {
        // Replace selected text
        editBuilder.replace(selection, code);
      }
    });

    vscode.window.showInformationMessage("Code inserted successfully");
  }

  private refreshView() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "fileChanged",
        fileName: this.getCurrentFileName(),
      });
    }
  }

  private getWebviewContent(
    context: vscode.ExtensionContext,
    webview: vscode.Webview,
  ): string {
    const htmlPath = path.join(
      context.extensionPath,
      "src",
      "media",
      "assistant.html",
    );

    // Create a basic chat interface if file doesn't exist
    let html = fs.readFileSync(htmlPath, "utf8");

    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(context.extensionPath, "src", "media", "style.css"),
      ),
    );

    // Inject the CSS link before </head> if it exists
    if (
      fs.existsSync(
        path.join(context.extensionPath, "src", "media", "style.css"),
      )
    ) {
      html = html.replace(
        "</head>",
        `<link rel="stylesheet" href="${styleUri}"/></head>`,
      );
    }

    return html;
  }

  private updateChatWebview() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "updateChat",
        messages: this._chatHistory,
      });
    }
  }

  // Helper method to extract the file state
  private async getFileState(): Promise<{
    imports: string[];
    testFunctions: TestFunction[];
    functions: MoveFunction[];
    structs: MoveStruct[];
    constants: MoveConstant[];
  }> {
    const fileContent = this.getCurrentFileContent();
    if (!fileContent) {
      return {
        imports: [],
        testFunctions: [],
        functions: [],
        structs: [],
        constants: [],
      };
    }

    const { imports, testFunctions, functions, structs, constants } =
      await parseMoveFile(this._context, fileContent);

    return { imports, testFunctions, functions, structs, constants };
  }

  // --- New Methods for Completing Function Bodies ---

  /**
   * Completes the function body of a given MoveFunction object using the agentic RAG.
   * @param moveFunction The MoveFunction object with properties describing the function.
   * @returns The updated MoveFunction object with a generated function body.
   */
  public async completeFunctionBody(
    moveFunction: MoveFunction,
    structs: MoveStruct[],
  ): Promise<String> {
    const { ChatPromptTemplate } = await import("@langchain/core/prompts");
    const { ChatOpenAI } = await import("@langchain/openai");
    const { ChatBedrockConverse } = await import("@langchain/aws");

    const prompt = ChatPromptTemplate.fromTemplate(
      `
        {structs}
        You are an expert Sui Move developer. Using the above structs as a helper, Complete the function body for the following Move function:

        Function Name: {name}
        Function Type: {type}
        Description: {description}
        Parameters: {params}
        Return Type: {returns}

        Make sure you verify certain variables and conditions before processing in the function to enhance security.
        `,
    );

    const model = new ChatOpenAI({
      model: "gpt-4.1",
      // temperature: 0,
    });

    const chain = prompt.pipe(model);
    let body =
      "let payment = Payment { id:object::new(ctx),balance: 50};\n  transfer::public_transfer(payment, tx_context::sender(ctx))";

    const response = await chain.invoke({
      name: moveFunction.name,
      type: moveFunction.type,
      description: moveFunction.description,
      params: JSON.stringify(moveFunction.params, null, 2),
      returns: moveFunction.returns,
      structs: JSON.stringify(structs, null, 2),
      body: body,
    });

    // Assume response.content holds the generated function body
    // moveFunction.body = response.content.toString();
    console.log(JSON.stringify(response, null, 2));
    return response.content.toString();
  }

  // Add this new method to the MoveAssistantView class
  async completeTestFunctionBody(
    func: TestFunction,
    structs: MoveStruct[],
  ): Promise<string | undefined> {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor found");
        return;
      }

      const document = editor.document;
      const text = document.getText();

      // Get module and function information
      // const moduleName = this.extractModuleName(text);
      const moduleName = "payments";

      // Create a prompt for the AI to generate a test function body
      const prompt = this.createTestFunctionPrompt(
        func,
        structs,
        moduleName,
        text,
      );

      // Call OpenAI API to get the test function body
      // const response = await this.callOpenAI(prompt);
      const response = "";

      if (response) {
        return response;
      } else {
        vscode.window.showErrorMessage("Failed to generate test function");
        return undefined;
      }
    } catch (error) {
      console.error("Error generating test function body:", error);
      vscode.window.showErrorMessage(
        `Error generating test function: ${error}`,
      );
      return undefined;
    }
  }

  // Add this helper method for creating test function prompts
  private createTestFunctionPrompt(
    func: TestFunction,
    structs: MoveStruct[],
    moduleName: string,
    sourceCode: string,
  ): string {
    // Format parameters for the prompt
    const formattedParams = func.params
      .map((p) => `${p.name}: ${p.type}`)
      .join(", ");

    // Get struct definitions for context
    const structsContext = structs
      .map(
        (s) =>
          `struct ${s.name} { ${s.fields
            .map((f) => `${f.name}: ${f.type}`)
            .join(", ")} }`,
      )
      .join("\n");

    // Create a prompt for generating a test function
    return `
You are an AI assistant specializing in Move language for Sui blockchain. 
I need you to generate a test function body for the following Move test function.

Module name: ${moduleName}

Current module code:
\`\`\`
${sourceCode}
\`\`\`

Struct definitions:
\`\`\`
${structsContext}
\`\`\`

Test function signature:
\`\`\`
#[test]
fun ${func.name}(${formattedParams}) {
  // TODO: Implement test
}
\`\`\`

Test function description: ${func.description || "No description provided"}

Please write a comprehensive test function body for this signature. Focus on:
1. Testing the module's functionality with various scenarios
2. Proper usage of test_scenario for Move testing
3. Include assertions to validate expected behavior
4. Follow Move testing best practices
5. Only return the complete test function with body, no explanations

Return the complete function with the body filled in.
`;
  }

  private updateWebviewProcessingState(isProcessing: boolean) {
    if (this._view) {
      this._view.webview.postMessage({
        command: "setProcessingState",
        isProcessing,
      });
    }
  }

  private sendChatHistory() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "updateChat",
        messages: this._chatHistory,
      });
    }
  }

  private saveChatHistory() {
    // Limit history to last 100 messages to prevent storage issues
    if (this._chatHistory.length > 100) {
      this._chatHistory = this._chatHistory.slice(-100);
    }
    this._context.globalState.update(this._storageKey, this._chatHistory);
  }

  private loadSavedHistory() {
    const savedHistory = this._context.globalState.get<ChatMessage[]>(
      this._storageKey,
    );
    if (savedHistory) {
      this._chatHistory = savedHistory;
    }
  }

  private clearChatHistory() {
    this._chatHistory = [];
    this.saveChatHistory();
    this.updateChatWebview();
    vscode.window.showInformationMessage("Chat history cleared", {
      modal: false,
    });
  }

  // Clean up resources when the extension is deactivated
  public dispose() {
    if (this._mongoClient) {
      this._mongoClient.close().catch(console.error);
    }
  }
}
