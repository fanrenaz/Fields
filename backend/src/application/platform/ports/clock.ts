/** A controllable time source for application policies and use cases. */
export interface Clock {
  now(): number;
}
