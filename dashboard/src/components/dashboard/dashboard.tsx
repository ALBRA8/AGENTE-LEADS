// ============================================================
// src/components/dashboard/dashboard.tsx
// ============================================================

"use client";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Target,
  FileText,
  Star,
  TrendingUp,
  MapPin,
  Search as SearchIcon,
  Trophy,
  Brain,
  Lightbulb,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

const TIER_COLORS: Record<string, string> = {
  TIER_A: "#16a34a",
  TIER_B: "#0891b2",
  TIER_C: "#d97706",
  TIER_F: "#dc2626",
};
const TIER_LABELS: Record<string, string> = {
  TIER_A: "Tier A (Hot)",
  TIER_B: "Tier B (Warm)",
  TIER_C: "Tier C (Cold)",
  TIER_F: "Tier F (Filtrado)",
};
const STATUS_LABELS: Record<string, string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  INTERESTED: "Interesado",
  NOT_INTERESTED: "No interesado",
  CLIENT: "Cliente",
};

export function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard");
      if (r.status === 401) throw new Error("UNAUTHORIZED");
      return r.json();
    },
  });

  const { data: insightsData } = useQuery({
    queryKey: ["insights"],
    queryFn: async () => {
      const r = await fetch("/api/insights");
      if (!r.ok) return null;
      return r.json();
    },
  });

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (!data) return null;

  const k = data.kpis;

  const tierData = Object.entries(k.tierBreakdown).map(([k, v]) => ({
    name: TIER_LABELS[k],
    value: v,
    color: TIER_COLORS[k],
  }));
  const statusData = Object.entries(k.statusBreakdown).map(([k, v]) => ({
    name: STATUS_LABELS[k],
    value: v,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Resumen de prospección y calidad de leads
        </p>
      </div>

      {/* KPIs row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Prospectos totales"
          value={k.totalProspects}
          icon={<Users className="h-4 w-4" />}
          color="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
        />
        <KpiCard
          label="Leads de alta coincidencia"
          value={k.highMatchCount}
          icon={<Trophy className="h-4 w-4" />}
          color="bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300"
          hint={`${k.tierBreakdown.TIER_A} Tier A + ${k.tierBreakdown.TIER_B} Tier B`}
        />
        <KpiCard
          label="Propuestas generadas"
          value={k.totalProposals}
          icon={<FileText className="h-4 w-4" />}
          color="bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"
        />
        <KpiCard
          label="Clientes conseguidos"
          value={k.statusBreakdown.CLIENT}
          icon={<TrendingUp className="h-4 w-4" />}
          color="bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300"
          hint={`de ${k.totalProspects} prospectos`}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribución por Tier</CardTitle>
            <CardDescription>
              Calidad de los prospectos en pipeline
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={tierData} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {tierData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Estado del CRM</CardTitle>
            <CardDescription>
              Distribución por estado de contacto
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={statusData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={40}
                  label={(d) => `${d.name}: ${d.value}`}
                  labelLine={false}
                >
                  {statusData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={
                        ["#94a3b8", "#3b82f6", "#8b5cf6", "#f59e0b", "#10b981"][
                          i % 5
                        ]
                      }
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* City + Category */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4" /> Prospectos por ciudad
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.byCity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos aún.</p>
            ) : (
              data.byCity.map((c: any) => {
                const max = Math.max(...data.byCity.map((x: any) => x.count));
                const pct = (c.count / max) * 100;
                return (
                  <div key={c.city} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">{c.city}</span>
                      <span className="text-muted-foreground">{c.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" /> Categorías top
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.byCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos aún.</p>
            ) : (
              data.byCategory.map((c: any) => (
                <div
                  key={c.category}
                  className="flex items-center justify-between text-sm py-1 border-b last:border-0"
                >
                  <span className="truncate pr-2">{c.category}</span>
                  <Badge variant="secondary">{c.count}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent searches */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <SearchIcon className="h-4 w-4" /> Búsquedas recientes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentSearches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no has realizado búsquedas. Ve a{" "}
              <a href="/buscar" className="text-primary hover:underline">
                Buscar Clientes
              </a>{" "}
              para empezar.
            </p>
          ) : (
            <div className="space-y-3">
              {data.recentSearches.map((s: any) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 py-2 border-b last:border-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {s.category || "Cualquier categoría"} en {s.city}
                    </div>
                    {s.keywords && (
                      <div className="text-xs text-muted-foreground truncate">
                        "{s.keywords}"
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px]">
                      {s.sourceAdapter}
                    </Badge>
                    <Badge
                      variant={
                        s.status === "completed"
                          ? "default"
                          : s.status === "failed"
                          ? "destructive"
                          : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {s.status}
                    </Badge>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {s.foundCount} encontrados · {s.tierACount + s.tierBCount}{" "}
                      cualificados
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Closed-loop insights */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-4 w-4" /> Insights aprendidos (closed-loop)
          </CardTitle>
          <CardDescription>
            Patrones descubiertos automáticamente de tus outcomes reales
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!insightsData ? (
            <p className="text-sm text-muted-foreground">
              Cargando insights…
            </p>
          ) : insightsData.stored?.insightText ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-xs text-muted-foreground">
                  Última actualización:{" "}
                  {new Date(insightsData.stored.updatedAt).toLocaleString("es-CO")}
                </span>
                <Badge variant="outline" className="text-[10px] ml-auto">
                  {insightsData.outcomesCount} outcomes
                </Badge>
              </div>
              <pre className="text-xs whitespace-pre-wrap bg-muted/30 p-3 rounded border text-foreground">
                {insightsData.stored.insightText}
              </pre>
            </div>
          ) : insightsData.liveAnalysis ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Aún no hay insights almacenados. Análisis en vivo:
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-xs">
                  <span className="text-muted-foreground">Outcomes totales:</span>{" "}
                  <span className="font-medium">
                    {insightsData.liveAnalysis.totalOutcomes}
                  </span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Conversión:</span>{" "}
                  <span className="font-medium">
                    {(insightsData.liveAnalysis.conversionRate * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
              {insightsData.liveAnalysis.topConvertingFeatures?.length > 0 && (
                <div className="pt-2 border-t">
                  <div className="text-xs text-muted-foreground mb-2">
                    Features que más convierten:
                  </div>
                  {insightsData.liveAnalysis.topConvertingFeatures
                    .slice(0, 5)
                    .map((f: any, i: number) => (
                      <div
                        key={i}
                        className="text-xs py-1 border-b last:border-0 flex justify-between"
                      >
                        <span>
                          {f.feature}={f.condition}
                        </span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          {(f.rate * 100).toFixed(0)}% (n={f.sample})
                        </span>
                      </div>
                    ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground pt-2">
                Marca más prospectos como Cliente/No interesado para que el
                sistema aprenda patrones más precisos.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sin datos aún. Marca prospectos como Cliente o No interesado en el
              CRM para empezar a aprender.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  color,
  hint,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {hint && (
              <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>
            )}
          </div>
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}
          >
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-72 mt-2" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-12 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[...Array(2)].map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[260px] w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
