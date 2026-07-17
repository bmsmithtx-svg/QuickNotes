import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuthenticationError } from "./auth";
import { shouldRedirectAuthenticatedVisitor } from "./auth-routing";

describe("auth page routing", () => {
  it("redirects already-authenticated visitors away from /auth", async () => {
    assert.equal(
      await shouldRedirectAuthenticatedVisitor(async () => ({
        id: "user-id",
        email: "owner@example.com"
      })),
      true
    );
  });

  it("keeps unauthenticated visitors on /auth", async () => {
    assert.equal(
      await shouldRedirectAuthenticatedVisitor(async () => {
        throw new AuthenticationError();
      }),
      false
    );
  });

  it("rethrows unexpected auth checks", async () => {
    await assert.rejects(
      () =>
        shouldRedirectAuthenticatedVisitor(async () => {
          throw new Error("database offline");
        }),
      /database offline/
    );
  });
});
