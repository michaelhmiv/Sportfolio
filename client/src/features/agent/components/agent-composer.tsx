import { useRef } from "react";
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const keepComposerVisible = () => {
    if (typeof window === "undefined") {
      return;
    }

    window.requestAnimationFrame(() => {
      textareaRef.current?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    });

    window.setTimeout(() => {
      textareaRef.current?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }, 180);
  };

  return (
    <div
      className="bg-transparent sm:border sm:border-[#252c39] sm:bg-[#111826] sm:px-2 sm:py-1.5"
      data-testid="agent-composer"
    >
      <div className="flex items-end gap-2 border-b border-[#222938] pb-1.5 sm:border-b-0 sm:pb-0">
        <Textarea
          ref={textareaRef}
          className="min-h-[34px] flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-0.5 font-mono text-[13px] leading-5 text-slate-100 shadow-none placeholder:text-slate-500 focus-visible:ring-0 sm:min-h-[52px]"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={2}
          data-testid="agent-composer-input"
          placeholder={
            enabled
              ? 'Try "Review my setup" or "Buy $100 of Nikola Jokic."'
              : "Re-enable the agent in Settings to send a request."
          }
          disabled={!enabled}
          onFocus={keepComposerVisible}
          onClick={keepComposerVisible}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <Button
          className="h-8 w-8 shrink-0 rounded-sm bg-amber-500 p-0 text-slate-950 hover:bg-amber-400 sm:h-9 sm:w-9"
          onClick={onSend}
          disabled={disabled}
          data-testid="agent-composer-send"
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          <span className="sr-only">Send</span>
        </Button>
      </div>
      <div className="mt-1.5 hidden flex-wrap items-center justify-between gap-2 px-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500 sm:flex">
        <span>Changes stage before execution.</span>
        <span>Cmd/Ctrl+Enter to send</span>
      </div>
    </div>
  );
}
