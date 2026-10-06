"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Search, MapPin, Tag, Loader2, Sparkles, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export function SearchClient() {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    city: "Bogotá",
    country: "Colombia",
    category: "Clínica de estética",
    keywords: "",
    sourceAdapter: "Web Search (z.ai)",
    offerId: "",
    expandQueries: true,
  });

  const { data: offersData } = useQuery({
    queryKey: ["offers"],
    queryFn: async () => (await fetch("/api/offers")).json(),
  });
  const offers = offersData?.offers || [];

  const { data: integData } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => (await fetch("/api/integrations")).json(),
  });
  const configured = integData?.configured || {};

  // Build available adapters
  const availableAdapters: { name: string; desc: string; ready: boolean; recommended?: boolean }[] = [
    {
      name: "Web Search (z.ai)",
      desc: "Google real vía SDK Z.ai. Sin API key. Devuelve negocios reales con web, teléfono y email extraído.",
      ready: true,
      recommended: true,
    },
    {
      name: "Demo",
      desc: "Datos demo inventados (clínicas estética Colombia)",
      ready: true,
    },
    {
      name: "Web Scraper",
      desc: "Scraper web directo (Google bloquea desde el sandbox)",
      ready: true,
    },
    {
      name: "Google Places API",
      desc: "Oficial Google Places API (requiere API key en Ajustes)",
      ready: Boolean(configured.googlePlaces),
    },
  ];

  const searchMutation = useMutation({
    mutationFn: async (input: any) => {
      const r = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.error || "Search failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      toast.success(
        `Búsqueda completada: ${data.found} prospectos encontrados. ${data.tierA + data.tierB} de alta coincidencia.`
      );
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["prospects"] });
      router.push("/prospectos");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.city) {
      toast.error("Ciudad es obligatoria");
      return;
    }
    if (!form.offerId && offers.length > 0) {
      setForm({ ...form, offerId: offers[0].id });
    }
    searchMutation.mutate({
      ...form,
      offerId: form.offerId || offers[0]?.id,
      expandQueries: form.expandQueries,
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Buscar Clientes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Define los parámetros de búsqueda. El sistema ejecutará el pipeline
          de calificación de 5 capas sobre cada prospecto encontrado.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" /> Nueva búsqueda
          </CardTitle>
          <CardDescription>
            Selecciona oferta, ciudad y categoría. La búsqueda qualificará automáticamente cada prospecto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="offerId">Oferta</Label>
              <Select
                value={form.offerId}
                onValueChange={(v) => setForm({ ...form, offerId: v })}
              >
                <SelectTrigger id="offerId">
                  <SelectValue placeholder="Selecciona una oferta" />
                </SelectTrigger>
                <SelectContent>
                  {offers.map((o: any) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {offers.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  No tienes ofertas.{" "}
                  <a href="/ajustes" className="underline">
                    Crear oferta en Ajustes
                  </a>
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="city">
                  <MapPin className="h-3 w-3 inline mr-1" /> Ciudad *
                </Label>
                <Input
                  id="city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  placeholder="Bogotá"
                  required
                />
              </div>
              <div>
                <Label htmlFor="country">País</Label>
                <Input
                  id="country"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                  placeholder="Colombia"
                />
              </div>
              <div>
                <Label htmlFor="category">
                  <Tag className="h-3 w-3 inline mr-1" /> Categoría / Nicho
                </Label>
                <Input
                  id="category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Clínica de estética"
                />
              </div>
              <div>
                <Label htmlFor="keywords">Palabras clave (opcional)</Label>
                <Input
                  id="keywords"
                  value={form.keywords}
                  onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                  placeholder="medicina estética, láser, botox"
                />
              </div>
            </div>

            <div>
              <Label>Fuente de leads</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1">
                {availableAdapters.map((a) => (
                  <button
                    key={a.name}
                    type="button"
                    onClick={() => setForm({ ...form, sourceAdapter: a.name })}
                    className={`text-left p-3 rounded-md border-2 transition-colors relative ${
                      form.sourceAdapter === a.name
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    } ${!a.ready ? "opacity-50 cursor-not-allowed" : ""}`}
                    disabled={!a.ready}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{a.name}</span>
                      {a.recommended && (
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 px-1.5 py-0.5 rounded-full">
                          RECOMENDADO
                        </span>
                      )}
                      {a.ready && !a.recommended && (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      )}
                      {!a.ready && (
                        <span className="text-[10px] text-muted-foreground">
                          no configurado
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {a.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <Button
              type="submit"
              disabled={searchMutation.isPending || offers.length === 0}
              className="w-full"
              size="lg"
            >
              {searchMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Buscando y calificando prospectos…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Buscar y calificar prospectos
                </>
              )}
            </Button>
            {searchMutation.isPending && (
              <p className="text-xs text-muted-foreground text-center">
                {form.expandQueries
                  ? "Multi-query expansion activa: generando 15-25 queries, buscando + enriqueciendo con tech stack y freshness check por prospecto. Puede tardar 2-4 minutos."
                  : "Esto puede tardar 30-60 segundos (calificación IA por prospecto)"}
              </p>
            )}

            {/* Multi-query toggle */}
            <div className="flex items-center gap-3 pt-3 border-t">
              <Switch
                id="expandQueries"
                checked={form.expandQueries}
                onCheckedChange={(c) => setForm({ ...form, expandQueries: c })}
              />
              <Label htmlFor="expandQueries" className="text-xs cursor-pointer flex-1">
                <span className="font-medium">Multi-query expansion (10x volumen)</span>
                <span className="block text-muted-foreground text-[11px]">
                  La IA genera 15-25 queries relacionadas (barrios, sinónimos, servicios complementarios) y las ejecuta en paralelo.
                </span>
              </Label>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
