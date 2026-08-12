// Verify skills-lock.json computedHash entries against the on-disk skill folders,
// replicating the `npx skills` CLI folder-hash algorithm exactly:
//   - walk folder recursively, skipping .git and node_modules
//   - sort files by relativePath via localeCompare
//   - sha256 over (relativePath + fileContent) for each file, in sorted order
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
  const lock = JSON.parse(fs.readFileSync("skills-lock.json", "utf8"));
  let ok = true;
  for (const [name, meta] of Object.entries(lock.skills)) {
    const dir = path.join(".agents", "skills", name);
    if (!fs.existsSync(dir)) {
      console.log("MISSING", name.padEnd(28), "(no folder on disk)");
      ok = false;
      continue;
    }
    const h = await computeSkillFolderHash(dir);
    const match = h === meta.computedHash;
    if (!match) ok = false;
    console.log(
      (match ? "OK" : "STALE").padEnd(6),
      name.padEnd(28),
      match ? "" : "lock=" + meta.computedHash.slice(0, 16) + " actual=" + h.slice(0, 16)
    );
  }
  console.log(ok ? "ALL LOCKED SKILL HASHES MATCH" : "SOME LOCK ENTRIES ARE STALE");
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
