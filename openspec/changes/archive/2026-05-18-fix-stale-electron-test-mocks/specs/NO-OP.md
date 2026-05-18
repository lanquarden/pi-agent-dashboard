# No Spec Changes

This change is a test-mock refresh only. No production requirements change; no capability is added, modified, or removed.

The 5 production migrations whose tests this change repairs (pi-fork rename, consolidate-tool-resolution, AppImage guard D1, offline-packages flag, recommended-extensions URL flip) each shipped their own spec deltas in their own changes. This change does not alter any of those contracts — it brings the test assertions back in sync with them.

See `proposal.md` "Capabilities" section: both "New Capabilities" and "Modified Capabilities" are empty.

See `design.md` for the per-bucket test-fix rationale.
