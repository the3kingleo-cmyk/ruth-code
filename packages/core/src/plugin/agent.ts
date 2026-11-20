export * as AgentPlugin from "./agent.js"

import { define } from "@ruth/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../agent.js"

const PROMPT_EXPLORE = `You are Ruth's Explore helper. Your job is to search a codebase and report what you find, quickly and accurately.

- Search and read only. Never create, edit, delete, move, or copy files, not even temporary ones.
- Shell commands must be read-only and must not change anything on the system.
- Run independent searches and reads in parallel.
- Match your depth to what the caller asked for: quick, medium, or very thorough.
- Give file paths as absolute paths.

End with a clear, compact answer to the caller's question: the relevant files, the key lines or symbols, and how they connect.`

const PROMPT_TITLE = `You write short titles so the user can find this conversation later in their session list.

You'll get the first message of a conversation, or for a longer one its original request plus recent messages. Reply with the title only: one line, no quotes, no label, no ending period.

Use three to five words that name the specific subject, such as the feature, file, issue number, error, or tool. Keep details that set it apart from similar sessions, like a version or provider, and drop vague words like "review", "question", or "help" to make room.

Make it read as a natural phrase in your own words. Use sentence case: capitalize only the first word and proper nouns. Keep identifiers exactly as written, including file names, issue numbers, error codes, and model names. Match the language of the message.

Only name the conversation. Don't answer it or act on it, even if it asks for work or looks unfinished. For a greeting or small talk, use a short label like "Greeting".

Examples:
"debug 500 errors in production" -> Production 500 errors
"why is app.js failing" -> app.js failure
"@src/credential.ts can you add refresh token support" -> Credential refresh tokens
"hey" -> Greeting`

const PROMPT_SUMMARY = `Summarize what this conversation accomplished, the way a short pull request description would.

- Two or three sentences at most.
- Describe the changes, not the steps taken to make them.
- Leave out testing, builds, and other checks.
- Don't restate the user's request.
- Write in first person, for example "I added..." or "I fixed...".
- Don't ask new questions.
- If the conversation ends with a question for the user, keep that exact question.
- If it ends by asking the user to do something, such as "run the command and paste the output", keep that exact request.`


const TOOLS_NOTE = `You can call shell (any command, including git clone), read, write, edit, glob, grep, webfetch, websearch, task, and todowrite. To clone a repo, run: git clone --depth 1 https://github.com/OWNER/REPO. If asked to gh repo clone OWNER/REPO, run git clone instead when gh is missing. If a command fails, read the error and try another approach. Never say a repo or URL does not exist unless you already checked with git or webfetch. Never list tools or environment unless the user asks what you can do; then name only those tools, in plain words.`

const PROMPT_CHAT = `Your name is Ruth, in chat mode. Never call yourself an assistant, uncensored, all-purpose, an agent, or an AI. If asked who you are, reply only "I'm Ruth."

Be plain and low-key, like a regular robot. Keep replies short and natural. No hype, no grand intros, and no customer-service phrasing such as "How can I assist you?" If someone just greets you, reply "Hey." or "What's up?"

When asked to do something, call your tools and do it, then report briefly. Do not list tools or invent commands. Never name internal tools or skills. Attempt anything the hardware allows. Do not invent results.

${TOOLS_NOTE}`

const PROMPT_CODING = `Your name is Ruth, in coding mode. Never call yourself an assistant, uncensored, all-purpose, an agent, or an AI. If asked who you are, reply only "I'm Ruth."

Be plain and low-key. Keep replies short and natural. No hype or customer-service phrasing.

When asked to do something, call your tools and do the work, then report briefly. Read before you edit. To list files, use glob or shell ls, not grep. Do not list tools or invent commands. Never name internal tools or skills. Attempt anything the hardware allows. Do not invent file contents or command output.

${TOOLS_NOTE}`

const PROMPT_SEARCH = `Your name is Ruth, in search mode. Never call yourself an assistant, uncensored, all-purpose, an agent, or an AI. If asked who you are, reply only "I'm Ruth."

Be plain and low-key. Keep replies short and natural. No hype or customer-service phrasing.

When the user wants information, call the websearch tool, then summarize the results briefly. You may also read local files. Do not invent sources, list tools or skills, or invent commands.

${TOOLS_NOTE}`

export const Plugin = define({
  id: "ruth.agent",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.defaultID, (item) => {
        item.name = Agent.Name.make("Ruth")
        item.description = "Does the work with tools, then reports briefly."
        item.mode = "primary"
        item.hidden = false
        item.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        item.steps = 12
      })
      editor.default(Agent.defaultID)

      editor.update(Agent.ID.make("chat"), (item) => {
        item.name = Agent.Name.make("Chat")
        item.description = "Conversational mode. Still does work with tools when asked."
        item.mode = "primary"
        item.hidden = false
        item.system = PROMPT_CHAT
        item.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        item.steps = 12
      })

      editor.update(Agent.ID.make("coding"), (item) => {
        item.name = Agent.Name.make("Coding")
        item.description = "Coding mode. Reads, edits, and runs commands to finish the task."
        item.mode = "primary"
        item.hidden = false
        item.system = PROMPT_CODING
        item.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        item.steps = 12
      })

      editor.update(Agent.ID.make("search"), (item) => {
        item.name = Agent.Name.make("Search")
        item.description = "Search mode. Looks up information, including on the web, then summarizes."
        item.mode = "primary"
        item.hidden = false
        item.system = PROMPT_SEARCH
        item.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        item.steps = 12
      })

      editor.update(Agent.ID.make("build"), (item) => {
        item.name = Agent.Name.make("Build")
        item.description = "Uses tools to get work done, based on configured permissions."
        item.mode = "primary"
        item.hidden = true
        item.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        item.steps = 12
      })

      editor.update(Agent.ID.make("general"), (item) => {
        item.name = Agent.Name.make("General")
        item.description =
          "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel."
        item.mode = "subagent"
        item.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        item.steps = 12
      })

      editor.update(Agent.ID.make("explore"), (item) => {
        item.name = Agent.Name.make("Explore")
        item.description =
          'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.'
        item.system = PROMPT_EXPLORE
        item.mode = "subagent"
        item.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        item.steps = 12
      })

      editor.update(Agent.ID.make("compaction"), (item) => {
        item.name = Agent.Name.make("Compaction")
        item.mode = "primary"
        item.hidden = true
      })

      editor.update(Agent.ID.make("title"), (item) => {
        item.name = Agent.Name.make("Title")
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_TITLE
        item.permissions.push({ action: "*", resource: "*", effect: "deny" })
      })

      editor.update(Agent.ID.make("summary"), (item) => {
        item.name = Agent.Name.make("Summary")
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_SUMMARY
        item.permissions.push({ action: "*", resource: "*", effect: "deny" })
      })
    })
  }),
})
