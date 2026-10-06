"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Star,
  Phone,
  Globe,
  Mail,
  MapPin,
  FileText,
  ChevronLeft,
  ChevronRight,
  Eye,
  Filter,
  Plus,
  Trash2,
  Loader2,
  Sparkles,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const TIER_META: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  TIER_A: {
    label: "Tier A",
    color: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-100 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900",
  },
  TIER_B: {
    label: "Tier B",
    color: "text-cyan-700 dark:text-cyan-300",
    bg: "bg-cyan-100 dark:bg-cyan-950/50 border-cyan-200 dark:border-cyan-900",
  },
  TIER_C: {
    label: "Tier C",
    color: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-100 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900",
  },
  TIER_F: {
    label: "Filtrado",
    color: "text-red-700 dark:text-red-300",
    bg: "bg-red-100 dark:bg-red-950/50 border-red-200 dark:border-red-900",
  },
  PENDING: {
    label: "Pendiente",
    color: "text-slate-700 dark:text-slate-300",
    bg: "bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800",
  },
};

const STATUS_META: Record<string, string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  INTERESTED: "Interesado",
  NOT_INTERESTED: "No interesado",
  CLIENT: "Cliente",
};

export function CrmClient() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    city: "ALL",
    category: "ALL",
    tier: "ALL",
    status: "ALL",
    search: "",
    favorite: false,
    includeFiltered: false,
    sort: "createdAt:desc",
  });
  const [selectedProspectId, setSelectedProspectId] = useState<string | null>(
    null
  );

  const { data, isLoading } = useQuery({
    queryKey: ["prospects", { ...filters, page }],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
        ...Object.fromEntries(
          Object.entries(filters).map(([k, v]) => [
            k,
            typeof v === "boolean" ? (v ? "1" : "0") : v,
          ])
        ),
      });
      const r = await fetch(`/api/prospects?${params}`);
      return r.json();
    },
    placeholderData: (prev: any) => prev,
  });

  const updateMutation = useMutation({
    mutationFn: async (args: { id: string; fields: any }) => {
      const r = await fetch("/api/prospects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const prospects = data?.prospects || [];
  const totalPages = data?.totalPages || 1;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Prospectos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            CRM con calificación automática de 5 capas ·{" "}
            {data?.total || 0} prospectos
          </p>
        </div>
        <Button asChild>
          <a href="/buscar">
            <Plus className="h-4 w-4 mr-2" /> Nueva búsqueda
          </a>
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div className="col-span-2 lg:col-span-2 relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, dirección, categoría…"
                value={filters.search}
                onChange={(e) =>
                  setFilters({ ...filters, search: e.target.value })
                }
                className="pl-9"
              />
            </div>
            <Select
              value={filters.city}
              onValueChange={(v) => setFilters({ ...filters, city: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Ciudad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas las ciudades</SelectItem>
                {(data?.filters?.cities || []).map((c: string) => (
                  <SelectItem key={c} value={c as string}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.category}
              onValueChange={(v) => setFilters({ ...filters, category: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Categoría" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas</SelectItem>
                {(data?.filters?.categories || []).map((c: string) => (
                  <SelectItem key={c} value={c as string}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.tier}
              onValueChange={(v) => setFilters({ ...filters, tier: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los tiers</SelectItem>
                <SelectItem value="TIER_A">Tier A (Hot)</SelectItem>
                <SelectItem value="TIER_B">Tier B (Warm)</SelectItem>
                <SelectItem value="TIER_C">Tier C (Cold)</SelectItem>
                <SelectItem value="TIER_F">Tier F (Filtrado)</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.status}
              onValueChange={(v) => setFilters({ ...filters, status: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los estados</SelectItem>
                <SelectItem value="NEW">Nuevo</SelectItem>
                <SelectItem value="CONTACTED">Contactado</SelectItem>
                <SelectItem value="INTERESTED">Interesado</SelectItem>
                <SelectItem value="NOT_INTERESTED">No interesado</SelectItem>
                <SelectItem value="CLIENT">Cliente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-4 mt-3 pt-3 border-t flex-wrap">
            <div className="flex items-center gap-2">
              <Switch
                id="favorite"
                checked={filters.favorite}
                onCheckedChange={(c) => setFilters({ ...filters, favorite: c })}
              />
              <Label htmlFor="favorite" className="text-xs cursor-pointer">
                <Star className="h-3 w-3 inline mr-1" /> Solo favoritos
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="includeFiltered"
                checked={filters.includeFiltered}
                onCheckedChange={(c) =>
                  setFilters({ ...filters, includeFiltered: c })
                }
              />
              <Label
                htmlFor="includeFiltered"
                className="text-xs cursor-pointer"
              >
                <Filter className="h-3 w-3 inline mr-1" /> Mostrar filtrados
                (Tier F)
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left p-3 font-medium w-10"></th>
                  <th className="text-left p-3 font-medium">Negocio</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">
                    Categoría
                  </th>
                  <th className="text-left p-3 font-medium hidden lg:table-cell">
                    Ciudad
                  </th>
                  <th className="text-left p-3 font-medium">Tier</th>
                  <th className="text-left p-3 font-medium">Estado</th>
                  <th className="text-left p-3 font-medium hidden lg:table-cell">
                    Pain
                  </th>
                  <th className="text-left p-3 font-medium hidden xl:table-cell">Tech Stack</th>
                  <th className="text-left p-3 font-medium hidden xl:table-cell">Freshness</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Score</th>
                  <th className="text-left p-3 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={8} className="p-4">
                        <Skeleton className="h-6 w-full" />
                      </td>
                    </tr>
                  ))
                ) : prospects.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      No se encontraron prospectos con estos filtros.
                    </td>
                  </tr>
                ) : (
                  prospects.map((p: any) => {
                    const tier = TIER_META[p.tier] || TIER_META.PENDING;
                    return (
                      <tr
                        key={p.id}
                        className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setSelectedProspectId(p.id)}
                      >
                        <td className="p-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateMutation.mutate({
                                id: p.id,
                                fields: { isFavorite: !p.isFavorite },
                              });
                            }}
                            className="hover:scale-110 transition-transform"
                          >
                            <Star
                              className={`h-4 w-4 ${
                                p.isFavorite
                                  ? "fill-yellow-400 text-yellow-500"
                                  : "text-muted-foreground"
                              }`}
                            />
                          </button>
                        </td>
                        <td className="p-3">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                            {p.phone && (
                              <span className="flex items-center gap-0.5">
                                <Phone className="h-3 w-3" /> {p.phone}
                              </span>
                            )}
                            {p.website && (
                              <span className="flex items-center gap-0.5">
                                <Globe className="h-3 w-3" /> web
                              </span>
                            )}
                            {p.email && (
                              <span className="flex items-center gap-0.5">
                                <Mail className="h-3 w-3" /> email
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 hidden md:table-cell text-muted-foreground text-xs">
                          {p.category || "—"}
                        </td>
                        <td className="p-3 hidden lg:table-cell text-muted-foreground text-xs">
                          {p.city || "—"}
                        </td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${tier.bg} ${tier.color}`}
                          >
                            {tier.label}
                          </span>
                        </td>
                        <td className="p-3">
                          <Select
                            value={p.status}
                            onValueChange={(v) => {
                              updateMutation.mutate({
                                id: p.id,
                                fields: { status: v },
                              });
                              toast.success(
                                `Estado actualizado a "${STATUS_META[v]}"`
                              );
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(STATUS_META).map(([k, v]) => (
                                <SelectItem key={k} value={k}>
                                  {v}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-3 hidden lg:table-cell text-xs text-muted-foreground">
                          {p.painDetected ? (
                            <span className="text-amber-600 dark:text-amber-400">
                              {p.painType || "detectado"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3 hidden xl:table-cell">
                          <TechStackBadge data={p.techStack} />
                        </td>
                        <td className="p-3 hidden xl:table-cell">
                          <FreshnessBadge data={p.freshnessData} />
                        </td>
                        <td className="p-3 hidden md:table-cell">
                          {p.leadScore != null ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                              p.leadScore >= 75 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                              : p.leadScore >= 50 ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                            }`}>
                              {p.leadScore}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedProspectId(p.id);
                            }}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t">
              <div className="text-xs text-muted-foreground">
                Página {page} de {totalPages} · {data?.total} prospectos
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail drawer */}
      <ProspectDetailDrawer
        prospectId={selectedProspectId}
        onClose={() => setSelectedProspectId(null)}
      />
    </div>
  );
}

function ProspectDetailDrawer({
  prospectId,
  onClose,
}: {
  prospectId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [noteInput, setNoteInput] = useState("");
  const [proposalStyle, setProposalStyle] = useState("professional");
  const [proposalContent, setProposalContent] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["prospect", prospectId],
    queryFn: async () => {
      if (!prospectId) return null;
      // Get full prospect
      const r = await fetch(
        `/api/prospects?search=&page=1&pageSize=9999`
      );
      const all = await r.json();
      return all.prospects.find((p: any) => p.id === prospectId);
    },
    enabled: !!prospectId,
  });

  const { data: notesData } = useQuery({
    queryKey: ["notes", prospectId],
    queryFn: async () => {
      if (!prospectId) return { notes: [] };
      return (await fetch(`/api/notes?prospectId=${prospectId}`)).json();
    },
    enabled: !!prospectId,
  });

  const { data: proposalsData } = useQuery({
    queryKey: ["proposals", prospectId],
    queryFn: async () => {
      if (!prospectId) return { proposals: [] };
      return (await fetch(`/api/proposals?prospectId=${prospectId}`)).json();
    },
    enabled: !!prospectId,
  });

  const addNote = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospectId, content: noteInput }),
      });
      return r.json();
    },
    onSuccess: () => {
      setNoteInput("");
      qc.invalidateQueries({ queryKey: ["notes", prospectId] });
      toast.success("Nota añadida");
    },
  });

  const markOutcome = useMutation({
    mutationFn: async (args: {
      prospectId: string;
      outcome: "CLIENT" | "NOT_INTERESTED" | "UNREACHABLE";
      closedValue?: number;
    }) => {
      const r = await fetch("/api/outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      return r.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["prospect", prospectId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
      toast.success(
        vars.outcome === "CLIENT"
          ? "🎉 Marcado como CLIENTE — alimentando closed-loop learning"
          : `Marcado como ${vars.outcome.replace("_", " ")}`
      );
    },
  });

  const generateProp = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospectId, style: proposalStyle }),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.error || "Error");
      }
      return r.json();
    },
    onSuccess: (data) => {
      setProposalContent(data.proposal.content);
      qc.invalidateQueries({ queryKey: ["proposals", prospectId] });
      toast.success("Propuesta generada con IA");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const saveProposalEdit = useMutation({
    mutationFn: async () => {
      const last = proposalsData?.proposals?.[0];
      if (!last) return;
      const r = await fetch("/api/proposals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: last.id, editedContent: proposalContent }),
      });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals", prospectId] });
      setEditing(false);
      toast.success("Propuesta guardada");
    },
  });

  const copyProposal = () => {
    if (proposalContent) {
      navigator.clipboard.writeText(proposalContent);
      toast.success("Propuesta copiada al portapapeles");
    }
  };

  if (!prospectId) return null;
  const p = data;

  return (
    <Sheet open={!!prospectId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{p?.name || "Cargando…"}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          {isLoading || !p ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Tier + status badges */}
              <div className="flex flex-wrap gap-2">
                <Badge
                  className={`${TIER_META[p.tier]?.bg || ""} ${TIER_META[p.tier]?.color || ""} border`}
                >
                  {TIER_META[p.tier]?.label || p.tier}
                </Badge>
                <Badge variant="outline">
                  {STATUS_META[p.status] || p.status}
                </Badge>
                <Badge variant="outline">{p.source}</Badge>
              </div>

              {/* Qualification details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="h-4 w-4" /> Calificación IA (5 capas)
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-2">
                  <Row label="Fit del nicho" value={p.nicheFit || "—"} />
                  <Row
                    label="Pain detectado"
                    value={
                      p.painDetected ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          {p.painType || "Sí"}
                        </span>
                      ) : (
                        "No"
                      )
                    }
                  />
                  {p.painEvidence && (
                    <div className="pt-2">
                      <div className="text-muted-foreground">Evidencia:</div>
                      <div className="mt-1 p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded text-amber-900 dark:text-amber-200">
                        {p.painEvidence}
                      </div>
                    </div>
                  )}
                  {p.intentSignals &&
                    p.intentSignals !== "[]" &&
                    (() => {
                      try {
                        const arr = JSON.parse(p.intentSignals);
                        return (
                          <div className="pt-2">
                            <div className="text-muted-foreground">
                              Señales de intención:
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {arr.map((s: string, i: number) => (
                                <Badge key={i} variant="secondary" className="text-[10px]">
                                  {s}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        );
                      } catch {
                        return null;
                      }
                    })()}
                  {p.disqualifyReason && (
                    <div className="pt-2 text-red-600 dark:text-red-400">
                      <XCircle className="h-3 w-3 inline mr-1" />
                      Descalificado: {p.disqualifyReason}
                    </div>
                  )}
                  {p.qualificationDetails && (
                    <div className="pt-2 italic text-muted-foreground">
                      {p.qualificationDetails}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Contact info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Información de contacto</CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-1.5">
                  <Row label="Categoría" value={p.category || "—"} />
                  <Row label="Ciudad" value={p.city || "—"} />
                  <Row label="Dirección" value={p.address || "—"} />
                  <Row
                    label="Web"
                    value={
                      p.website ? (
                        <a
                          href={p.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline break-all"
                        >
                          {p.website}
                        </a>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <Row label="Teléfono" value={p.phone || "—"} />
                  <Row
                    label="Email"
                    value={
                      p.email ? (
                        <a href={`mailto:${p.email}`} className="text-blue-600 hover:underline">
                          {p.email}
                        </a>
                      ) : (
                        "—"
                      )
                    }
                  />
                  {p.socialLinks &&
                    (() => {
                      try {
                        const s = JSON.parse(p.socialLinks);
                        const entries = Object.entries(s).filter(([, v]) => v);
                        if (!entries.length) return null;
                        return (
                          <div className="pt-2">
                            <div className="text-muted-foreground">
                              Redes sociales:
                            </div>
                            <div className="space-y-1 mt-1">
                              {entries.map(([k, v]) => (
                                <a
                                  key={k}
                                  href={v as string}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block text-blue-600 hover:underline break-all"
                                >
                                  {k}: {v as string}
                                </a>
                              ))}
                            </div>
                          </div>
                        );
                      } catch {
                        return null;
                      }
                    })()}
                </CardContent>
              </Card>

              {/* Description */}
              {p.description && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Descripción</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {p.description}
                  </CardContent>
                </Card>
              )}

              {/* Tech stack + freshness (layers 6-7) */}
              {(p.techStack || p.freshnessData) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Sparkles className="h-4 w-4" /> Tech Stack & Freshness (capas 6-7)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs space-y-3">
                    {p.techStack && (() => {
                      try {
                        const t = JSON.parse(p.techStack);
                        return (
                          <div className="space-y-1.5">
                            <div className="font-medium text-muted-foreground">Tech stack detectado</div>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline" className="text-[10px]">CMS: {t.cms || "—"}</Badge>
                              {t.framework && <Badge variant="outline" className="text-[10px]">Framework: {t.framework}</Badge>}
                              {t.builder && <Badge variant="outline" className="text-[10px]">Builder: {t.builder}</Badge>}
                              {t.ecommerce && <Badge variant="outline" className="text-[10px]">E-com: {t.ecommerce}</Badge>}
                              {t.themeName && <Badge variant="outline" className="text-[10px]">Tema: {t.themeName}</Badge>}
                              {t.isDiySite && <Badge className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">DIY site</Badge>}
                              {t.isProSite && <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">PRO site</Badge>}
                            </div>
                          </div>
                        );
                      } catch { return null; }
                    })()}
                    {p.freshnessData && (() => {
                      try {
                        const f = JSON.parse(p.freshnessData);
                        return (
                          <div className="space-y-1.5 pt-2 border-t">
                            <div className="font-medium text-muted-foreground">Freshness check</div>
                            <Row label="Mobile responsive" value={f.isMobileResponsive ? "Sí" : "No"} />
                            <Row label="Structured data" value={f.hasStructuredData ? "Sí" : "No"} />
                            <Row label="Sistema de reservas" value={f.hasBookingSystem ? `Sí (${f.bookingSystemName})` : "No"} />
                            {f.copyrightYear && <Row label="Copyright year" value={String(f.copyrightYear)} />}
                            {f.daysSinceLastUpdate != null && (
                              <Row label="Días sin actualizar" value={String(f.daysSinceLastUpdate)} />
                            )}
                            <div className="pt-1">
                              <div className="text-muted-foreground">Freshness score:</div>
                              <div className="mt-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    f.freshnessScore < 30 ? "bg-red-500"
                                    : f.freshnessScore < 60 ? "bg-amber-500"
                                    : "bg-emerald-500"
                                  }`}
                                  style={{ width: `${f.freshnessScore}%` }}
                                />
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-1">{f.freshnessScore}/100</div>
                            </div>
                            {f.comprobableEvidence && (
                              <div className="pt-2">
                                <div className="text-muted-foreground">Evidencia comprobable (para propuesta):</div>
                                <div className="mt-1 p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded text-amber-900 dark:text-amber-200 text-[11px]">
                                  {f.comprobableEvidence}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      } catch { return null; }
                    })()}
                    {p.lookAlikeScore != null && (
                      <div className="pt-2 border-t">
                        <div className="text-muted-foreground">Look-alike score (basado en tus clientes previos):</div>
                        <div className="text-lg font-bold mt-1">{p.lookAlikeScore.toFixed(0)}/100</div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* LLM Intelligence (P1.2) — GLM 5.3 Flash reasoning */}
              {p.intelligenceSummary && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Sparkles className="h-4 w-4" /> Inteligencia LLM (GLM 5.3 Flash)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs space-y-2">
                    <div className="p-2 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900 rounded text-purple-900 dark:text-purple-200 italic">
                      {p.intelligenceSummary}
                    </div>
                    {p.intelligenceOpportunity && (
                      <div className="flex gap-2">
                        <span className="text-muted-foreground">Oportunidad:</span>
                        <Badge variant="outline" className="text-[10px]">{p.intelligenceOpportunity}</Badge>
                      </div>
                    )}
                    {p.intelligenceAngle && (
                      <div className="flex gap-2 items-start">
                        <span className="text-muted-foreground shrink-0">Ángulo outreach:</span>
                        <span>{p.intelligenceAngle}</span>
                      </div>
                    )}
                    {p.intelligenceConfidence && (
                      <div className="flex gap-2">
                        <span className="text-muted-foreground">Confianza LLM:</span>
                        <span className="font-medium">{p.intelligenceConfidence}</span>
                      </div>
                    )}
                    {p.leadScore != null && (
                      <div className="flex gap-2 items-center pt-2 border-t">
                        <span className="text-muted-foreground">Lead Score:</span>
                        <span className="text-lg font-bold" style={{
                          color: p.leadScore >= 75 ? "#10b981" : p.leadScore >= 50 ? "#0891b2" : "#f59e0b"
                        }}>{p.leadScore}</span>
                        <span className="text-[10px] text-muted-foreground">/100</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Mark outcome (closed-loop learning) */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> Marcar resultado (closed-loop)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    Registrar el outcome realimenta el sistema de aprendizaje. Cada vez que marcas un cliente,
                    el sistema descubre patrones y mejora la calificación de futuros prospectos.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={markOutcome.isPending}
                      onClick={() => {
                        const v = prompt("Valor cerrado en USD (opcional, solo para tracking):");
                        markOutcome.mutate({
                          prospectId: p.id,
                          outcome: "CLIENT",
                          closedValue: v ? Number(v) : undefined,
                        });
                      }}
                    >
                      Cliente 🎉
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={markOutcome.isPending}
                      onClick={() => markOutcome.mutate({ prospectId: p.id, outcome: "NOT_INTERESTED" })}
                    >
                      No interesado
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={markOutcome.isPending}
                      onClick={() => markOutcome.mutate({ prospectId: p.id, outcome: "UNREACHABLE" })}
                    >
                      No contactable
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Proposal generator */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4" /> Generar propuesta con IA
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { v: "professional", l: "Profesional" },
                      { v: "friendly", l: "Amigable" },
                      { v: "direct", l: "Directo" },
                      { v: "persuasive", l: "Persuasivo" },
                    ].map((s) => (
                      <button
                        key={s.v}
                        onClick={() => setProposalStyle(s.v)}
                        className={`text-[11px] py-1.5 rounded border-2 ${
                          proposalStyle === s.v
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        {s.l}
                      </button>
                    ))}
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => generateProp.mutate()}
                    disabled={generateProp.isPending}
                  >
                    {generateProp.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generando…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" /> Generar propuesta
                      </>
                    )}
                  </Button>

                  {proposalContent && (
                    <div className="space-y-2">
                      <Textarea
                        value={proposalContent}
                        onChange={(e) => {
                          setProposalContent(e.target.value);
                          if (!editing) setEditing(true);
                        }}
                        rows={10}
                        className="text-xs"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={copyProposal}
                        >
                          Copiar
                        </Button>
                        {editing && (
                          <Button
                            size="sm"
                            onClick={() => saveProposalEdit.mutate()}
                            disabled={saveProposalEdit.isPending}
                          >
                            Guardar cambios
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* History */}
                  {proposalsData?.proposals?.length > 0 && (
                    <div className="pt-3 border-t">
                      <div className="text-xs font-medium text-muted-foreground mb-2">
                        Historial de propuestas ({proposalsData.proposals.length})
                      </div>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {proposalsData.proposals.map((pr: any) => (
                          <button
                            key={pr.id}
                            onClick={() =>
                              setProposalContent(pr.editedContent || pr.content)
                            }
                            className="block w-full text-left p-2 border rounded hover:bg-muted/50 text-[11px]"
                          >
                            <div className="flex justify-between">
                              <span className="font-medium capitalize">
                                {pr.style}
                              </span>
                              <span className="text-muted-foreground">
                                {new Date(pr.createdAt).toLocaleString("es-CO", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })}
                              </span>
                            </div>
                            <div className="text-muted-foreground mt-1 line-clamp-1">
                              {pr.editedContent || pr.content}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Notes */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Notas</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Añadir nota…"
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && noteInput.trim()) {
                          addNote.mutate();
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={() => addNote.mutate()}
                      disabled={!noteInput.trim() || addNote.isPending}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    {(notesData?.notes || []).map((n: any) => (
                      <div
                        key={n.id}
                        className="text-xs p-2 bg-muted/30 rounded border"
                      >
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            {new Date(n.createdAt).toLocaleString("es-CO", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </span>
                        </div>
                        <div className="mt-1">{n.content}</div>
                      </div>
                    ))}
                    {notesData?.notes?.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        Sin notas.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 items-start">
      <span className="text-muted-foreground">{label}:</span>
      <span className="col-span-2 break-words">{value}</span>
    </div>
  );
}

function TechStackBadge({ data }: { data?: string | null }) {
  if (!data) return <span className="text-[11px] text-muted-foreground">—</span>;
  try {
    const parsed = JSON.parse(data);
    if (!parsed?.cms) {
      return <span className="text-[11px] text-muted-foreground">no detectado</span>;
    }
    const labels: Record<string, { label: string; color: string }> = {
      wordpress: { label: "WordPress", color: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
      shopify: { label: "Shopify", color: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" },
      wix: { label: "Wix", color: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300" },
      squarespace: { label: "Squarespace", color: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
      webflow: { label: "Webflow", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" },
      custom_next: { label: "Next.js", color: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
      custom_nuxt: { label: "Nuxt", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
      drupal: { label: "Drupal", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300" },
      joomla: { label: "Joomla", color: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" },
      ghost: { label: "Ghost", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
    };
    const meta = labels[parsed.cms] || { label: parsed.cms, color: "bg-muted text-muted-foreground" };
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${meta.color}`}>
        {meta.label}
        {parsed.isDiySite && " ·DIY"}
        {parsed.isProSite && " ·PRO"}
      </span>
    );
  } catch {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
}

function FreshnessBadge({ data }: { data?: string | null }) {
  if (!data) return <span className="text-[11px] text-muted-foreground">—</span>;
  try {
    const parsed = JSON.parse(data);
    const score = parsed?.freshnessScore;
    if (typeof score !== "number") {
      return <span className="text-[11px] text-muted-foreground">—</span>;
    }
    let color = "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
    if (score < 30) color = "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
    else if (score < 60) color = "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>
        {score}/100
        {parsed.daysSinceLastUpdate != null && parsed.daysSinceLastUpdate > 365 && ` ·${Math.round(parsed.daysSinceLastUpdate / 365)}y`}
      </span>
    );
  } catch {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
}
