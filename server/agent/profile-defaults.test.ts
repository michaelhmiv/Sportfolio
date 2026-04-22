import {
  LEGACY_SCOUT_AGENT_SYSTEM_PROMPT,
  LEGACY_SCOUT_AGENT_SYSTEM_PROMPT_V2,
  LEGACY_SCOUT_AGENT_USER_PROMPT_TEMPLATE,
  LEGACY_SCOUT_AGENT_USER_PROMPT_TEMPLATE_V2,
  isLegacyScoutAgentSystemPrompt,
  isLegacyScoutAgentUserPromptTemplate,
} from "./profile-defaults";

describe("profile-defaults legacy prompt detection", () => {
  it("matches both legacy scout system prompt variants", () => {
    expect(isLegacyScoutAgentSystemPrompt(LEGACY_SCOUT_AGENT_SYSTEM_PROMPT)).toBe(true);
    expect(isLegacyScoutAgentSystemPrompt(LEGACY_SCOUT_AGENT_SYSTEM_PROMPT_V2)).toBe(true);
    expect(
      isLegacyScoutAgentSystemPrompt(
        `  ${LEGACY_SCOUT_AGENT_SYSTEM_PROMPT_V2.replaceAll(" ", "   ")}  `,
      ),
    ).toBe(true);
  });

  it("matches both legacy scout user prompt template variants", () => {
    expect(isLegacyScoutAgentUserPromptTemplate(LEGACY_SCOUT_AGENT_USER_PROMPT_TEMPLATE)).toBe(
      true,
    );
    expect(isLegacyScoutAgentUserPromptTemplate(LEGACY_SCOUT_AGENT_USER_PROMPT_TEMPLATE_V2)).toBe(
      true,
    );
    expect(
      isLegacyScoutAgentUserPromptTemplate(
        ` ${LEGACY_SCOUT_AGENT_USER_PROMPT_TEMPLATE_V2.replaceAll(" ", "\n")} `,
      ),
    ).toBe(true);
  });

  it("does not treat portfolio prompts as legacy scout defaults", () => {
    expect(
      isLegacyScoutAgentSystemPrompt(
        "You are Hermes, Sportfolio's product operator. Use native Sportfolio tools first.",
      ),
    ).toBe(false);
    expect(
      isLegacyScoutAgentUserPromptTemplate(
        "Act like my Sportfolio portfolio operator and keep me focused on the next useful move.",
      ),
    ).toBe(false);
  });
});
