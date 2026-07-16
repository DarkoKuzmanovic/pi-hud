import { execFile } from "node:child_process";
import { hostname } from "node:os";
import type { MachineNameConfig } from "./config.js";

export interface MachineNameDependencies {
	readHostname: () => string;
	readTailscaleStatus: () => Promise<string>;
}

function readTailscaleStatus(): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"tailscale",
			["status", "--json"],
			{ encoding: "utf8", timeout: 5_000 },
			(error, stdout) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(stdout);
			},
		);
	});
}

const DEFAULT_DEPENDENCIES: MachineNameDependencies = {
	readHostname: hostname,
	readTailscaleStatus,
};

function fallbackHostname(dependencies: MachineNameDependencies): string {
	return dependencies.readHostname().trim() || "unknown-host";
}

function tailscaleHostName(raw: string): string | undefined {
	const parsed: unknown = JSON.parse(raw);
	if (typeof parsed !== "object" || parsed === null || !("Self" in parsed)) return undefined;
	const self = (parsed as { Self?: unknown }).Self;
	if (typeof self !== "object" || self === null || !("HostName" in self)) return undefined;
	const hostName = (self as { HostName?: unknown }).HostName;
	if (typeof hostName !== "string") return undefined;
	return hostName.trim() || undefined;
}

export async function resolveMachineName(
	config: MachineNameConfig,
	dependencies: MachineNameDependencies = DEFAULT_DEPENDENCIES,
): Promise<string> {
	const label = config.label?.trim();
	if (label) return label;

	const fallback = fallbackHostname(dependencies);
	if (config.source === "hostname") return fallback;

	try {
		return tailscaleHostName(await dependencies.readTailscaleStatus()) ?? fallback;
	} catch {
		return fallback;
	}
}
