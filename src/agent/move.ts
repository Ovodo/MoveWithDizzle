import * as dotenv from "dotenv";
dotenv.config();

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { MongoClient } from "mongodb";
import { Annotation } from "@langchain/langgraph";
import { END } from "@langchain/langgraph";
import { pull } from "langchain/hub";
import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { StateGraph, START } from "@langchain/langgraph";
import { createRetrieverTool } from "langchain/tools/retriever";
import { ToolNode } from "@langchain/langgraph/prebuilt";

// MongoDB connection details
const mongoUrl =
  process.env.MONGODB_URI ||
  "mongodb+srv://username:password@cluster.mongodb.net/";
const dbName = process.env.MONGODB_DBNAME || "move_book_db";
const collectionName = process.env.MONGODB_COLLECTION || "vector_documents";
const indexName = process.env.MONGODB_INDEX_NAME || "vector_index";

async function setupMongoVectorStore() {
  console.log("Connecting to MongoDB...");
  const client = new MongoClient(mongoUrl);
  await client.connect();
  console.log("Connected to MongoDB successfully");

  const db = client.db(dbName);
  const collection = db.collection(collectionName);

  // Initialize the vector store with the existing MongoDB collection
  const vectorStore = new MongoDBAtlasVectorSearch(
    new OpenAIEmbeddings({ model: "text-embedding-3-large" }),
    {
      collection,
      indexName,
      textKey: "text",
      embeddingKey: "embedding",
    }
  );

  console.log("MongoDB Vector Store initialized successfully");
  return { vectorStore, client };
}

// Set up MongoDB and get vector store once
const { vectorStore, client } = await setupMongoVectorStore();

// Create a retriever
const retriever = vectorStore.asRetriever({
  searchType: "similarity",
  k: 3,
});

const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
});
// Create tools
const tool = createRetrieverTool(retriever, {
  name: "retrieve_sui_move_docs",
  description:
    "Search for information about Sui blockchain and Move language to help with debugging and writing smart contracts.",
});
const tools = [tool];

const toolNode = new ToolNode<typeof GraphState.State>(tools);

/**
 * Decides whether the agent should retrieve more information or end the process.
 */
function shouldRetrieve(state: typeof GraphState.State): string {
  const { messages } = state;
  console.log("---DECIDE TO RETRIEVE---");
  const lastMessage = messages[messages.length - 1];

  if (
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls.length
  ) {
    console.log("---RETRIEVE---");
    return "retrieve";
  }
  // If there are no tool calls then we finish.
  console.log("---NOT RETRIEVE---");
  return END;
  // return "restrieve";
}

/**
 * Determines whether the Agent should continue based on the relevance of retrieved documents.
 */
async function gradeDocuments(
  state: typeof GraphState.State
): Promise<Partial<typeof GraphState.State>> {
  console.log("---GET RELEVANCE---");

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
    No: The docs are not relevant to the question.`
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

/**
 * Check the relevance of the previous LLM tool call.
 */
function checkRelevance(state: typeof GraphState.State): string {
  console.log("---CHECK RELEVANCE---");

  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  if (!("tool_calls" in lastMessage)) {
    throw new Error(
      "The 'checkRelevance' node requires the most recent message to contain tool calls."
    );
  }
  const toolCalls = (lastMessage as AIMessage).tool_calls;
  if (!toolCalls || !toolCalls.length) {
    throw new Error("Last message was not a function message");
  }

  if (toolCalls[0].args.binaryScore === "yes") {
    console.log("---DECISION: DOCS RELEVANT---");
    return "yes";
  }
  console.log("---DECISION: DOCS NOT RELEVANT---");
  return "no";
}

/**
 * Analyze Move code for potential bugs and issues
 */
async function analyzeMoveCode(
  state: typeof GraphState.State
): Promise<Partial<typeof GraphState.State>> {
  console.log("---ANALYZING MOVE CODE---");

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
    console.log("---NO CODE FOUND---");
    return { messages };
  }

  console.log("---ANALYZING---");
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

      Provide your analysis.`
  );

  const model = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0,
  }).bindTools([tool], {
    tool_choice: tool.name,
  });

  const chain = prompt.pipe(model);
  const analysis = await chain.invoke({ code: userMessage });

  return {
    messages: [analysis],
  };
}

/**
 * Invokes the agent model to generate a response based on the current state.
 */
async function agent(
  state: typeof GraphState.State
): Promise<Partial<typeof GraphState.State>> {
  console.log("---CALL AGENT---");

  const { messages } = state;
  // Filter out relevance score messages
  const filteredMessages = messages.filter((message) => {
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

  const model = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0,
    streaming: true,
  }).bindTools(tools, { tool_choice: "retrieve_sui_move_docs" });

  const systemMessage = new SystemMessage(systemPrompt);

  const response = await model.invoke([systemMessage, ...filteredMessages]);
  return {
    messages: [response],
  };
}

/**
 * Transform the query to produce a better question for Move/Sui development.
 */
async function rewrite(
  state: typeof GraphState.State
): Promise<Partial<typeof GraphState.State>> {
  console.log("---TRANSFORM QUERY---");

  const { messages } = state;
  const question = messages[0].content as string;
  const prompt = ChatPromptTemplate.fromTemplate(
    `As a Sui Move expert, analyze this question and rewrite it to better capture the technical details needed for a precise answer about Sui blockchain or Move programming language.

      Original question:
      \n ------- \n
      {question}
      \n ------- \n

      Think about:
      1. What specific Sui Move concepts might be involved?
      2. Is this about object ownership, abilities, or other Move-specific features?
      3. What technical details might be missing from the original question?

      Rewrite the question to be more precise and technical, focusing on Sui Move development:`
  );

  const model = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0,
    streaming: true,
  });
  const response = await prompt.pipe(model).invoke({ question });
  return {
    messages: [response],
  };
}

