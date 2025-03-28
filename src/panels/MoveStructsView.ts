import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

interface StructField {
  name: string;
  type: string;
}

interface MoveStruct {
  name: string;
  abilities: string[];
  fields: StructField[];
}

export class MoveStructsView implements vscode.WebviewViewProvider {
  public static readonly viewType = "moveAssistant.structs";
  private _view?: vscode.WebviewView;
  private _structs: MoveStruct[] = [];
  private _storageKey = "moveAssistant.savedStructs";

  constructor(private readonly _context: vscode.ExtensionContext) {
    // Load saved structs on initialization
    this.loadSavedStructs();
    // Listen for file save events
    vscode.workspace.onDidSaveTextDocument((document) => {
      console.log("File saved:", document.fileName);
      if (document === vscode.window.activeTextEditor?.document) {
        this.refreshView(); // Refresh when the active file is saved
      }
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    const currentFile = vscode.window.activeTextEditor?.document.uri.fsPath;

    if (!currentFile) {
      webviewView.webview.html = "<h3>Please start a contract first.</h3>";
      return;
    }

    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this._context.extensionPath, "media")),
      ],
    };

    // Load existing structs from the file
    this._structs = this.extractStructsFromFile();

    // Send extracted structs to the webview
    this.sendInitialStructs();

    // Set webview HTML with full struct creation interface
    webviewView.webview.html = this.getWebviewContent();
    this.refreshView();

    webviewView.webview.onDidReceiveMessage(
      (message) => {
        console.log("Received message:", message);
        switch (message.command) {
          case "createStruct":
            console.log("Creawtings struct:", message.name.length);
            // console.log("Creating struct:", message.struct);
            this.createStruct(message.struct);
            return;
          case "editStruct":
            console.log("Editing struct:", message.name.length);
            this.editStruct(message.struct);
            return;
          case "requestDeleteStruct":
            vscode.window
              .showWarningMessage(
                `Are you sure you want to delete struct "${message.structName}"?`,
                { modal: true },
                "Delete"
              )
              .then((selection) => {
                if (selection === "Delete") {
                  this.deleteStruct(message.structName);
                }
              });
            return;
          case "deleteStruct":
            console.log("Deleting struct:", message.structName);
            this.deleteStruct(message.structName);
            return;
          case "loadInitialStructs":
            console.log("Loading initial structs");
            this.sendInitialStructs();
            return;
          default:
            console.log("Unknown command:", message.command);
        }
      },
      undefined,
      this._context.subscriptions
    );
  }

  private sendInitialStructs() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "initialStructs",
        structs: this._structs,
      });
    }
  }

  private refreshView() {
    this._structs = this.extractStructsFromFile();
    this.sendInitialStructs();
  }

  private getWebviewContent(): string {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Move Structs</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 10px; }
            .struct-form { 
              display: flex;
              flex-direction: column;
              gap: 10px; 
              margin-bottom: 20px; 
              border: 1px solid #ddd; 
              padding: 15px; 
              border-radius: 5px; 
            }
            .field-row { display: flex; gap: 10px; width: 100%; margin-bottom: 5px; }
            .field-name { width: 50%; }
            .struct-list { margin-top: 20px; }
            button { cursor: pointer; margin-right: 5px; }
            #structList details { margin-bottom: 10px; }
            .struct-actions { display: flex; margin-top: 10px; }
          </style>
        </head>
        <body>
          <h2>Move Struct Creator</h2>
          
          <form id="structForm" class="struct-form">
            <input type="text" id="structName" placeholder="Struct Name" required>
            <input type="hidden" id="originalStructName" value="">
            
            <div>
              <label>Abilities:</label>
              <div>
                <input type="checkbox" id="store" name="ability" value="store">
                <label for="store">store</label>
                <input type="checkbox" id="key" name="ability" value="key">
                <label for="key">key</label>
                <input type="checkbox" id="copy" name="ability" value="copy">
                <label for="copy">copy</label>
                <input type="checkbox" id="drop" name="ability" value="drop">
                <label for="drop">drop</label>
              </div>
            </div>
            
            <div id="fieldsContainer">
              <div class="field-row">
                <input type="text" class="field-name" placeholder="Field Name" required>
                <select class="field-type">
                  <!-- Default types -->
                  <option value="u64">u64</option>
                  <option value="u8">u8</option>
                  <option value="u128">u128</option>
                  <option value="address">address</option>
                  <option value="bool">bool</option>
                  <option value="vector">vector</option>
                </select>
                <button type="button" onclick="addField()">+</button>
              </div>
            </div>
            
            <button type="submit" id="submitButton">Create Struct</button>
            <button type="button" id="cancelEditButton" style="display:none;">Cancel Edit</button>
          </form>
  
          <div class="struct-list" id="structList">
            <h3>Saved Structs</h3>
            <!-- Structs will be dynamically populated here -->
          </div>
  
          <script>
            const vscode = acquireVsCodeApi();
            const persistedState = vscode.getState() || { structs: [] };
  
            // Default type options
            const defaultTypes = [
              { value: "u64", label: "u64" },
              { value: "u8", label: "u8" },
              { value: "u128", label: "u128" },
              { value: "address", label: "address" },
              { value: "bool", label: "bool" },
              { value: "vector", label: "vector" }
            ];
  
            // Populate each select.field-type with default options and existing struct names
            function populateTypeOptions(existingStructs) {
              // Create additional options from existing structs (if any)
              const structOptions = existingStructs.map(s => ({ value: s.name, label: s.name }));
              // Merge default options and struct options (avoid duplicates)
              const allOptions = [...defaultTypes];
              structOptions.forEach(opt => {
                if (!allOptions.find(o => o.value === opt.value)) {
                  allOptions.push(opt);
                }
              });
  
              document.querySelectorAll("select.field-type").forEach(select => {
                const currentValue = select.value;
                select.innerHTML = "";
                allOptions.forEach(opt => {
                  const optionEl = document.createElement("option");
                  optionEl.value = opt.value;
                  optionEl.textContent = opt.label;
                  if (currentValue === opt.value) {
                    optionEl.selected = true;
                  }
                  select.appendChild(optionEl);
                });
              });
            }
  
            function addField() {
              const container = document.getElementById('fieldsContainer');
              const newFieldRow = document.createElement('div');
              newFieldRow.className = 'field-row';
              newFieldRow.innerHTML = \`
                <input type="text" class="field-name" placeholder="Field Name" required>
                <select class="field-type">
                  <!-- Options will be populated by populateTypeOptions -->
                </select>
                <button type="button" onclick="this.parentElement.remove()">-</button>
              \`;
              container.appendChild(newFieldRow);
              // Re-populate type options after adding new row
              populateTypeOptions(persistedState.structs || []);
            }
  
            function resetForm() {
              document.getElementById('structName').value = '';
              document.getElementById('originalStructName').value = '';
              document.querySelectorAll('input[name="ability"]:checked').forEach(checkbox => checkbox.checked = false);
              const fieldsContainer = document.getElementById('fieldsContainer');
              fieldsContainer.innerHTML = \`
                <div class="field-row">
                  <input type="text" class="field-name" placeholder="Field Name" required>
                  <select class="field-type">
                    <!-- Options will be populated -->
                  </select>
                  <button type="button" onclick="addField()">+</button>
                </div>
              \`;
              // Populate type options in the reset row
              populateTypeOptions(persistedState.structs || []);
              document.getElementById('submitButton').textContent = 'Create Struct';
              document.getElementById('cancelEditButton').style.display = 'none';
            }
  
            document.getElementById('cancelEditButton').addEventListener('click', resetForm);
  
            // Create new struct (default operation)
            function createStruct() {
              const structName = document.getElementById('structName').value;
              const capitalizedStructName = structName.charAt(0).toUpperCase() + structName.slice(1);
              const abilities = Array.from(document.querySelectorAll('input[name="ability"]:checked'))
                .map(checkbox => checkbox.value);
              
              const fields = Array.from(document.querySelectorAll('#fieldsContainer .field-row'))
                .filter(row => row.querySelector('.field-name') && row.querySelector('.field-type'))
                .map(row => ({
                  name: row.querySelector('.field-name').value,
                  type: row.querySelector('.field-type').value
                }));
  
              const struct = { name: capitalizedStructName, abilities, fields };
  
              vscode.postMessage({
                command: 'createStruct',
                struct: struct
              });
  
              resetForm();
            }
  
            // Update existing struct
            function updateStruct() {
              const structName = document.getElementById('structName').value;
              const originalStructName = document.getElementById('originalStructName').value;
              const abilities = Array.from(document.querySelectorAll('input[name="ability"]:checked'))
                .map(checkbox => checkbox.value);
              
              const fields = Array.from(document.querySelectorAll('#fieldsContainer .field-row'))
                .filter(row => row.querySelector('.field-name') && row.querySelector('.field-type'))
                .map(row => ({
                  name: row.querySelector('.field-name').value,
                  type: row.querySelector('.field-type').value
                }));
  
              const struct = { name: structName, abilities, fields };
  
              vscode.postMessage({
                command: 'editStruct',
                struct: struct,
                name: originalStructName
              });
  
              resetForm();
            }
  
            // Override form submit behavior with onClick for the button
            document.getElementById('submitButton').onclick = function(e) {
              e.preventDefault();
              const originalStructName = document.getElementById('originalStructName').value;
              if (originalStructName) {
                updateStruct();
              } else {
                createStruct();
              }
            };
  
            // Handle incoming messages to update struct list and repopulate type options
            window.addEventListener('message', event => {
              const message = event.data;
              if (message.command === 'updateStructList' || message.command === 'initialStructs') {
                updateStructList(message.structs);
              }
            });
  
            function updateStructList(structs) {
              // Update persisted state so we have the latest structs for type options
              persistedState.structs = structs;
              const structList = document.getElementById('structList');
              structList.innerHTML = '<h3>Saved Structs</h3>';
              structs.forEach(struct => {
                const structItem = document.createElement('details');
                structItem.innerHTML = \`
                  <summary>\${struct.name}</summary>
                  <p><strong>Abilities:</strong> \${struct.abilities.join(', ') || 'None'}</p>
                  <p><strong>Fields:</strong></p>
                  <ul>
                    \${struct.fields.map(field => \`<li>\${field.name}: \${field.type}</li>\`).join('')}
                  </ul>
                  <div class="struct-actions">
                    <button onclick="editStruct('\${struct.name}')">Edit</button>
                    <button class="delete-button" onclick="deleteStruct('\${struct.name}')">Delete</button>
                  </div>
                \`;
                structList.appendChild(structItem);
              });
  
              // Re-populate type options for all select elements with updated structs
              populateTypeOptions(structs);
              vscode.setState({ structs });
            }
  
            function editStruct(structName) {
              const struct = vscode.getState().structs.find(s => s.name === structName);
              if (struct) {
                // Uncheck all ability checkboxes first
                document.querySelectorAll('input[name="ability"]').forEach(checkbox => {
                  checkbox.checked = false;
                });
  
                // Populate form with struct details
                document.getElementById('structName').value = struct.name;
                document.getElementById('originalStructName').value = struct.name;
  
                // Set abilities
                struct.abilities.forEach(ability => {
                  const checkbox = document.getElementById(ability);
                  if (checkbox) checkbox.checked = true;
                });
  
                // Clear existing fields
                const fieldsContainer = document.getElementById('fieldsContainer');
                fieldsContainer.innerHTML = '';
                
                // Add fields for the struct
                struct.fields.forEach((field) => {
                  const newFieldRow = document.createElement('div');
                  newFieldRow.className = 'field-row';
                  newFieldRow.innerHTML = \`
                    <input type="text" class="field-name" placeholder="Field Name" value="\${field.name}" required>
                    <select class="field-type">
                    </select>
                    <button type="button" onclick="this.parentElement.remove()">-</button>
                  \`;
                  fieldsContainer.appendChild(newFieldRow);
                });
                
                // Add new field button
                const addFieldButton = document.createElement('div');
                addFieldButton.className = 'field-row';
                addFieldButton.innerHTML = \`
                  <button type="button" onclick="addField()">+</button>
                \`;
                fieldsContainer.appendChild(addFieldButton);
  
                // Populate the select options for these new field rows
                populateTypeOptions(vscode.getState().structs);
  
                // Change submit button text and show cancel button
                document.getElementById('submitButton').textContent = 'Update Struct';
                document.getElementById('submitButton').onclick = function(e) {
                  e.preventDefault();
                  updateStruct();
                };
                document.getElementById('cancelEditButton').style.display = 'inline-block';
              }
            }
  
            function deleteStruct(structName) {
              vscode.postMessage({
                command: "requestDeleteStruct",
                structName: structName
              });
            }
  
            // Request initial structs when view loads
            vscode.postMessage({
              command: 'loadInitialStructs'
            });
          </script>
        </body>
        </html>
      `;
  }

  private updateMoveFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const document = editor.document;
    let text = document.getText();

    // Step 1: Remove all structs that no longer exist in this._structs
    text = text.replace(
      /(?:public\s+)?struct\s+(\w+)\s*(?:has\s+((?:key|store|copy|drop)(?:\s*,\s*(?:key|store|copy|drop))*))?\s*{[^}]*}/g,
      (match, structName) => {
        return this._structs.some((s) => s.name === structName) ? match : "";
      }
    );

    // Step 2: Remove extra blank lines caused by deletion
    text = text.replace(/\n\s*\n/g, "\n").trim();

    // Step 3: Update or add structs that exist in this._structs
    this._structs.forEach((struct) => {
      const structRegex = new RegExp(
        `(?:public\\s+)?struct\\s+${struct.name}\\s*(?:has\\s+(?:key|store|copy|drop)(?:\\s*,\\s*(?:key|store|copy|drop))*)?\\s*{[^}]*}`,
        "g"
      );

      const abilitiesString =
        struct.abilities.length > 0
          ? `has ${struct.abilities.join(", ")} `
          : "";

      const newStructText =
        `public struct ${struct.name} ${abilitiesString}{\n` +
        struct.fields.map((f) => `  ${f.name}: ${f.type},`).join("\n") +
        `\n}`;

      if (text.match(structRegex)) {
        text = text.replace(structRegex, newStructText);
      } else {
        text += `\n\n${newStructText}`;
      }
    });

    // Apply changes to the editor
    editor.edit((editBuilder) => {
      const all = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      editBuilder.replace(all, text);
    });
  }

  private createStruct(struct: MoveStruct) {
    console.log(this._structs, "structs");

    const existingStructIndex = this._structs.findIndex(
      (s) => s.name === struct.name
    );

    if (existingStructIndex !== -1) {
      this._structs[existingStructIndex] = struct;
    } else {
      this._structs.push(struct);
    }

    this.updateMoveFile(); // Update file content
    vscode.window.showInformationMessage(
      `Struct ${struct.name} created successfully!`
    );
    this.updateWebview();
  }

  private editStruct(struct: MoveStruct) {
    console.log("Editing struct:", struct);
    console.log("Current structs:", this._structs);

    const existingStructIndex = this._structs.findIndex(
      (s) => s.name === struct.name
    );

    console.log("Existing struct index:", existingStructIndex);

    if (existingStructIndex !== -1) {
      // Update the existing struct
      this._structs[existingStructIndex] = struct;

      // Update the file content
      this.updateMoveFile();

      vscode.window.showInformationMessage(
        `Struct ${struct.name} updated successfully!`
      );

      this.updateWebview();
    } else {
      vscode.window.showWarningMessage(
        `No struct found with name ${struct.name} to update`
      );
    }
  }
  private deleteStruct(structName: string) {
    this._structs = this._structs.filter((s) => s.name !== structName);
    this.updateWebview();
    vscode.window.showInformationMessage(`Struct ${structName} deleted.`);
    this.updateMoveFile(); // Update file content
  }

  private saveStructs() {
    this._context.globalState.update(this._storageKey, this._structs);
  }

  private loadSavedStructs() {
    const savedStructs = this._context.globalState.get<MoveStruct[]>(
      this._storageKey
    );
    if (savedStructs) {
      this._structs = savedStructs;
    }
  }

  private updateWebview() {
    if (this._view) {
      // Update the webview to show current structs
      this._view.webview.postMessage({
        command: "updateStructList",
        structs: this._structs,
      });
    }
  }

  private extractStructsFromFile(): MoveStruct[] {
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
      const abilities = match[2]
        ? match[2].split(",").map((a) => a.trim())
        : [];
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

  // Optional: Method to get all created structs
  public getStructs(): MoveStruct[] {
    return this._structs;
  }
}
