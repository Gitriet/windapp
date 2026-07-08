"use client";
import { useEffect, useRef, useState } from "react";
import Nav from "@/components/Nav";

// AI-tab (Deel B): een chatvenster dat vragen over wind en getij beantwoordt uit de
// eigen gekalibreerde data. Alleen aanroep op een expliciete vraag (Verstuur/Enter);
// geen achtergrond-calls. De keuzelocatie rijdt mee in ?loc= zodat de andere tabs
// hem behouden — de AI zelf werkt over alle stations.
type Msg = { role: "user" | "assistant"; content: string };

export default function AI() {
  const [locKey, setLocKey] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocKey(new URLSearchParams(window.location.search).get("loc") ?? "");
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, loading]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    setErr("");
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const d = await res.json();
      if (d.error) setErr(d.error);
      else setMsgs([...next, { role: "assistant", content: d.reply }]);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ai-dash">
      <div className="top">
        <h1>Windvoorspelling</h1>
        <Nav active="ai" locKey={locKey} />
      </div>

      <div className="ai-chat" ref={scrollRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}`}>{m.content}</div>
        ))}
        {loading && <div className="ai-msg assistant ai-thinking">…</div>}
        {err && <div className="panel"><span className="badge warn">fout</span> <span className="muted">{err}</span></div>}
      </div>

      <form className="ai-input" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
          placeholder="Stel een vraag over wind of getij…"
          rows={1}
        />
        <button type="submit" className="primary" disabled={loading || !input.trim()}>Vraag</button>
      </form>
    </div>
  );
}
