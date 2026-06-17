import { describe, expect, test, vi } from "vitest";

vi.mock("onebots", () => ({
  CommonTypes: {},
  Dict: function () {},
}));

import { CQCode } from "../cqcode.js";

describe("CQCode", () => {
  // ===================== parse =====================

  describe("parse", () => {
    test("parses a single face CQ code", () => {
      const result = CQCode.parse("[CQ:face,id=123]");
      expect(result).toEqual([
        { type: "face", data: { id: "123" } },
      ]);
    });

    test("parses an image CQ code with file and url", () => {
      const result = CQCode.parse(
        "[CQ:image,file=abc.jpg,url=https://example.com/img.jpg]",
      );
      expect(result).toEqual([
        {
          type: "image",
          data: { file: "abc.jpg", url: "https://example.com/img.jpg" },
        },
      ]);
    });

    test("parses a reply CQ code", () => {
      const result = CQCode.parse("[CQ:reply,id=12345]");
      expect(result).toEqual([
        { type: "reply", data: { id: "12345" } },
      ]);
    });

    test("parses a shake CQ code with no params", () => {
      const result = CQCode.parse("[CQ:shake]");
      expect(result).toEqual([
        { type: "shake", data: {} },
      ]);
    });

    test("parses multiple CQ codes interleaved with text", () => {
      const result = CQCode.parse(
        "Hello [CQ:face,id=1] world [CQ:image,file=test.png]",
      );
      expect(result).toEqual([
        { type: "text", data: { text: "Hello " } },
        { type: "face", data: { id: "1" } },
        { type: "text", data: { text: " world " } },
        { type: "image", data: { file: "test.png" } },
      ]);
    });

    test("unescapes HTML entities in param values", () => {
      const result = CQCode.parse("[CQ:image,file=test&amp;name.jpg]");
      expect(result).toEqual([
        { type: "image", data: { file: "test&name.jpg" } },
      ]);
    });

    test("unescapes brackets in param values", () => {
      const result = CQCode.parse(
        "[CQ:image,file=&#91;test&#93;.jpg]",
      );
      expect(result).toEqual([
        { type: "image", data: { file: "[test].jpg" } },
      ]);
    });

    test("unescapes commas inside param values", () => {
      const result = CQCode.parse(
        "[CQ:image,file=a&#44;b.jpg,url=http://x]",
      );
      expect(result).toEqual([
        {
          type: "image",
          data: { file: "a,b.jpg", url: "http://x" },
        },
      ]);
    });

    test("returns a text segment for plain text without CQ codes", () => {
      const result = CQCode.parse("Hello, world!");
      expect(result).toEqual([
        { type: "text", data: { text: "Hello, world!" } },
      ]);
    });

    test("returns empty array for empty string", () => {
      const result = CQCode.parse("");
      expect(result).toEqual([]);
    });

    test("unescapes text outside CQ codes", () => {
      const result = CQCode.parse("Hello &amp; world");
      expect(result).toEqual([
        { type: "text", data: { text: "Hello & world" } },
      ]);
    });
  });

  // ===================== encode =====================

  describe("encode", () => {
    test("encodes a face segment", () => {
      const result = CQCode.encode(CQCode.face(123));
      expect(result).toBe("[CQ:face,id=123]");
    });

    test("encodes an image segment with file and url", () => {
      const result = CQCode.encode(
        CQCode.image("abc.jpg", {
          url: "https://example.com/img.jpg",
        }),
      );
      expect(result).toBe(
        "[CQ:image,file=abc.jpg,url=https://example.com/img.jpg]",
      );
    });

    test("encodes a reply segment", () => {
      const result = CQCode.encode(CQCode.reply(12345));
      expect(result).toBe("[CQ:reply,id=12345]");
    });

    test("encodes a text segment as plain text (not wrapped in CQ)", () => {
      const result = CQCode.encode(CQCode.text("Hello"));
      expect(result).toBe("Hello");
    });

    test("escapes special characters in text encoding", () => {
      const result = CQCode.encode(CQCode.text("a&b[c]d"));
      expect(result).toBe("a&amp;b&#91;c&#93;d");
    });

    test("escapes commas in CQ param values", () => {
      const result = CQCode.encode({
        type: "image",
        data: { file: "a,b.jpg" },
      });
      expect(result).toBe("[CQ:image,file=a&#44;b.jpg]");
    });

    test("encodes a shake segment (no params)", () => {
      const result = CQCode.encode(CQCode.shake());
      expect(result).toBe("[CQ:shake]");
    });

    test("encodes an at segment", () => {
      const result = CQCode.encode(CQCode.at(12345));
      expect(result).toBe("[CQ:at,qq=12345]");
    });

    test("encodes at all segment", () => {
      const result = CQCode.encode(CQCode.at("all"));
      expect(result).toBe("[CQ:at,qq=all]");
    });
  });

  // ===================== stringify =====================

  describe("stringify", () => {
    test("joins multiple segments into a single CQ code string", () => {
      const result = CQCode.stringify([
        CQCode.text("Hello "),
        CQCode.face(1),
        CQCode.text(" world"),
      ]);
      expect(result).toBe("Hello [CQ:face,id=1] world");
    });

    test("produces a round-trippable string (stringify -> parse)", () => {
      const segments = [
        CQCode.text("Check this: "),
        CQCode.image("pic.jpg", { url: "https://example.com/pic.jpg" }),
        CQCode.text(" -- cool, right?"),
      ];
      const str = CQCode.stringify(segments);
      const parsed = CQCode.parse(str);
      expect(parsed).toEqual(segments);
    });
  });

  // ===================== escape / unescape =====================

  describe("escape / unescape", () => {
    test("escape outside CQ code replaces & [ ]", () => {
      expect(CQCode.escape("a&b[c]d")).toBe("a&amp;b&#91;c&#93;d");
    });

    test("escape inside CQ code also replaces commas", () => {
      expect(CQCode.escape("a,b", true)).toBe("a&#44;b");
    });

    test("unescape restores all entities to their original characters", () => {
      expect(CQCode.unescape("a&amp;b&#91;c&#93;d&#44;e")).toBe(
        "a&b[c]d,e",
      );
    });

    test("escape and unescape are round-trip inverses", () => {
      const inputs = [
        "plain text",
        "a&b",
        "with [brackets]",
        "and,commas",
        "mixed & [ ] , stuff",
      ];
      for (const input of inputs) {
        const escaped = CQCode.escape(input, true);
        const unescaped = CQCode.unescape(escaped);
        expect(unescaped).toBe(input);
      }
    });
  });

  // ===================== toText =====================

  describe("toText", () => {
    test("extracts text from mixed segments", () => {
      const segments = [
        CQCode.text("Hello "),
        CQCode.face(1),
        CQCode.text(" world"),
      ];
      expect(CQCode.toText(segments)).toBe("Hello  world");
    });

    test("returns empty string when no text segments exist", () => {
      const segments = [CQCode.face(1), CQCode.image("a.png")];
      expect(CQCode.toText(segments)).toBe("");
    });

    test("returns empty string for empty segment list", () => {
      expect(CQCode.toText([])).toBe("");
    });
  });

  // ===================== hasSegmentType / getSegmentsByType =====================

  describe("hasSegmentType / getSegmentsByType", () => {
    const segments = [
      CQCode.text("Hello"),
      CQCode.face(1),
      CQCode.image("a.png"),
    ];

    test("hasSegmentType returns true when the type exists", () => {
      expect(CQCode.hasSegmentType(segments, "face")).toBe(true);
    });

    test("hasSegmentType returns false when the type is missing", () => {
      expect(CQCode.hasSegmentType(segments, "reply")).toBe(false);
    });

    test("getSegmentsByType filters by type correctly", () => {
      const result = CQCode.getSegmentsByType(segments, "text");
      expect(result).toEqual([{ type: "text", data: { text: "Hello" } }]);
    });

    test("getSegmentsByType returns empty array for unknown type", () => {
      expect(CQCode.getSegmentsByType(segments, "reply")).toEqual([]);
    });
  });

  // ===================== factory helpers =====================

  describe("factory helpers", () => {
    test("CQCode.text creates a text segment", () => {
      expect(CQCode.text("hello")).toEqual({
        type: "text",
        data: { text: "hello" },
      });
    });

    test("CQCode.face creates a face segment with string id", () => {
      expect(CQCode.face("123")).toEqual({
        type: "face",
        data: { id: "123" },
      });
    });

    test("CQCode.face creates a face segment with numeric id", () => {
      expect(CQCode.face(123)).toEqual({
        type: "face",
        data: { id: "123" },
      });
    });

    test("CQCode.at creates an at segment", () => {
      expect(CQCode.at(12345)).toEqual({
        type: "at",
        data: { qq: "12345" },
      });
    });

    test("CQCode.at('all') creates an @all segment", () => {
      expect(CQCode.at("all")).toEqual({
        type: "at",
        data: { qq: "all" },
      });
    });

    test("CQCode.image creates an image segment with optional url", () => {
      const seg = CQCode.image("test.jpg", {
        url: "https://example.com/test.jpg",
      });
      expect(seg).toEqual({
        type: "image",
        data: {
          file: "test.jpg",
          url: "https://example.com/test.jpg",
        },
      });
    });

    test("CQCode.image with flash type", () => {
      const seg = CQCode.image("flash.gif", { type: "flash" });
      expect(seg).toEqual({
        type: "image",
        data: { file: "flash.gif", type: "flash" },
      });
    });

    test("CQCode.reply creates a reply segment", () => {
      expect(CQCode.reply(67890)).toEqual({
        type: "reply",
        data: { id: "67890" },
      });
    });

    test("CQCode.shake creates a shake segment", () => {
      expect(CQCode.shake()).toEqual({
        type: "shake",
        data: {},
      });
    });
  });
});
