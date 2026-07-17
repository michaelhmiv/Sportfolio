import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  buildCollectionParticipationQuery,
  prerequisiteLinksMatchCurrent,
} from "./catalog-lifecycle-repository";

describe("MLB catalog lifecycle repository queries", () => {
  it("counts historical completers across every immutable version of a definition", () => {
    const query = new PgDialect().sqlToQuery(buildCollectionParticipationQuery("catalog-test"));

    expect(query.sql).toContain("award.collection_definition_id = definition.id");
    expect(query.sql).not.toContain("award.collection_version_id = version.id");
  });

  it("requires every master prerequisite to link to its definition's current version", () => {
    const expected = ["leaf-a", "leaf-b"];
    const current = [
      { slug: "leaf-a", versionId: "a-v2" },
      { slug: "leaf-b", versionId: "b-v1" },
    ];

    expect(
      prerequisiteLinksMatchCurrent(
        [
          { slug: "leaf-a", versionId: "a-v2", isRequired: true },
          { slug: "leaf-b", versionId: "b-v1", isRequired: true },
        ],
        current,
        expected,
      ),
    ).toBe(true);
    expect(
      prerequisiteLinksMatchCurrent(
        [
          { slug: "leaf-a", versionId: "a-v1", isRequired: true },
          { slug: "leaf-b", versionId: "b-v1", isRequired: true },
        ],
        current,
        expected,
      ),
    ).toBe(false);
  });
});
