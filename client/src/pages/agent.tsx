import AgentShell from "@/features/agent/agent-shell";

export default function AgentPage() {
  return (
    <div className="h-[calc(100dvh-7.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-0 sm:h-[calc(100dvh-3.5rem-env(safe-area-inset-top))]">
      <AgentShell />
    </div>
  );
}
