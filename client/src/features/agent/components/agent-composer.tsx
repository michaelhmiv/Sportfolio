import { useRef, useState, useCallback, useEffect } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { matchSlashCommands, type SlashCommand } from "../lib/slash-commands";
import { cn } from "@/lib/utils";

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
  onSend: (messageOverride?: string) => void;
  disabled: boolean;
  isSending: boolean;
  enabled: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [slashMatches, setSlashMatches] = useState<SlashCommand[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const updateSlashMatches = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
      const matches = matchSlashCommands(trimmed);
      setSlashMatches(matches);
      setSelectedIndex(0);
    } else {
      setSlashMatches([]);
    }
  }, []);

  const selectCommand = useCallback(
    (cmd: SlashCommand) => {
      const needsInput = cmd.command === "/team";
      onChange(cmd.prompt);
      setSlashMatches([]);
      if (!needsInput) {
        onSend(cmd.prompt);
      } else {
        // Focus textarea for user to complete the prompt
        textareaRef.current?.focus();
      }
    },
    [onChange, onSend],
  );

  // Close menu on escape or outside click
  useEffect(() => {
    if (slashMatches.length === 0) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSlashMatches([]);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [slashMatches.length]);

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
      className="relative rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2"
      data-testid="agent-composer"
    >
      {/* Slash command autocomplete menu */}
      {slashMatches.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-xl border border-white/[0.08] bg-[#1a1a2e] shadow-xl">
          <div className="max-h-[280px] overflow-y-auto py-1">
            {slashMatches.map((cmd, index) => {
              const Icon = cmd.icon;
              return (
                <button
                  key={cmd.command}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                    index === selectedIndex
                      ? "bg-white/[0.08] text-white"
                      : "text-white/70 hover:bg-white/[0.04]",
                  )}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectCommand(cmd);
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0 text-amber-400/70" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-medium">{cmd.command}</span>
                      <span className="text-xs text-white/40">{cmd.label}</span>
                    </div>
                    <p className="text-[11px] text-white/30 truncate">{cmd.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          className="min-h-[36px] flex-1 resize-none rounded-lg border-0 bg-transparent px-1 py-1 text-[13px] leading-5 text-white/90 shadow-none placeholder:text-white/30 focus-visible:ring-0 sm:min-h-[52px]"
          value={value}
          onChange={(event) => {
            const newValue = event.target.value;
            onChange(newValue);
            updateSlashMatches(newValue);
          }}
          rows={2}
          data-testid="agent-composer-input"
          placeholder={
            enabled
              ? 'Try "Review my setup" or type / for commands'
              : "Re-enable the agent in Configure to send a request."
          }
          disabled={!enabled}
          onFocus={keepComposerVisible}
          onClick={keepComposerVisible}
          onKeyDown={(event) => {
            // Slash menu navigation
            if (slashMatches.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((prev) => (prev < slashMatches.length - 1 ? prev + 1 : 0));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((prev) => (prev > 0 ? prev - 1 : slashMatches.length - 1));
                return;
              }
              if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                selectCommand(slashMatches[selectedIndex]);
                return;
              }
              if (event.key === "Tab") {
                event.preventDefault();
                selectCommand(slashMatches[selectedIndex]);
                return;
              }
            }

            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <Button
          className="h-9 w-9 shrink-0 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 p-0 text-black hover:from-amber-400 hover:to-amber-500"
          onClick={() => onSend()}
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
