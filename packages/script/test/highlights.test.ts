import { describe, expect, test } from "bun:test"
import { parse } from "../src/highlights"

describe("highlights", () => {
  test("parses a full Ruth release note", () => {
    const notes = [
      "## v1.0.0",
      "",
      "### Highlights",
      "",
      "- **Screenshot and Camera Tools**: Ruth can capture the screen or a webcam frame and look at it while she",
      "  works. ([#12](/pull/12))",
      "- **Local by Default**: The `ruth` model runs on Ollama with no API key.",
      "",
      "### Fixes",
      "",
      "- **Not a Highlight**: Ignored.",
    ].join("\n")
    const result = parse(notes)

    expect(result.problems).toEqual([])
    expect(result.items.map((item) => item.title)).toEqual(["Screenshot and Camera Tools", "Local by Default"])
    expect(result.items[0].body).toBe(
      "Ruth can capture the screen or a webcam frame and look at it while she works.",
    )
    expect(result.items[1].body).toBe("The `ruth` model runs on Ollama with no API key.")
    expect(result.items.some((item) => item.body.includes("github.com") || item.body.includes("(["))).toBe(false)
  })

  test("joins wrapped lines and drops multiple trailing links", () => {
    const result = parse(
      [
        "### Highlights",
        "",
        "- **Reopen Closed Tabs:** Right-click the new-session button to bring back a session you closed by",
        "  mistake. ([#123](/pull/123), [#124](/pull/124))",
        "* **Faster [Search](https://example.com)**: Results now stream in.",
        "",
        "### Core",
        "",
        "- **Not a Highlight**: Ignored.",
      ].join("\n"),
    )

    expect(result).toEqual({
      items: [
        {
          title: "Reopen Closed Tabs",
          body: "Right-click the new-session button to bring back a session you closed by mistake.",
        },
        { title: "Faster Search", body: "Results now stream in." },
      ],
      problems: [],
    })
  })

  test("returns nothing without a Highlights section", () => {
    expect(parse("### Core\n\n- Fixed a bug.")).toEqual({ items: [], problems: [] })
  })

  test("reports malformed highlights instead of failing", () => {
    const result = parse("### Highlights\n\n- Plain bullet without a title.\n")
    expect(result.items).toEqual([])
    expect(result.problems).toHaveLength(2)
  })

  test("limits the number and length of highlights", () => {
    const result = parse(
      [
        "### Highlights",
        ...Array.from({ length: 7 }, (_, index) => `- **Item ${index}**: ${"word ".repeat(100)}`),
      ].join("\n"),
    )

    expect(result.items).toHaveLength(5)
    expect(result.items[0].body.length).toBeLessThanOrEqual(300)
    expect(result.items[0].body.endsWith("…")).toBe(true)
    expect(result.problems).toEqual(["Kept the first 5 of 7 highlights"])
  })
})
