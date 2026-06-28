#!/usr/bin/env tsx
/**
 * git-push-account.ts
 *
 * Developer utility — detects all GitHub accounts authenticated via gh CLI,
 * lets you pick one interactively, then pushes the current branch using that
 * account's credential.
 *
 * Usage:
 *   npx tsx scripts/git-push-account.ts
 *   npx tsx scripts/git-push-account.ts --branch feat/my-branch
 *   npx tsx scripts/git-push-account.ts --account mandyslovestories-sudo
 *
 * Requirements: git, gh (GitHub CLI) on PATH.
 */

import { execSync, spawnSync } from "child_process";
import * as readline from "readline";
import * as path from "path";

// ── Types ──────────────────────────────────────────────────────────────────

interface GitAccount {
  username: string;
  remote: string;
  label: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Parse `gh auth status` output to extract authenticated usernames. */
function detectGhAccounts(): string[] {
  const output = run("gh auth status");
  const usernames: string[] = [];
  // Lines like: "  ✓ Logged in to github.com account mandyslovestories-sudo (...)"
  for (const line of output.split("\n")) {
    const match = line.match(/account\s+(\S+)/i);
    if (match) usernames.push(match[1]);
  }
  return [...new Set(usernames)];
}

/** Get the current branch name. */
function currentBranch(): string {
  return run("git rev-parse --abbrev-ref HEAD");
}

/** Get the remote URL for 'origin'. */
function originRemote(): string {
  return run("git remote get-url origin");
}

/**
 * Rewrite the remote URL to embed the chosen username as a credential hint.
 * GitHub ignores the username in HTTPS URLs for actual auth but gh CLI uses it
 * to select the right token when multiple accounts are logged in.
 *
 * https://github.com/owner/repo.git  →  https://USERNAME@github.com/owner/repo.git
 */
function buildRemoteWithUser(remote: string, username: string): string {
  return remote.replace(/^https:\/\/(?:[^@]+@)?/, `https://${username}@`);
}

/** Push branch using a specific account by temporarily overriding the remote URL. */
function pushWithAccount(username: string, branch: string, remote: string): void {
  const remoteWithUser = buildRemoteWithUser(remote, username);

  console.log(`\n→ Pushing ${branch} to ${remoteWithUser} as ${username}…\n`);

  const result = spawnSync(
    "git",
    ["push", "-u", remoteWithUser, branch],
    { stdio: "inherit", encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(
      `git push exited with code ${result.status ?? "unknown"}. ` +
      `Make sure 'gh auth login' has been run for account '${username}'.`,
    );
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // -- Parse CLI args --
  const args = process.argv.slice(2);
  const branchFlag = args.indexOf("--branch");
  const accountFlag = args.indexOf("--account");

  const branch =
    branchFlag !== -1 ? args[branchFlag + 1] : currentBranch();
  const forcedAccount =
    accountFlag !== -1 ? args[accountFlag + 1] : undefined;

  if (!branch) {
    console.error("Could not determine branch. Pass --branch <name>.");
    process.exit(1);
  }

  const remote = originRemote();
  if (!remote) {
    console.error("No 'origin' remote found. Run: git remote add origin <url>");
    process.exit(1);
  }

  // -- Detect accounts --
  const detectedUsernames = detectGhAccounts();

  // Also always include the global git config user as a fallback
  const globalUser = run("git config --global user.name");
  const allUsernames = [
    ...new Set([...detectedUsernames, globalUser].filter(Boolean)),
  ];

  const accounts: GitAccount[] = allUsernames.map((username) => ({
    username,
    remote: buildRemoteWithUser(remote, username),
    label: `${username} (github.com)`,
  }));

  // -- Display --
  console.log("\n┌─────────────────────────────────────────┐");
  console.log("│         Git Account Push Selector        │");
  console.log("└─────────────────────────────────────────┘");
  console.log(`\nBranch : ${branch}`);
  console.log(`Remote : ${remote}\n`);

  // If account was passed as a flag, use it directly
  if (forcedAccount) {
    const found = accounts.find((a) => a.username === forcedAccount) ?? {
      username: forcedAccount,
      remote: buildRemoteWithUser(remote, forcedAccount),
      label: forcedAccount,
    };
    pushWithAccount(found.username, branch, remote);
    console.log("\n✓ Push complete.");
    return;
  }

  if (accounts.length === 0) {
    console.error(
      "No GitHub accounts detected.\n" +
      "Run: gh auth login\n" +
      "Then re-run this script.",
    );
    process.exit(1);
  }

  // -- Interactive selection --
  console.log("Available accounts:\n");
  accounts.forEach((acct, i) => {
    console.log(`  [${i + 1}] ${acct.username}`);
    console.log(`      ${acct.remote}`);
  });

  const answer = await ask(
    `\nSelect account [1–${accounts.length}] (default: 1): `,
  );

  const idx = answer === "" ? 0 : parseInt(answer, 10) - 1;

  if (isNaN(idx) || idx < 0 || idx >= accounts.length) {
    console.error(`Invalid selection. Enter a number between 1 and ${accounts.length}.`);
    process.exit(1);
  }

  const chosen = accounts[idx];
  pushWithAccount(chosen.username, branch, remote);
  console.log("\n✓ Push complete.");
}

main().catch((err) => {
  console.error("\n✕ Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
