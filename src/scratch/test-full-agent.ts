import { runAgent } from '../agent/run.ts';

async function main() {
  console.log("Running full agent simulation...");
  const history: any[] = [];
  try {
    const finalHistory = await runAgent(
      "List the contents of the current directory.",
      history,
      {
        onToken: (token) => {
          console.log("[Token]", JSON.stringify(token));
        },
        onToolCallStart: (name, args) => {
          console.log("[ToolCallStart]", name, args);
        },
        onToolCallEnd: (name, result) => {
          console.log("[ToolCallEnd]", name, result.substring(0, 100) + "...");
        },
        onComplete: (response) => {
          console.log("[Complete]", response);
        }
      }
    );
    console.log("Final history length:", finalHistory.length);
    console.log("Final history:", JSON.stringify(finalHistory, null, 2));
  } catch (error) {
    console.error("Caught error in runAgent:", error);
  }
}

main();
