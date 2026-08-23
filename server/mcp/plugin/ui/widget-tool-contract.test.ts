import { describe, expect, it } from "vitest";
import { SPORTFOLIO_WIDGET_HTML_TEMPLATE } from "./generated-widget";

describe("generated Sportfolio widget tool bindings", () => {
  it("calls only the model-visible trade quote tool", () => {
    expect(SPORTFOLIO_WIDGET_HTML_TEMPLATE).toContain('"get_trade_quote"');
    expect(SPORTFOLIO_WIDGET_HTML_TEMPLATE).not.toContain("get_amm_trade_quote");
  });
});
