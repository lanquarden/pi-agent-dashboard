## ADDED Requirements

### Requirement: Slot exists in the frozen taxonomy

The slot id `"command-input-action"` SHALL be a member of the `SlotId` type union and the `SessionScopedSlot` type. Its `SLOT_DEFINITIONS` entry SHALL specify `multiplicity: "many"`, `payloadTier: "react-only"`, and include a description indicating it renders action buttons inline in the command input button row.

#### Scenario: Slot is recognised by the type system

- **GIVEN** the slot taxonomy at `packages/shared/src/dashboard-plugin/slot-types.ts`
- **WHEN** a plugin manifest declares `{ "slot": "command-input-action", "component": "MyButton" }`
- **THEN** the TypeScript types SHALL accept the claim without error.

#### Scenario: Slot is filterable as session-scoped

- **GIVEN** the slot registry contains a `command-input-action` claim
- **WHEN** `forSessionRendered(registry.getClaims("command-input-action"), session)` is called
- **THEN** the claim SHALL be returned when its `shouldRender` predicate passes for the given session.

### Requirement: Slot props include session and onInsertText

The `SlotPropsMap` entry for `"command-input-action"` SHALL include `session: DashboardSession`, `pluginContext: AnyPluginContext`, and `onInsertText: (text: string) => void`. Plugin components claiming this slot SHALL receive these props.

#### Scenario: Plugin component receives session

- **GIVEN** a plugin component exported as `MicButton` claiming `command-input-action`
- **WHEN** the component renders
- **THEN** `props.session.id` SHALL equal the currently selected session id.

#### Scenario: Plugin component calls onInsertText

- **GIVEN** a plugin component that calls `props.onInsertText("hello")`
- **WHEN** the callback executes
- **THEN** the text "hello" SHALL be appended to the CommandInput textarea draft.

### Requirement: Slot consumer renders in CommandInput button row

The `CommandInputActionSlot` consumer component SHALL render plugin contributions in the CommandInput button row, between the textarea and the Send/Stop buttons. It SHALL only render when a `session` prop is provided. When no claims match, it SHALL render nothing.

#### Scenario: Mic button appears before Send button

- **GIVEN** the voice-input plugin is enabled and a session is selected
- **WHEN** the dashboard renders
- **THEN** a mic button SHALL appear in the CommandInput bar to the left of the Send button.

#### Scenario: No session selected hides slot

- **GIVEN** no session is selected (`session` prop is undefined)
- **WHEN** the dashboard renders
- **THEN** no `command-input-action` contributions SHALL render.

#### Scenario: No matching claims renders nothing

- **GIVEN** no plugin claims `command-input-action` (or all matching plugins are disabled)
- **WHEN** the slot consumer renders
- **THEN** it SHALL return `null` and produce no DOM nodes.

### Requirement: Slot consumer follows existing patterns

The `CommandInputActionSlot` SHALL wrap each contribution in `SlotErrorBoundary` and `CurrentPluginLayer`, matching the pattern of `SessionCardActionBarSlot` and `ContentInlineFooterSlot`. It SHALL also render intents from the `IntentStore` for this slot id.

#### Scenario: Failing plugin does not suppress siblings

- **GIVEN** two plugins claim `command-input-action`, and the first throws during render
- **WHEN** the slot consumer renders
- **THEN** the second plugin's button SHALL still render normally (error boundary isolates the failure).
