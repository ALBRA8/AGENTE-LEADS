"use client";

import { useState, useEffect, useRef } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Send, Bot, User, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "👋 ¡Hola! Soy **AGENTE LEADS**. ¿En qué puedo ayudarte hoy? Puedes pedirme buscar prospectos, redactar propuestas, analizar documentos o verificar correos.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput("");
    const updated = [...messages, { role: "user" as const, content: userText }];
    setMessages(updated);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText }),
      });
      const data = await res.json();
      setMessages([
        ...updated,
        {
          role: "assistant",
          content: data.response || data.reply || data.error || "No hubo respuesta del agente.",
        },
      ]);
    } catch {
      setMessages([
        ...updated,
        {
          role: "assistant",
          content: "⚠️ Hubo un problema comunicándome con el motor de IA. Revisa tu conexión a NVIDIA NIM.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-4rem)] p-4 md:p-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between pb-4 border-b">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Chat en Vivo con el Agente</h1>
            <p className="text-sm text-muted-foreground">
              Conversación directa con el cerebro Kimi K2.5 / GLM vía NVIDIA NIM
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
              ● Agente Conectado
            </Badge>
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                setMessages([
                  {
                    role: "assistant",
                    content: "Historial limpiado. ¿En qué te puedo ayudar ahora?",
                  },
                ])
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex gap-3 ${
                m.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {m.role === "assistant" && (
                <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4" />
                </div>
              )}
              <div
                className={`rounded-2xl px-4 py-2.5 max-w-[80%] text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground ml-auto"
                    : "bg-muted text-foreground border"
                }`}
              >
                {m.content}
              </div>
              {m.role === "user" && (
                <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 animate-pulse">
                <Bot className="h-4 w-4" />
              </div>
              <div className="rounded-2xl px-4 py-2.5 bg-muted text-muted-foreground text-sm border animate-pulse">
                El agente está pensando y ejecutando herramientas...
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>

        <form onSubmit={handleSend} className="pt-4 border-t flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu mensaje, busca prospectos o da una orden al agente..."
            className="flex-1"
            disabled={loading}
          />
          <Button type="submit" disabled={loading || !input.trim()}>
            <Send className="h-4 w-4 mr-2" />
            Enviar
          </Button>
        </form>
      </div>
    </AppShell>
  );
}
