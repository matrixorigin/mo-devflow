import { describe, expect, it } from "vitest";
import {
  criticalIssueAiFilterFromHash,
  criticalIssueOwnerFilterFromHash,
  criticalIssueScopeFilterFromHash,
  criticalIssueSortFromHash,
  dashboardHashForView,
  peopleScopeFilterFromHash,
  peopleSortFromHash,
  personalDrilldownFilterFromHash,
  prBoardTabFromHash,
  prScopeFilterFromHash,
  prSortFromHash
} from "./App";

describe("dashboard hash filters", () => {
  it("round-trips issue board filters for shareable drilldown links", () => {
    const hash = dashboardHashForView("Issues", {
      criticalIssueAiFilter: "ai-manual",
      criticalIssueScopeFilter: "s0",
      criticalIssueOwnerFilter: "owner:alice",
      criticalIssueSort: "active_age"
    });

    expect(hash).toBe("issues?ai=ai-manual&scope=s0&owner=owner%3Aalice&sort=active_age");
    expect(criticalIssueAiFilterFromHash(`#${hash}`)).toBe("ai-manual");
    expect(criticalIssueScopeFilterFromHash(`#${hash}`)).toBe("s0");
    expect(criticalIssueOwnerFilterFromHash(`#${hash}`)).toBe("owner:alice");
    expect(criticalIssueSortFromHash(`#${hash}`)).toBe("active_age");
  });

  it("round-trips PR, people, and personal board filters", () => {
    const prHash = dashboardHashForView("PRs", {
      prScopeFilter: "testing_evidence_gap",
      prSort: "testing_wait",
      prBoardTab: "testing"
    });
    expect(prScopeFilterFromHash(`#${prHash}`)).toBe("testing_evidence_gap");
    expect(prSortFromHash(`#${prHash}`)).toBe("testing_wait");
    expect(prBoardTabFromHash(`#${prHash}`)).toBe("testing");

    const peopleHash = dashboardHashForView("People", {
      peopleScopeFilter: "triage",
      peopleSort: "testing_wait"
    });
    expect(peopleScopeFilterFromHash(`#${peopleHash}`)).toBe("triage");
    expect(peopleSortFromHash(`#${peopleHash}`)).toBe("testing_wait");

    const personalHash = dashboardHashForView("Personal", {
      personLogin: "alice",
      personalDrilldownFilter: "pr_attention"
    });
    expect(personalHash).toBe("personal?person=alice&drilldown=pr_attention");
    expect(personalDrilldownFilterFromHash(`#${personalHash}`)).toBe("pr_attention");
  });

  it("falls back from invalid filter params instead of preserving broken links", () => {
    const hash = "#prs?scope=triage&sort=unknown&tab=unknown";

    expect(prScopeFilterFromHash(hash)).toBe("all");
    expect(prSortFromHash(hash)).toBe("risk");
    expect(prBoardTabFromHash(hash)).toBe("rotation");
    expect(criticalIssueOwnerFilterFromHash("#issues?owner=owner%3A")).toBe("all");
  });
});