/**
 * Generate answer with code examples for Sui Move
 */
async function generate(
  state: typeof GraphState.State
): Promise<Partial<typeof GraphState.State>> {
  console.log("---GENERATE---");

  const { messages } = state;
  const question = messages[0].content as string;
  // Extract the most recent ToolMessage
  const lastToolMessage = messages
    .slice()
    .reverse()
    .find((msg) => msg._getType() === "tool");
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

      If the documentation isn't sufficient to answer the question completely, be honest about limitations while providing the best possible guidance based on general Sui Move principles.`
  );

  const llm = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0,
    streaming: true,
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

async function runSuiMoveAssistant() {
  // Define the graph
  const workflow = new StateGraph(GraphState)
    .addNode("agent", agent)
    .addNode("retrieve", toolNode)
    .addNode("gradeDocuments", gradeDocuments)
    .addNode("rewrite", rewrite)
    .addNode("generate", generate)
    .addNode("analyzer", analyzeMoveCode);

  // Start with code analysis if applicable
  workflow.addEdge(START, "analyzer");

  // Then move to main agent
  workflow.addEdge("analyzer", "agent");

  // Decide whether to retrieve
  workflow.addConditionalEdges("agent", shouldRetrieve);

  workflow.addEdge("retrieve", "gradeDocuments");

  // Edges taken after grading documents
  workflow.addConditionalEdges("gradeDocuments", checkRelevance, {
    yes: "generate",
    no: END,
  });

  workflow.addEdge("generate", END);
  workflow.addEdge("rewrite", "agent");

  // Compile
  const app = workflow.compile();

  // Example Move question
  const inputs = {
    messages: [
      new HumanMessage(
        "How do I create a marketplace in Move on Sui blockchain?"
      ),
    ],
  };

  let finalState;
  for await (const output of await app.stream(inputs)) {
    for (const [key, value] of Object.entries(output)) {
      const lastMsg = output[key].messages[output[key].messages.length - 1];
      console.log(`Output from node: '${key}'\n`);
      continue;

      console.dir(
        {
          type: lastMsg._getType(),
          content: lastMsg.content,
          tool_calls: lastMsg.tool_calls,
        },
        { depth: null }
      );
      console.log("---\n");
      finalState = value;
    }
  }

  console.log(JSON.stringify(finalState, null, 2));

  // Close MongoDB connection
  await client.close();
  console.log("MongoDB connection closed");
  return finalState;
}

// Interactive mode function
async function startInteractiveMode() {
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n===================================");
  console.log("🚀 SUI MOVE ASSISTANT INTERACTIVE MODE 🚀");
  console.log("===================================");
  console.log(
    "Ask questions about Sui Move development or paste code for analysis."
  );
  console.log("Type 'exit' to quit.");
  console.log("===================================\n");

  // Create the workflow once
  const workflow = new StateGraph(GraphState)
    .addNode("agent", agent)
    .addNode("retrieve", new ToolNode<typeof GraphState.State>(tools))
    .addNode("gradeDocuments", gradeDocuments)
    .addNode("rewrite", rewrite)
    .addNode("generate", generate)
    .addNode("analyzeMoveCode", analyzeMoveCode);

  workflow.addEdge(START, "analyzeMoveCode");
  workflow.addEdge("analyzeMoveCode", "agent");
  workflow.addConditionalEdges("agent", shouldRetrieve);
  workflow.addEdge("retrieve", "gradeDocuments");
  workflow.addConditionalEdges("gradeDocuments", checkRelevance, {
    yes: "generate",
    no: END,
  });
  workflow.addEdge("generate", END);
  workflow.addEdge("rewrite", "agent");

  const app = workflow.compile();

  async function processUserInput(userInput: string) {
    const inputs = {
      messages: [new HumanMessage(userInput)],
    };

    let finalResponse = "";
    for await (const output of await app.stream(inputs)) {
      for (const [key, value] of Object.entries(output)) {
        const lastMsg = output[key].messages[output[key].messages.length - 1];
        if (
          key === "generate" ||
          (key === "agent" && shouldRetrieve(output[key]) === END)
        ) {
          finalResponse = lastMsg.content;
        }
      }
    }
    return finalResponse;
  }

  const askQuestion = async () => {
    rl.question("\n👉 ", async (userInput: string) => {
      if (userInput.toLowerCase() === "exit") {
        await client.close();
        console.log("\nThank you for using the Sui Move Assistant! Goodbye.");
        rl.close();
        process.exit(0);
      }

      console.log("\nProcessing your question...");
      try {
        const response = await processUserInput(userInput);
        console.log("\n🤖 Assistant:\n");
        console.log(response);
        askQuestion();
      } catch (error) {
        console.error("Error processing your question:", error);
        askQuestion();
      }
    });
  };

  askQuestion();
}

// Choose mode and run
const args = process.argv.slice(2);
if (args.includes("--interactive") || args.includes("-i")) {
  startInteractiveMode();
} else {
  runSuiMoveAssistant()
    .then(() => {
      console.log("Sui Move Assistant execution complete!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Error during execution:", error);
      process.exit(1);
    });
}
