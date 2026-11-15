/** Transient Call ownership invariant; Call records never enter persistence. */
export type EmbodimentCallOwner = { actor_id: string; company_id: string };

export function ownsEmbodimentCall(callActorId: string, actor: EmbodimentCallOwner): boolean {
  return callActorId === actor.actor_id;
}
