import assert from "node:assert/strict";
import test from "node:test";

import type { ProductSessionQuery } from "../../../../src/application/actor/index.js";
import {
  ProductSessionResolver,
  resolveProductAuthContext,
  type VerifiedBetterAuthSession,
} from "../../../../src/interface/trpc/product-session.js";

test("ProductSessionResolver maps the provider-neutral projection to the public contract", async () => {
  const query = new RecordingProductSessionQuery({
    actorId: "actor_human",
    companyId: "company_one",
    displayName: "Ada Lovelace",
    actorType: "human",
    companyRole: "owner",
    companyStatus: "active",
  });
  const resolver = new ProductSessionResolver(query);

  const resolved = await resolver.resolve(verifiedSession({
    userId: "user_ada",
    activeOrganizationId: "organization_one",
  }));

  assert.deepEqual(query.inputs, [{
    authUserId: "user_ada",
    activeOrganizationId: "organization_one",
  }]);
  assert.deepEqual(resolved, {
    actor_id: "actor_human",
    company_id: "company_one",
    display_name: "Ada Lovelace",
    actor_type: "human",
    company_role: "owner",
    company_status: "active",
  });
});

test("ProductSessionResolver fails closed for banned users without querying the Application layer", async () => {
  const query = new RecordingProductSessionQuery(null);
  const resolver = new ProductSessionResolver(query);

  const resolved = await resolver.resolve(verifiedSession({ banned: true }));

  assert.equal(resolved, null);
  assert.deepEqual(query.inputs, []);
});

test("ProductSessionResolver fails closed when the Application query cannot resolve a session", async () => {
  const query = new RecordingProductSessionQuery(null);
  const resolver = new ProductSessionResolver(query);

  assert.equal(await resolver.resolve(verifiedSession()), null);
  assert.deepEqual(query.inputs, [{
    authUserId: "user_one",
    activeOrganizationId: null,
  }]);
});

test("ProductSessionResolver converts unexpected Application query failures to an unavailable session", async () => {
  const query = new RecordingProductSessionQuery(null, new Error("database credential must not escape"));
  const resolver = new ProductSessionResolver(query);

  assert.equal(await resolver.resolve(verifiedSession()), null);
  assert.equal(query.inputs.length, 1);
});

test("resolveProductAuthContext retains its auth context shape with the injected resolver", async () => {
  const verified = verifiedSession({ activeOrganizationId: "organization_one" });
  const auth = {
    async resolve() {
      return verified;
    },
  };
  const resolver = new ProductSessionResolver(new RecordingProductSessionQuery({
    actorId: "actor_human",
    companyId: "company_one",
    displayName: "Ada Lovelace",
    actorType: "human",
    companyRole: "member",
    companyStatus: "provisioning",
  }));
  const inputHeaders = new Headers({ cookie: "better-auth.session_token=signed" });

  const context = await resolveProductAuthContext(auth, resolver, inputHeaders);

  assert.notEqual(context.authHeaders, inputHeaders);
  assert.equal(context.authHeaders.get("cookie"), "better-auth.session_token=signed");
  assert.equal(context.authSession, verified);
  assert.deepEqual(context.productSession, {
    actor_id: "actor_human",
    company_id: "company_one",
    display_name: "Ada Lovelace",
    actor_type: "human",
    company_role: "member",
    company_status: "provisioning",
  });
});

class RecordingProductSessionQuery implements ProductSessionQuery {
  readonly inputs: Array<{ authUserId: string; activeOrganizationId: string | null }> = [];

  constructor(
    private readonly result: Awaited<ReturnType<ProductSessionQuery["resolveVerifiedSession"]>>,
    private readonly failure?: Error,
  ) {}

  async resolveVerifiedSession(input: {
    authUserId: string;
    activeOrganizationId: string | null;
  }): Promise<Awaited<ReturnType<ProductSessionQuery["resolveVerifiedSession"]>>> {
    this.inputs.push(input);
    if (this.failure) {
      throw this.failure;
    }
    return this.result;
  }
}

function verifiedSession(input: {
  userId?: string;
  banned?: boolean;
  activeOrganizationId?: string;
} = {}): VerifiedBetterAuthSession {
  return {
    session: {
      id: "session_one",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      userId: input.userId ?? "user_one",
      expiresAt: new Date(86_400_000),
      token: "session-token",
      activeOrganizationId: input.activeOrganizationId,
    },
    user: {
      id: input.userId ?? "user_one",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      email: "ada@example.test",
      emailVerified: true,
      name: "Ada Lovelace",
      banned: input.banned,
    },
  } as VerifiedBetterAuthSession;
}
