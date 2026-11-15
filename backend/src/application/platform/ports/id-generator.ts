export type IdentifierKind = "company" | "actor" | "room" | "runtime" | "executor" | "attempt" | "event" | "operation";

/** Generates opaque identifiers; ownership of the generator stays in Composition. */
export interface IdGenerator {
  next(kind: IdentifierKind): string;
}
