/** Common command-line contract for renderer examples. Parse before allocating native resources. */
export function readExampleOptions(defaultMaxFPS = 60) {
  const args = process.argv.slice(2);
  if(args.some(arg => arg !== "--no-vsync" && !/^--(frames|max-fps)=/.test(arg))) {
    throw new Error("Options: [--frames=<positive integer>] [--max-fps=<positive number>] [--no-vsync]");
  }
  function option(name: string) {
    const argument = args.find(arg => arg.startsWith(`--${name}=`));
    if(argument === undefined) return undefined;
    const value = Number(argument.slice(name.length + 3));
    if(!Number.isFinite(value) || value <= 0 || (name === "frames" && !Number.isSafeInteger(value))) {
      throw new Error(`--${name} must be a positive ${name === "frames" ? "integer" : "number"}`);
    }
    return value;
  }
  return { frameLimit: option("frames"), maxFPS: option("max-fps") ?? defaultMaxFPS, vsync: !args.includes("--no-vsync") };
}
