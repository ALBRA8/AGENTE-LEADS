"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FileText, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const STYLE_LABELS: Record<string, string> = {
  professional: "Profesional",
  friendly: "Amigable",
  direct: "Directo",
  persuasive: "Persuasivo",
};

export function ProposalsClient() {
  const qc = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["proposals"],
    queryFn: async () => (await fetch("/api/proposals")).json(),
  });

  const proposals = data?.proposals || [];

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Propuesta copiada");
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Propuestas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Historial de propuestas generadas con IA ({proposals.length})
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-1/3 mb-3" />
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : proposals.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              Aún no has generado propuestas. Ve a{" "}
              <a href="/prospectos" className="text-primary hover:underline">
                Prospectos
              </a>
              , abre un prospecto y genera su primera propuesta con IA.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {proposals.map((p: any) => {
            const text = p.editedContent || p.content;
            return (
              <Card key={p.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base">
                      {p.prospect?.name || "—"}
                    </CardTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-[10px]">
                        {STYLE_LABELS[p.style] || p.style}
                      </Badge>
                      {p.isEdited && (
                        <Badge variant="outline" className="text-[10px]">
                          editada
                        </Badge>
                      )}
                      {p.isSent && (
                        <Badge className="text-[10px] bg-emerald-500">
                          enviada
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(p.createdAt).toLocaleString("es-CO", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copy(text, p.id)}
                      >
                        {copiedId === p.id ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">
                    {text}
                  </p>
                  {p.prospect && (
                    <div className="mt-3 pt-3 border-t text-xs text-muted-foreground flex flex-wrap gap-3">
                      {p.prospect.city && <span>{p.prospect.city}</span>}
                      {p.prospect.category && <span>· {p.prospect.category}</span>}
                      <a
                        href={`/prospectos`}
                        className="text-primary hover:underline"
                      >
                        Ver en CRM →
                      </a>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
