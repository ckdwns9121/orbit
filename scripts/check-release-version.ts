type VersionSource = {
  name: string;
  version: string;
};

const root = new URL("../", import.meta.url);
const packageJson = await Bun.file(new URL("package.json", root)).json() as { version?: string };
const tauriConfig = await Bun.file(new URL("src-tauri/tauri.conf.json", root)).json() as { version?: string };
const cargoToml = await Bun.file(new URL("src-tauri/Cargo.toml", root)).text();
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const sources: VersionSource[] = [
  { name: "package.json", version: packageJson.version ?? "" },
  { name: "src-tauri/tauri.conf.json", version: tauriConfig.version ?? "" },
  { name: "src-tauri/Cargo.toml", version: cargoVersion ?? "" },
];

const invalid = sources.filter((source) => !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(source.version));
if (invalid.length > 0) {
  throw new Error(`Invalid or missing version: ${invalid.map((source) => source.name).join(", ")}`);
}

const expected = sources[0].version;
const mismatched = sources.filter((source) => source.version !== expected);
if (mismatched.length > 0) {
  throw new Error(`Release versions must match: ${sources.map((source) => `${source.name}=${source.version}`).join(", ")}`);
}

const requestedTag = process.argv[2];
if (requestedTag) {
  const requestedVersion = requestedTag.replace(/^v/, "");
  if (requestedVersion !== expected) {
    throw new Error(`Release tag ${requestedTag} does not match the application version ${expected}.`);
  }
}

console.log(`[release] version ${expected} is synchronized across package.json, tauri.conf.json, and Cargo.toml.`);
