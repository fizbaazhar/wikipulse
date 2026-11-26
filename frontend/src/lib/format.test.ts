import { describe, expect, it } from "vitest";
import { formatDelta, safeUrl, timeAgo, wikiLabel, wikiNameAndId, windowMinutes } from "./format";

describe("safeUrl", () => {
  it("allows http(s) links", () => {
    expect(safeUrl("https://en.wikipedia.org/wiki/Mars")).toBe("https://en.wikipedia.org/wiki/Mars");
  });

  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "not a url", "", null])(
    "rejects %s",
    (url) => {
      expect(safeUrl(url)).toBeUndefined();
    },
  );
});

describe("formatting", () => {
  it("formats size changes with a sign", () => {
    expect(formatDelta(1234)).toBe("+1,234");
    expect(formatDelta(-50)).toBe("−50");
    expect(formatDelta(0)).toBe("±0");
    expect(formatDelta(null)).toBe("");
  });

  it("names known wikis and leaves others alone", () => {
    expect(wikiLabel("frwiki")).toBe("French");
    expect(wikiLabel("xxwiki")).toBe("xxwiki");
    expect(wikiNameAndId("frwiki")).toEqual(["French", "frwiki"]);
    expect(wikiNameAndId("xxwiki")).toEqual(["xxwiki", null]);
  });

  it("turns the window into whole minutes", () => {
    expect(windowMinutes(300)).toBe(5);
    expect(windowMinutes(90)).toBe(2);
  });

  it("describes elapsed time", () => {
    const now = 1_800_000_000_000;
    expect(timeAgo(now / 1000 - 3, now)).toBe("just now");
    expect(timeAgo(now / 1000 - 45, now)).toBe("45s ago");
    expect(timeAgo(now / 1000 - 600, now)).toBe("10 min ago");
  });
});
