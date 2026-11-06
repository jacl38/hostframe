import { appendFile } from "node:fs/promises";

/** Documentation-only changes still run the deterministic checks. Unknown paths run integration. */
export function needsIntegration(paths: string[]) {
  return paths.some(path => !path.endsWith(".md") && path !== "LICENSE");
}

if(import.meta.main) {
  const base = process.env.HOSTFRAME_DIFF_BASE;
  let integration = true;
  if(base && !/^0+$/.test(base)) {
    const child = Bun.spawn(["git", "diff", "--name-only", base, "HEAD", "--"], { stdout: "pipe", stderr: "inherit", timeout: 10_000 });
    const output = await new Response(child.stdout).text();
    if(await child.exited !== 0) throw new Error("Unable to classify changes");
    integration = needsIntegration(output.trim().split("\n").filter(Boolean));
  }
  if(process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `integration=${integration}\n`);
  console.log(`Native, renderer and packed-consumer checks required: ${integration}`);
}
