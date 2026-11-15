/**
 * Reuses identical observable assertions for a Fake and a production Adapter.
 * It does not provide storage or hide a real integration dependency.
 */
export async function assertPortContract<TPort, TObservation>(options: {
  create: () => Promise<TPort> | TPort;
  observe: (port: TPort) => Promise<TObservation> | TObservation;
  assert: (observation: TObservation) => void | Promise<void>;
}): Promise<void> {
  const port = await options.create();
  const observation = await options.observe(port);
  await options.assert(observation);
}
