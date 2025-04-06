// import dotenv from "dotenv";
// dotenv.config();

// import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
// import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
// import { OpenAIEmbeddings } from "@langchain/openai";
// import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
// import { MongoClient } from "mongodb";

// async function ingestData() {
//   // MongoDB Connection - Update with your connection details
//   const mongoUrl =
//     process.env.MONGODB_URI ||
//     "mongodb+srv://username:password@cluster.mongodb.net/";
//   const dbName = process.env.MONGODB_DBNAME || "move_book_db";
//   const collectionName = process.env.MONGODB_COLLECTION || "vector_documents";
//   const indexName = process.env.MONGODB_INDEX_NAME || "vector_index";

//   // Connect to MongoDB
//   console.log("Connecting to MongoDB...");
//   const client = new MongoClient(mongoUrl);
//   await client.connect();
//   console.log("Connected to MongoDB successfully");

//   const db = client.db(dbName);
//   const collection = db.collection(collectionName);

//   // Define URLs to scrape
//   const urls = [
//     "https://move-book.com/before-we-begin/install-sui",
//     "https://move-book.com/before-we-begin/ide-support.html",
//     "https://move-book.com/your-first-move/hello-world.html",
//     "https://move-book.com/your-first-move/hello-sui.html",
//     "https://move-book.com/concepts/packages.html",
//     "https://move-book.com/concepts/manifest.html",
//     "https://move-book.com/concepts/address.html",
//     "https://move-book.com/concepts/what-is-an-account.html",
//     "https://move-book.com/concepts/what-is-a-transaction.html",
//     "https://move-book.com/move-basics/module.html",
//     "https://move-book.com/move-basics/comments.html",
//     "https://move-book.com/move-basics/primitive-types.html",
//     "https://move-book.com/move-basics/address.html",
//     "https://move-book.com/move-basics/expression.html",
//     "https://move-book.com/move-basics/struct.html",
//     "https://move-book.com/move-basics/abilities-introduction.html",
//     "https://move-book.com/move-basics/drop-ability.html",
//     "https://move-book.com/move-basics/importing-modules.html",
//     "https://move-book.com/move-basics/standard-library.html",
//     "https://move-book.com/move-basics/vector.html",
//     "https://move-book.com/move-basics/option.html",
//     "https://move-book.com/move-basics/string.html",
//     "https://move-book.com/move-basics/control-flow.html",
//     "https://move-book.com/move-basics/constants.html",
//     "https://move-book.com/move-basics/assert-and-abort.html",
//     "https://move-book.com/move-basics/function.html",
//     "https://move-book.com/move-basics/struct-methods.html",
//     "https://move-book.com/move-basics/visibility.html",
//     "https://move-book.com/move-basics/ownership-and-scope.html",
//     "https://move-book.com/move-basics/copy-ability.html",
//     "https://move-book.com/move-basics/references.html",
//     "https://move-book.com/move-basics/generics.html",
//     "https://move-book.com/move-basics/type-reflection.html",
//     "https://move-book.com/move-basics/testing.html",
//     "https://move-book.com/object/digital-assets.html",
//     "https://move-book.com/object/evolution-of-move.html",
//     "https://move-book.com/object/object-model.html",
//     "https://move-book.com/object/ownership.html",
//     "https://move-book.com/object/fast-path-and-consensus.html",
//     "https://move-book.com/storage/key-ability.html",
//     "https://move-book.com/storage/storage-functions.html",
//     "https://move-book.com/storage/store-ability.html",
//     "https://move-book.com/storage/uid-and-id.html",
//     "https://move-book.com/storage/transfer-restrictions.html",
//     "https://move-book.com/programmability/transaction-context.html",
//     "https://move-book.com/programmability/module-initializer.html",
//     "https://move-book.com/programmability/capability.html",
//     "https://move-book.com/programmability/epoch-and-time.html",
//     "https://move-book.com/programmability/collections.html",
//     "https://move-book.com/programmability/wrapper-type-pattern.html",
//     "https://move-book.com/programmability/dynamic-fields.html",
//     "https://move-book.com/programmability/dynamic-object-fields.html",
//     "https://move-book.com/programmability/dynamic-collections.html",
//     "https://move-book.com/programmability/witness-pattern.html",
//     "https://move-book.com/programmability/one-time-witness.html",
//     "https://move-book.com/programmability/publisher.html",
//     "https://move-book.com/programmability/display.html",
//     "https://move-book.com/programmability/events.html",
//     "https://move-book.com/programmability/sui-framework.html",
//     "https://move-book.com/programmability/hot-potato-pattern.html",
//     "",
//     "",
//     "",
//     "",
//   ];

//   console.log(`Loading ${urls.filter((url) => url).length} URLs...`);

//   // Load and process documents
//   const docs = await Promise.all(
//     urls
//       .filter((url) => url) // Filter out empty URLs
//       .map((url) => new CheerioWebBaseLoader(url).load())
//   );
//   const docsList = docs.flat();
//   console.log(`Loaded ${docsList.length} documents`);

//   // Split documents into chunks
//   const textSplitter = new RecursiveCharacterTextSplitter({
//     chunkSize: 1000,
//     chunkOverlap: 100,
//   });
//   const docSplits = await textSplitter.splitDocuments(docsList);
//   console.log(`Split into ${docSplits.length} chunks`);

//   // Create embeddings and store in MongoDB
//   console.log("Creating vector store...");
//   const vectorStore = await MongoDBAtlasVectorSearch.fromDocuments(
//     docSplits,
//     new OpenAIEmbeddings(),
//     {
//       collection,
//       indexName,
//       textKey: "text",
//       embeddingKey: "embedding",
//     }
//   );

//   console.log(
//     `Successfully stored ${docSplits.length} document chunks in MongoDB Atlas`
//   );

//   // Optional: Create a simple test query to verify everything works
//   const testQuery = "Write an example struct of a payment receipt in sui Move.";
//   console.log(`Running test query: "${testQuery}"`);
//   const results = await vectorStore.similaritySearch(testQuery, 2);
//   console.log("Test query results:", results);

//   await client.close();
//   console.log("MongoDB connection closed");
//   return vectorStore;
// }

// // Run the ingestion
// ingestData()
//   .then(() => {
//     console.log("Data ingestion complete!");
//     process.exit(0);
//   })
//   .catch((error) => {
//     console.error("Error during data ingestion:", error);
//     process.exit(1);
//   });

console.log("hello");
