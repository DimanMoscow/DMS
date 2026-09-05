import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

export function isOutsidePath(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

export function assertPrivateRegularFile(filePath, repositoryRoot, label) {
  assert.equal(path.isAbsolute(filePath), true, `${label} path must be absolute`);
  assert.ok(isOutsidePath(repositoryRoot, filePath), `${label} must be stored outside the repository`);
  const stat = fs.lstatSync(filePath);
  assert.equal(stat.isSymbolicLink(), false, `${label} cannot be a symlink`);
  assert.equal(stat.isFile(), true, `${label} must be a regular file`);
  assert.ok(
    isOutsidePath(fs.realpathSync.native(repositoryRoot), fs.realpathSync.native(filePath)),
    `${label} resolves inside the repository`,
  );
  return true;
}
