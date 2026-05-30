## ADDED Requirements

### Requirement: `registerToolRenderer` accepts optional headerChips

`registerToolRenderer(toolName, renderer, opts?)` SHALL accept an optional third parameter with `headerChips?: HeaderChipsFn`. `HeaderChipsFn` SHALL be `(args?: Record<string, unknown>) => React.ReactNode`. When provided, the function SHALL be stored in a `headerChipsRegistry` map keyed by tool name.

#### Scenario: headerChips registered and retrieved

- **WHEN** `registerToolRenderer("bash", R, { headerChips: myChips })` is called
- **THEN** `getToolHeaderChips("bash")` SHALL return `myChips`.

#### Scenario: No headerChips returns undefined

- **WHEN** `registerToolRenderer("bash", R)` is called without opts
- **THEN** `getToolHeaderChips("bash")` SHALL return `undefined`.

#### Scenario: Overwriting replaces previous headerChips

- **WHEN** `registerToolRenderer("bash", R1, { headerChips: fn1 })` then `registerToolRenderer("bash", R2, { headerChips: fn2 })` is called
- **THEN** `getToolHeaderChips("bash")` SHALL return `fn2`.

### Requirement: `ToolCallStep` renders header chips in collapsed row

`ToolCallStep.tsx` SHALL call `getToolHeaderChips(toolName)?.(args)` in the collapsed header row after the summary text and before the `ElapsedBadge`. The returned ReactNode SHALL be rendered inline.

#### Scenario: Chips render in header

- **WHEN** a tool renderer is registered with `headerChips` and `ToolCallStep` renders for that tool
- **THEN** the chips SHALL appear between the summary text and the elapsed badge in the collapsed header.

### Requirement: `registerToolRenderer` accepts optional summary

`registerToolRenderer` SHALL also accept `summary?: SummaryFn` in opts, where `SummaryFn = (args?: Record<string, unknown>) => string`. When provided, `getToolSummary(toolName)` SHALL return the function, and `ToolCallStep`'s `getSummary()` SHALL prefer it over built-in tool summaries.

#### Scenario: Plugin summary overrides built-in

- **WHEN** a plugin registers `registerToolRenderer("bash", R, { summary: (args) => "Custom: " + args?.command })`
- **THEN** `ToolCallStep` SHALL display "Custom: <command>" instead of the default "$ <command>" summary.
