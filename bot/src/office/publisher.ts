/**
 * Publishes status.json to the repo's `bot-status` branch (path back-office/status.json) with the box's existing
 * git credentials. Pages only builds on pushes to main, so these commits never trigger a site rebuild; the site
 * reads https://raw.githubusercontent.com/<repo>/bot-status/back-office/status.json (CDN cache ~5 min).
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { officeHome } from "./store.js";

const run = promisify(execFile);
export const STATUS_BRANCH = "bot-status";

export class StatusPublisher {
  private ready = false;
  private busy = false;
  lastPush = 0;
  lastError = "";
  constructor(private readonly remote = "https://github.com/yogibear1323/quasaria.git", private readonly dir = join(officeHome(), "status-repo"), private readonly branch = STATUS_BRANCH) {}

  private git(...args: string[]) {
    return run("git", ["-C", this.dir, ...args], { timeout: 60_000 });
  }

  private async init() {
    if (this.ready) return;
    if (!existsSync(join(this.dir, ".git"))) {
      mkdirSync(this.dir, { recursive: true });
      await this.git("init", "-q");
      await this.git("remote", "add", "origin", this.remote);
      await this.git("config", "user.name", "quasaria-back-office");
      await this.git("config", "user.email", "back-office@users.noreply.github.com");
      await this.git("config", "commit.gpgsign", "false");
      const has = await this.git("ls-remote", "--heads", "origin", this.branch).then((r) => r.stdout.trim().length > 0);
      if (has) {
        await this.git("fetch", "-q", "--depth", "1", "origin", this.branch);
        await this.git("checkout", "-q", "-B", this.branch, "FETCH_HEAD");
      } else {
        await this.git("checkout", "-q", "--orphan", this.branch);
        mkdirSync(join(this.dir, "back-office"), { recursive: true });
        writeFileSync(
          join(this.dir, "README.md"),
          "# bot-status\n\nMachine-written status feed for the Quasaria **Back Office** (testnet bots, test funds only).\nWritten by the fleet runner on the ops box every few minutes. No secrets, no code. Pages does not build from this branch.\n",
        );
      }
    }
    this.ready = true;
  }

  async publish(status: unknown) {
    if (this.busy) return false;
    this.busy = true;
    try {
      await this.init();
      mkdirSync(join(this.dir, "back-office"), { recursive: true });
      writeFileSync(join(this.dir, "back-office", "status.json"), JSON.stringify(status, null, 1) + "\n");
      await this.git("add", "-A");
      const diff = await this.git("status", "--porcelain");
      if (!diff.stdout.trim()) return false;
      await this.git("commit", "-q", "-m", `status ${new Date().toISOString()}`);
      try {
        await this.git("push", "-q", "origin", `HEAD:${this.branch}`);
      } catch {
        // someone else pushed (or first push raced): rebase onto remote and retry once
        await this.git("fetch", "-q", "--depth", "5", "origin", this.branch).catch(() => undefined);
        await this.git("rebase", "-q", "-X", "theirs", "FETCH_HEAD").catch(() => this.git("rebase", "--abort").catch(() => undefined));
        await this.git("push", "-q", "origin", `HEAD:${this.branch}`);
      }
      this.lastPush = Date.now();
      this.lastError = "";
      return true;
    } catch (e) {
      this.lastError = (e as Error).message.split("\n")[0];
      return false;
    } finally {
      this.busy = false;
    }
  }
}
