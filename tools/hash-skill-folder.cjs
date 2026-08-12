// Compute skill folder hashes using the exact algorithm from tools/verify-skills-lock.cjs
// Usage: node tools/hash-skill-folder.cjs <skill-name> [<skill-name> ...]
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

async function collectFiles(baseDir, currentDir, results) {
  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") return;
        await collectFiles(baseDir, fullPath, results);
      } else if (entry.isFile()) {
        const content = await fs.promises.readFile(fullPath);
        const relativePath = path.relative(baseDir, fullPath).split("\\").join("/");
        results.push({ relativePath, content });
      }
    })
  );
}

async function computeSkillFolderHash(skillDir) {
  const files = [];
  await collectFiles(skillDir, skillDir, files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return hash.digest("hex");
}

(async () => {
  const names = process.argv.slice(2);
  for (const name of names) {
    const h = await computeSkillFolderHash(path.join(".agents", "skills", name));
    console.log(`${name}=${h}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
