# Next — pi-hud

Planned work, scanned by kanbanche. Entries are candidates, not authorization
to implement; promote through the normal spec and scope flow.

## Planned

- **Argument completions for `/hud`** — complete the verb set (`on`, `off`, `refresh`, `reload`, `layout`, `blocks`, `validate`, `status`, `editor`, `theme`, `ascii`) via `getArgumentCompletions`, and complete installed names for the two verbs that take one (`editor <name>`, `theme <name>`). Note that a returned `value` replaces the entire argument string, so second-level suggestions must carry their verb (`theme dracula`, not `dracula`). Add a round-trip test asserting every suggestion the completer offers is accepted by the parser.
- **Settings panel for `/hud`** — replace the verb grammar with a `SettingsList` block/layout picker opened by a bare `/hud`, keeping the existing argument form working for scripted and headless use.
