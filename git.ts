import { execFile } from "node:child_process";

export interface GitDirtyResult {
	text: string;
	isClean: boolean;
}

export interface GitRemoteResult {
	ahead: number;
	behind: number;
	hasRemote: boolean;
}

export interface GitLastCommit {
	hash: string;
	subject: string;
	age: string;
}

function parseGitDirty(raw: string): GitDirtyResult {
	if (!raw.trim()) return { text: "clean", isClean: true };
	let staged = 0;
	let modified = 0;
	let untracked = 0;
	for (const line of raw.split("\n")) {
		if (!line) continue;
		if (line.startsWith("??")) untracked++;
		else {
			if (line[0] !== " ") staged++;
			if (line[1] !== " ") modified++;
		}
	}
	const text = [`\u25cf${modified}`, `\u271a${staged}`, `?${untracked}`].filter((part) => !part.endsWith("0")).join(" ") || "dirty";
	return { text, isClean: false };
}

export function gitDirtyAsync(cwd: string): Promise<GitDirtyResult> {
	return new Promise((resolve) => {
		execFile("git", ["status", "--porcelain"], { cwd, timeout: 2000 }, (err, stdout) => {
			if (err) return resolve({ text: "", isClean: false });
			resolve(parseGitDirty(stdout));
		});
	});
}

export function gitRemoteStatusAsync(cwd: string): Promise<GitRemoteResult> {
	return new Promise((resolve) => {
		execFile("git", ["rev-list", "--left-right", "--count", "HEAD...@{u}"], {
			cwd, timeout: 2000,
		}, (err, stdout) => {
			if (err) return resolve({ ahead: 0, behind: 0, hasRemote: false });
			const parts = stdout.trim().split(/\s+/);
			resolve({
				ahead: parseInt(parts[0] ?? "0", 10),
				behind: parseInt(parts[1] ?? "0", 10),
				hasRemote: true,
			});
		});
	});
}

export function gitLastCommitAsync(cwd: string): Promise<GitLastCommit> {
	return new Promise((resolve) => {
		execFile("git", ["log", "-1", "--format=%h%x09%s%x09%cr"], {
			cwd, timeout: 2000,
		}, (err, stdout) => {
			if (err) return resolve({ hash: "", subject: "", age: "" });
			const parts = stdout.trim().split("\t");
			resolve({ hash: parts[0] ?? "", subject: parts[1] ?? "", age: parts[2] ?? "" });
		});
	});
}
