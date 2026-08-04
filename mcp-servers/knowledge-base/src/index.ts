import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_BASE_PATH = path.resolve(__dirname, "../../../KNOWLEDGE_BASE.md");

interface Story {
  id: number;
  ownership: string;
  text: string;
}

function loadStories(): Story[] {
  const raw = readFileSync(KNOWLEDGE_BASE_PATH, "utf-8");
  const lines = raw.split("\n");

  const storyLine = /^(\d+)\.\s+\*\*\[([^\]]+)\]\*\*\s+(.*)$/;
  const stories: Story[] = [];

  for (const line of lines) {
    const match = line.match(storyLine);
    if (match) {
      stories.push({
        id: Number(match[1]),
        ownership: match[2],
        text: match[3],
      });
    }
  }

  return stories;
}

const server = new McpServer({
  name: "knowledge-base",
  version: "0.1.0",
});

server.registerTool(
  "list_stories",
  {
    description:
      "List every verified story in the knowledge base, with its id and ownership tag (SOLO, CONTRIBUTED, CO-LED, etc).",
  },
  async () => {
    const stories = loadStories();
    const index = stories
      .map((s) => `${s.id}. [${s.ownership}] ${s.text.split(".")[0]}.`)
      .join("\n");

    return {
      content: [{ type: "text", text: index }],
    };
  },
);

server.registerTool(
  "get_story",
  {
    description: "Get the full text of one verified story by its id.",
    inputSchema: {
      id: z.number().describe("The story's numeric id, from list_stories"),
    },
  },
  async ({ id }) => {
    const stories = loadStories();
    const story = stories.find((s) => s.id === id);

    if (!story) {
      return {
        content: [{ type: "text", text: `No story found with id ${id}.` }],
      };
    }

    return {
      content: [{ type: "text", text: `[${story.ownership}] ${story.text}` }],
    };
  },
);

server.registerTool(
  "search_stories",
  {
    description:
      "Search verified stories by keyword (case insensitive substring match against the full story text).",
    inputSchema: {
      query: z.string().describe("A keyword or phrase to search for, e.g. 'Liveblocks' or 'Spanner'"),
    },
  },
  async ({ query }) => {
    const stories = loadStories();
    const needle = query.toLowerCase();
    const matches = stories.filter((s) => s.text.toLowerCase().includes(needle));

    if (matches.length === 0) {
      return {
        content: [{ type: "text", text: `No stories matched "${query}".` }],
      };
    }

    const results = matches
      .map((s) => `${s.id}. [${s.ownership}] ${s.text}`)
      .join("\n\n");

    return {
      content: [{ type: "text", text: results }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Knowledge base MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
