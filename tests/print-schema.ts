import { listFiles } from './agent/tools/file.ts';

console.log("listFiles tool:", listFiles);
console.log("listFiles type of listFiles:", typeof listFiles);
console.log("listFiles keys:", Object.keys(listFiles));
if ('parameters' in listFiles) {
  console.log("parameters exists:", (listFiles as any).parameters);
} else {
  console.log("parameters does NOT exist.");
}
if ('inputSchema' in listFiles) {
  console.log("inputSchema exists:", (listFiles as any).inputSchema);
}
