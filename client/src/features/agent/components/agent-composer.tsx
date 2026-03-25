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
      className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2"
      data-testid="agent-composer"
    >
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          className="min-h-[36px] flex-1 resize-none rounded-lg border-0 bg-transparent px-1 py-1 text-[13px] leading-5 text-white/90 shadow-none placeholder:text-white/30 focus-visible:ring-0 sm:min-h-[52px]"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={2}
          data-testid="agent-composer-input"
          placeholder={
            enabled
              ? 'Try "Review my setup" or "Buy $100 of Nikola Jokic"'
              : "Re-enable the agent in Configure to send a request."
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
          className="h-9 w-9 shrink-0 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 p-0 text-black hover:from-amber-400 hover:to-amber-500"
          onClick={onSend}
          disabled={disabled}
          data-testid="agent-composer-send"
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          <span className="sr-only">Send</span>
        </Button>
      </div>
      <div className="mt-1.5 hidden items-center justify-between px-1 text-[10px] text-white/25 sm:flex">
        <span>Changes stage before execution</span>
        <span>Cmd/Ctrl+Enter to send</span>
      </div>
    </div>
  );
}
