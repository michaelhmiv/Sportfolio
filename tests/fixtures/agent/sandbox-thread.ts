export const sandboxThreadFixture = {
  threadId: "thread_sandbox_1",
  userId: "user_sandbox_1",
  messages: [
    {
      role: "user",
      content: "what do you think about moving all my scouts to Bob?",
    },
    {
      role: "assistant",
      content: "This sounds advisory unless you want me to execute.",
    },
  ],
  metadata: {
    semanticRoute: "top_targets_today",
    sport: "NBA",
  },
} as const;
