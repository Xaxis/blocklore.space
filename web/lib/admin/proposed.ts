import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AgendaTopic } from "@blocklore/core/control";
import { parseProposals } from "@blocklore/core/proposals";

/** Topics proposed for the agenda (brain/agenda/proposed.yaml), for the owner to add or leave. */
export function readProposals(): AgendaTopic[] {
  try {
    return parseProposals(
      readFileSync(path.join(process.cwd(), "..", "brain", "agenda", "proposed.yaml"), "utf8"),
    );
  } catch {
    return [];
  }
}
