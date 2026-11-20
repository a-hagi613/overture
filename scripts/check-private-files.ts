const profileDirectory = "profile/";
const profileKeptFile = "profile/README.md";
const envKeptFile = ".env.example";
const documentExtensions = [".pdf", ".docx", ".tex"] as const;
const documentDirectory = "test/e2e/fixtures/";

const rules = [
  {
    reason: `owner profile files stay out of the repository (only ${profileKeptFile} is tracked)`,
    matches: (path: string) => path.startsWith(profileDirectory) && path !== profileKeptFile,
  },
  {
    reason: `env files hold secrets (only ${envKeptFile} is tracked)`,
    matches: (path: string) => {
      const name = path.slice(path.lastIndexOf("/") + 1);

      return (name === ".env" || name.startsWith(".env.")) && name !== envKeptFile;
    },
  },
  {
    reason: `personal documents belong outside the repository (only ${documentDirectory} may hold them)`,
    matches: (path: string) => {
      const lower = path.toLowerCase();

      return (
        documentExtensions.some((extension) => lower.endsWith(extension)) &&
        !path.startsWith(documentDirectory)
      );
    },
  },
];

export function privateFileProblems(paths: readonly string[]) {
  return paths.flatMap((path) =>
    rules.flatMap((rule) => (rule.matches(path) ? [`${path}: ${rule.reason}`] : [])),
  );
}

function trackedFiles() {
  const listed = Bun.spawnSync({
    cmd: ["git", "ls-files", "-z"],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (listed.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${new TextDecoder().decode(listed.stderr).trim()}`);
  }

  return new TextDecoder()
    .decode(listed.stdout)
    .split("\0")
    .filter((path) => path.length > 0);
}

if (import.meta.main) {
  const paths = trackedFiles();
  const problems = privateFileProblems(paths);

  if (problems.length > 0) {
    for (const problem of problems) {
      process.stderr.write(`private-files: ${problem}\n`);
    }

    process.stderr.write(
      `private-files: ${String(problems.length)} tracked file(s) must not be in git\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `private-files: ${String(paths.length)} tracked files checked, none private\n`,
    );
  }
}
