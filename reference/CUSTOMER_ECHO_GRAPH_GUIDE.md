# Customer LangGraph baseline — read in this order

1. src/server.js: initializeCustomerEchoGraph() compiles once before app.listen().
2. src/services/customerConversationService.js: buildConversationAgentPayload() builds customerInfo, databaseInfo (without collectionName), sessionInfo, userMessage, inputType, attachments, metadata.
3. src/langgraph/customerEchoGraph.js: read Lessons 1–4. State → node → edges → compile → invoke → result.
4. src/controller/eo/langgraph/customerOrderRequestLanggraph.js: the handler invokes runCustomerEchoGraph(), then builds the existing EO response.
5. src/utils/standardEO.js: the reply becomes Base64 in resMessageObj.fileName.

## Test server

Set LANGGRAPH_CHAT_ENABLED=true and restart Node. The startup log must show "Customer echo graph: compiled". Submit a text order message through the existing EO API. Logs show "invoke started", "node executed", "invoke completed", then the existing EO final-response logs. Match requestId across them.

Example: userMessage = "Hello order" → reply = "Hello order" → resMessageObj.fileName = "SGVsbG8gb3JkZXI=". eoState stays "continue".

Existing EO input normalization still applies: the graph echoes the resolved userMessage, not the whole webhook JSON. Attachments remain in the payload but this node does not extract their contents. Empty input and disabled-graph responses keep their existing guards.

This baseline has no tools, inventory lookup, model call, or persistent conversation memory. threadId is a correlation identifier here. Each invocation has independent state.

ANTHROPIC_API_KEY is already supported by the server configuration, but this echo node does not use it. When we design the agent next, add a model node and select a model explicitly. Keep the key in the test server environment.

## Next lesson: design the agent

Agree on the agent's input, expected output, instructions, and when it should use tools. Then replace/extend echo_user_message one node at a time. Keep the EO reply mapping unchanged.

## Start from the customer menu

POST /standardEOService with questionKey customer_menu and answerKey customer_menu_ans_1. Context keys can be plain strings or Base64; the EO controller decodes them before routing.

```json
{
  "botUserId": "YOUR_REGISTERED_BOT_ID",
  "context": {
    "questionKey": "customer_menu",
    "answerKey": "customer_menu_ans_1",
    "apiAnswer": "Hello order"
  },
  "reqMessageObj": {
    "taskId": "YOUR_TASK_ID",
    "signalId": "test-signal-1",
    "fromId": "YOUR_CUSTOMER_ID",
    "toId": "YOUR_BOT_ID",
    "databaseName": "YOUR_DATABASE_NAME",
    "mimeType": "text",
    "fileName": "SGVsbG8gb3JkZXI="
  }
}
```

Replace the placeholder IDs with your configured bot/customer values. Existing bot validation and tenant database setup still run before the handler. Set LANGGRAPH_CHAT_ENABLED=true. This route uses customerEchoGraph.js; the application setup uses JavaScript .js files.
