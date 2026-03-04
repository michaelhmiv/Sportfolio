import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function AgentComposer({
  value,
  onChange,
  onSend,
  disabled,
  isSending,
  enabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  isSending: boolean;
  enabled: boolean;
}) {
  return (
    <div className="rounded-sm border border-[#2a2e39] bg-[#171c29] px-2.5 py-2.5 shadow-sm">
      <div className="flex items-end gap-2">
        <Textarea
          className="min-h-[58px] flex-1 resize-none rounded-sm border-0 bg-transparent px-0 py-0.5 font-mono text-[13px] leading-6 text-slate-100 shadow-none placeholder:text-slate-500 focus-visible:ring-0"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={2}
          placeholder={
            enabled
              ? 'Try "Review my setup" or "Buy $100 of Nikola Jokic."'
              : "Re-enable the agent in Settings to send a request."
          }
          disabled={!enabled}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <Button
          className="h-10 w-10 shrink-0 rounded-sm bg-amber-500 p-0 text-slate-950 hover:bg-amber-400"
          onClick={onSend}
          disabled={disabled}
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          <span className="sr-only">Send</span>
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500">
        <span>Changes are always staged before they execute.</span>
        <span>Cmd/Ctrl+Enter to send</span>
      </div>
    </div>
  );
}
