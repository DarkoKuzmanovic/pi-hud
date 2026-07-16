# Machine Name Footer Chip Design

**Date:** 2026-07-16
**Status:** Approved for implementation

## Goal

Make the existing `project` footer block identify the machine running Pi so simultaneous laptop and desktop sessions are visually distinct. The rendered chip should read like:

```text
  - darko-laptop 
```

The label must default to the local OS hostname while allowing the HUD layout JSONC to select the Tailscale node name or provide an explicit override.

## Configuration

Add a top-level `machineName` object to `~/.pi/agent/pi-hud.layout.jsonc`:

```jsonc
"machineName": {
  // "hostname" uses Node os.hostname(); "tailscale" reads Self.HostName.
  "source": "hostname",
  // Optional non-empty text. When set, this wins over source.
  // "label": "darko-laptop"
}
```

The runtime shape is:

```ts
interface MachineNameConfig {
  source: "hostname" | "tailscale";
  label?: string;
}
```

Defaults are `{ source: "hostname" }`. Invalid source or label values produce `/hud validate` and `/hud reload` warnings and fall back to defaults through the existing lenient config merge behavior.

## Resolution and Caching

Machine-name lookup must never run inside the footer component's `render(width)` method.

A small resolver module will:

1. Return a trimmed non-empty `label` immediately when configured.
2. Return `os.hostname()` for the `hostname` source.
3. For the `tailscale` source, run `tailscale status --json` asynchronously, parse `Self.HostName`, and return it when it is a non-empty string.
4. Fall back to `os.hostname()` when the Tailscale executable is unavailable, Tailscale is stopped, the command fails, JSON is malformed, or `Self.HostName` is absent.

`index.ts` will keep the resolved name in cached state alongside the other footer data. It starts with `os.hostname()` so the chip is never blank, refreshes asynchronously during installation/session start, and requests a re-render only when the resolved value changes. `/hud reload` reloads the layout, re-resolves the machine name, and then refreshes the footer.

No periodic polling is needed. Hostname changes during a running Pi session become visible after `/hud reload` or a new session.

## Rendering

Add the cached machine name to `BlockContext`. The `project` block becomes:

```text
<project icon> - <machine name>
```

The existing centralized chip renderer remains responsible for Powerline separators and theme styling. The project block still renders plain when it is not listed in `layout.chips`.

The existing footer width boundary remains authoritative: `renderFooterLine` composes groups and truncates/pads them using ANSI-aware width helpers. Tests will include a long machine label to ensure the rendered footer never exceeds the supplied width.

## Error Handling

Tailscale lookup is best-effort and non-fatal. Failures do not add footer warnings or block startup because the OS hostname is a valid fallback. Configuration shape errors continue to surface through the existing validation warnings.

The resolver must avoid shell command construction. It will invoke the `tailscale` executable with an argument array so configured text never enters a command line.

## Tests

Follow RED → GREEN with focused tests for:

- default and explicit `machineName` config merging;
- validation warnings for unsupported sources and invalid labels;
- explicit label precedence over both sources;
- OS hostname resolution;
- Tailscale `Self.HostName` parsing;
- Tailscale command/JSON/missing-field fallback to the OS hostname;
- `project` block output containing `<icon> - <machine name>` in plain and chip modes;
- footer width safety with a long machine label.

Tests will inject the Tailscale command runner and hostname reader rather than invoking live machine services.

## Documentation

Update the README configuration section and generated default JSONC comments to document `machineName.source`, `machineName.label`, precedence, fallback behavior, and the fact that the visible label is part of the `project` block.

## Out of Scope

- Polling for hostname or Tailnet changes during a session.
- Displaying the full MagicDNS name (`Self.DNSName`).
- Adding a separate machine-name block.
- Changing the default footer block placement.
