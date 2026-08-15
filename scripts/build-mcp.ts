const outputPath = "agent-plugins/orbit/dist/server.js";
const result = await Bun.build({
  entrypoints: ["mcp/server.ts"],
  outdir: "agent-plugins/orbit/dist",
  naming: "server.js",
  target: "bun",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const bundled = await Bun.file(outputPath).text();
await Bun.write(outputPath, bundled.replace(/[\t ]+$/gm, ""));
console.log(`Built ${outputPath}`);
