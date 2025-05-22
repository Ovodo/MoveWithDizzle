# MoveWithDizzle VS Code Extension

## 🚀 Features

### 1. Move Smart Contract Authoring
- **Syntax Highlighting**: Write Move code with full syntax highlighting.
- **Struct, Function, Constant, and Import Management**: Add, edit, and delete Move structs, functions, constants, and imports using intuitive webviews.
- **Test Function Management**: Create and manage test functions in your Move modules.

### 2. AI-Powered Assistant
- **Chat Assistant**: Access a sidebar chat powered by GPT-4.1 for Move and Sui development help.
- **RAG (Retrieval-Augmented Generation)**: The assistant can search your own Move documentation and codebase for contextually relevant answers.
- **Code Analysis**: Paste or reference code in chat to get security, best-practices, and bug analysis.
- **Function Completion**: Auto-complete function bodies using AI, with context from your structs and module.

### 3. Formatting & Refactoring
- **Format on Save**: Automatically formats your Move files on save, preserving comments and code structure.
- **Consistent Section Headings**: All code sections (imports, structs, functions, etc.) are clearly separated with stylized comments.

### 4. MongoDB Vector Search Integration
- **Semantic Search**: Uses MongoDB Atlas Vector Search to power RAG and code/document search.
- **Custom Data Ingestion**: Ingest your own Move docs and tutorials into the vector database for smarter answers.

### 5. Rich Webviews
- **Visual Editors**: Use web-based forms to add/edit functions, structs, constants, and imports.
- **Live Preview**: See your changes reflected in the code immediately.

---

## 🛠️ How to Use

### 1. Getting Started
- **Install the Extension** Clone the repo and press f5 to open the extension Host .
- **Open a Move Project** create a new one / optionally paste an already existing code.
- **Open the Side Panel**: Click the MoveWithDizzle icon in the Activity Bar.

### 2. Managing Code
- **Functions, Structs, Constants, Imports**:  
  Use the respective sidebar views to add, edit, or delete items.  
  - Click “Add Function” or “Edit” to open a form.
  - Fill in details and submit.  
  - The extension updates your `.move` file.

- **Test Functions**:  
  Use the “Tests” view to manage test functions.  
  - Add test functions with descriptions and parameters.
  - The extension places them in the correct test module.

### 3. AI Assistant
- **Open the Assistant**:  
  - Go to the “Move Assistant” view.
  - Type your question or paste code.
  - The assistant can answer Move/Sui questions, analyze code, and help with debugging.

- **Function Completion**:  
  - In the Functions view, click “Complete Function Body” to let the AI generate a function body based on your struct and parameter context.

---

## 💡 Tips

- **Section Headings**:  
  Each section (imports, structs, functions, etc.) is clearly marked with stylized comments for easy navigation.
- **Live Reload**:  
  The extension listens for file saves and updates the sidebar views automatically.

---

## 🧑‍🏫 Example Workflow

1. **Add a Struct**:  
   Go to the “Structs” view, click “Add Struct”, fill in fields, and submit.

2. **Add a Function**:  
   Go to the “Functions” view, click “Add Function”, fill in details, and submit.

3. **Use the Assistant**:  
   Open the “Move Assistant” view, ask a question, or paste code for analysis.

4. **Format Your File**:  
   Save your `.move` file.

---

## 🛡️ Troubleshooting

- **MongoDB Connection Issues**:  
  Make sure your MongoDB URI and credentials are correct. Check the output panel for errors.

- **Formatting Not Working**:  
  Ensure the extension is set as the default formatter for Move files in your VS Code settings.

- **AI Assistant Not Responding**:  
  Check your internet connection and OpenAI API key (if required).

---

## 📝 Feedback & Contributions

- Found a bug or have a feature request?  
  Open an issue or pull request on [GitHub](https://github.com/ovodo/movewithdizzle).

---

## Note on AI/Agentic RAG

The AI/agentic RAG feature will currently not work properly because there is no OpenAI API key or MongoDB URL string configured. This feature will be deployed with the application when hosting on the VS Code Marketplace. You can set your own OpenAI key and MongoDB URL for now, but the database will not contain the current context used by the RAG. Further progress is still to be done on this feature before deployment.

---

**Enjoy building with Move and Sui! 🚀**
