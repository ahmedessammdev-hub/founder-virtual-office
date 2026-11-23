import React, { useState } from "react";
import { Check, Copy } from "lucide-react";

function renderInline(text: string): React.ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return tokens.map((tok, i) => {
    if (tok.startsWith("`") && tok.endsWith("`") && tok.length >= 2) {
      return (
        <code
          key={i}
          dir="ltr"
          className="px-1 py-0.5 mx-0.5 rounded bg-studio-subtle border border-studio-border font-mono text-[11.5px] text-studio-ink"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    if (tok.startsWith("**") && tok.endsWith("**") && tok.length >= 4) {
      return (
        <strong key={i} className="font-semibold text-studio-ink">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    const linkMatch = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(tok);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-studio-accent underline hover:opacity-85"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return <React.Fragment key={i}>{tok}</React.Fragment>;
  });
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div dir="ltr" className="my-2 rounded-md border border-studio-border bg-studio-ground overflow-hidden text-left">
      <div className="px-2.5 py-1 border-b border-studio-border bg-studio-subtle/70 flex items-center justify-between text-[10.5px] font-mono text-studio-muted">
        <span>{lang || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-studio-muted hover:text-studio-ink"
        >
          {copied ? <Check className="w-3 h-3 text-studio-emerald" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="p-2.5 text-[11.5px] font-mono text-studio-ink overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Safe React-only Markdown message renderer supporting fenced code blocks with Copy,
 * inline code, bold text, lists, headings, and validated external HTTP(S) links.
 */
export function MarkdownMessage({ content }: { content: string }) {
  const segments = content.split(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g);
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < segments.length; i += 3) {
    const plain = segments[i] ?? "";
    const lang = segments[i + 1];
    const code = segments[i + 2];

    if (plain.trim()) {
      const lines = plain.split(/\r?\n/);
      nodes.push(
        <div key={`p-${i}`} dir="auto" className="space-y-1.5">
          {lines.map((line, lineIdx) => {
            const trimmed = line.trim();
            if (!trimmed) return <div key={lineIdx} className="h-1" />;
            if (trimmed.startsWith("### ")) {
              return (
                <h4 key={lineIdx} className="text-[13px] font-semibold text-studio-ink pt-1">
                  {renderInline(trimmed.slice(4))}
                </h4>
              );
            }
            if (trimmed.startsWith("## ") || trimmed.startsWith("# ")) {
              return (
                <h3 key={lineIdx} className="text-[14px] font-semibold text-studio-ink pt-1">
                  {renderInline(trimmed.replace(/^#{1,3}\s+/, ""))}
                </h3>
              );
            }
            if (/^[-*]\s+/.test(trimmed)) {
              return (
                <div key={lineIdx} className="flex items-start gap-2 ps-1">
                  <span className="text-studio-accent mt-0.5">•</span>
                  <span className="flex-1">{renderInline(trimmed.replace(/^[-*]\s+/, ""))}</span>
                </div>
              );
            }
            if (/^\d+\.\s+/.test(trimmed)) {
              const numMatch = /^(\d+\.)\s+(.*)$/.exec(trimmed);
              return (
                <div key={lineIdx} className="flex items-start gap-2 ps-1">
                  <span dir="ltr" className="font-mono text-[11.5px] text-studio-muted mt-0.5">
                    {numMatch?.[1]}
                  </span>
                  <span className="flex-1">{renderInline(numMatch?.[2] ?? trimmed)}</span>
                </div>
              );
            }
            return <p key={lineIdx}>{renderInline(line)}</p>;
          })}
        </div>,
      );
    }

    if (code !== undefined) {
      nodes.push(<CodeBlock key={`c-${i}`} lang={lang ?? ""} code={code.replace(/\n$/, "")} />);
    }
  }

  return <div className="space-y-1.5 leading-relaxed break-words">{nodes}</div>;
}
