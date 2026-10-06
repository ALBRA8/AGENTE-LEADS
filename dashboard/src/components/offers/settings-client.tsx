"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2, Loader2, KeyRound, Webhook, MessageCircle, MapPin, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

export function SettingsClient() {
  const qc = useQueryClient();
  const { data: offersData, isLoading } = useQuery({
    queryKey: ["offers"],
    queryFn: async () => (await fetch("/api/offers")).json(),
  });
  const offers = offersData?.offers || [];

  const { data: integData } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => (await fetch("/api/integrations")).json(),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({
    name: "",
    description: "",
    priceRange: "",
    idealCustomer: "",
    targetNiches: "",
    cities: "",
    countries: "",
    budget: "",
    sector: "",
  });

  useEffect(() => {
    if (offers.length > 0 && !editingId) {
      const o = offers[0];
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        name: o.name || "",
        description: o.description || "",
        priceRange: o.priceRange || "",
        idealCustomer: o.idealCustomer || "",
        targetNiches: o.targetNiches || "",
        cities: o.cities || "",
        countries: o.countries || "",
        budget: o.budget || "",
        sector: o.sector || "",
      });
      setEditingId(o.id);
    }
  }, [offers, editingId]);

  const saveOffer = useMutation({
    mutationFn: async () => {
      if (editingId) {
        const r = await fetch("/api/offers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, ...form }),
        });
        return r.json();
      } else {
        const r = await fetch("/api/offers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        return r.json();
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offers"] });
      toast.success("Oferta guardada");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteOffer = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/offers?id=${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offers"] });
      toast.success("Oferta eliminada");
      setEditingId(null);
      setForm({
        name: "",
        description: "",
        priceRange: "",
        idealCustomer: "",
        targetNiches: "",
        cities: "",
        countries: "",
        budget: "",
        sector: "",
      });
    },
  });

  const newOffer = () => {
    setEditingId(null);
    setForm({
      name: "",
      description: "",
      priceRange: "",
      idealCustomer: "",
      targetNiches: "",
      cities: "",
      countries: "",
      budget: "",
      sector: "",
    });
  };

  // Integrations
  const [integForm, setIntegForm] = useState<any>({
    telegramBotToken: "",
    telegramAllowedIds: "",
    sendgridApiKey: "",
    sendgridFromEmail: "",
    whatsappToken: "",
    whatsappPhoneId: "",
    googlePlacesApiKey: "",
    apifyToken: "",
  });

  useEffect(() => {
    if (integData?.integration) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIntegForm({
        telegramBotToken: integData.integration.telegramBotToken || "",
        telegramAllowedIds: integData.integration.telegramAllowedIds || "",
        sendgridApiKey: integData.integration.sendgridApiKey || "",
        sendgridFromEmail: integData.integration.sendgridFromEmail || "",
        whatsappToken: integData.integration.whatsappToken || "",
        whatsappPhoneId: integData.integration.whatsappPhoneId || "",
        googlePlacesApiKey: integData.integration.googlePlacesApiKey || "",
        apifyToken: integData.integration.apifyToken || "",
      });
    }
  }, [integData]);

  const saveIntegration = useMutation({
    mutationFn: async () => {
      await fetch("/api/integrations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(integForm),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Integraciones guardadas");
    },
  });

  const configured = integData?.configured || {};

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ajustes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configura tu oferta comercial y las integraciones externas
        </p>
      </div>

      {/* Offer selector */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Mi oferta comercial</CardTitle>
              <CardDescription>
                Define qué vendes y a quién. Esto alimenta la calificación de
                prospectos y la generación de propuestas.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={newOffer}>
              <Plus className="h-4 w-4 mr-1" /> Nueva oferta
            </Button>
          </div>
          {offers.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {offers.map((o: any) => (
                <button
                  key={o.id}
                  onClick={() => setEditingId(o.id)}
                  className={`text-xs px-3 py-1.5 rounded border-2 ${
                    editingId === o.id
                      ? "border-primary bg-primary/5"
                      : "border-border"
                  }`}
                >
                  {o.name}
                </button>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Nombre de la oferta *</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Marketing digital para clínicas de estética"
                />
              </div>
              <div>
                <Label htmlFor="description">Descripción *</Label>
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  rows={4}
                  placeholder="Describe en detalle qué servicio ofreces, qué incluye, etc."
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="priceRange">Rango de precio</Label>
                  <Input
                    id="priceRange"
                    value={form.priceRange}
                    onChange={(e) =>
                      setForm({ ...form, priceRange: e.target.value })
                    }
                    placeholder="$1,500 - $5,000 USD / mes"
                  />
                </div>
                <div>
                  <Label htmlFor="sector">Sector</Label>
                  <Input
                    id="sector"
                    value={form.sector}
                    onChange={(e) =>
                      setForm({ ...form, sector: e.target.value })
                    }
                    placeholder="Salud y belleza"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="idealCustomer">Cliente ideal</Label>
                  <Textarea
                    id="idealCustomer"
                    value={form.idealCustomer}
                    onChange={(e) =>
                      setForm({ ...form, idealCustomer: e.target.value })
                    }
                    rows={2}
                    placeholder="Clínicas de estética con 1-5 sedes, facturación media-alta, que quieren crecer su flujo de pacientes"
                  />
                </div>
                <div>
                  <Label htmlFor="targetNiches">Nichos objetivo</Label>
                  <Input
                    id="targetNiches"
                    value={form.targetNiches}
                    onChange={(e) =>
                      setForm({ ...form, targetNiches: e.target.value })
                    }
                    placeholder="clínica estética, medicina estética, cirugía plástica, dermatología"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Separados por coma
                  </p>
                </div>
                <div>
                  <Label htmlFor="budget">Presupuesto objetivo (opcional)</Label>
                  <Input
                    id="budget"
                    value={form.budget}
                    onChange={(e) =>
                      setForm({ ...form, budget: e.target.value })
                    }
                    placeholder="media-alto"
                  />
                </div>
                <div>
                  <Label htmlFor="cities">Ciudades objetivo</Label>
                  <Input
                    id="cities"
                    value={form.cities}
                    onChange={(e) =>
                      setForm({ ...form, cities: e.target.value })
                    }
                    placeholder="Bogotá, Medellín, Cali"
                  />
                </div>
                <div>
                  <Label htmlFor="countries">Países</Label>
                  <Input
                    id="countries"
                    value={form.countries}
                    onChange={(e) =>
                      setForm({ ...form, countries: e.target.value })
                    }
                    placeholder="Colombia"
                  />
                </div>
              </div>
              <div className="flex justify-between pt-2">
                {editingId ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteOffer.mutate(editingId)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  onClick={() => saveOffer.mutate()}
                  disabled={saveOffer.isPending || !form.name || !form.description}
                >
                  {saveOffer.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Guardar oferta
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Integrations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Integraciones
          </CardTitle>
          <CardDescription>
            Configura las APIs oficiales para fuentes de leads y automatización
            de contacto. Los secrets se guardan cifrados en tu base de datos
            local.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Google Places */}
          <IntegrationCard
            icon={<MapPin className="h-4 w-4" />}
            name="Google Places API"
            description="Fuente oficial de negocios. Activa el adapter de Google Places en Buscar Clientes."
            configured={configured.googlePlaces}
          >
            <div>
              <Label htmlFor="googlePlacesApiKey">API Key</Label>
              <Input
                id="googlePlacesApiKey"
                type="password"
                value={integForm.googlePlacesApiKey}
                onChange={(e) =>
                  setIntegForm({ ...integForm, googlePlacesApiKey: e.target.value })
                }
                placeholder="AIza..."
              />
            </div>
          </IntegrationCard>

          <Separator />

          {/* Telegram */}
          <IntegrationCard
            icon={<MessageCircle className="h-4 w-4" />}
            name="Telegram Bot"
            description="Bot de Telegram para controlar AGENTE LEADS desde chat. Necesitas crear un bot con @BotFather."
            configured={configured.telegram}
          >
            <div>
              <Label htmlFor="telegramBotToken">Bot Token</Label>
              <Input
                id="telegramBotToken"
                type="password"
                value={integForm.telegramBotToken}
                onChange={(e) =>
                  setIntegForm({ ...integForm, telegramBotToken: e.target.value })
                }
                placeholder="123456:ABC-..."
              />
            </div>
            <div>
              <Label htmlFor="telegramAllowedIds">IDs permitidos (whitelist)</Label>
              <Input
                id="telegramAllowedIds"
                value={integForm.telegramAllowedIds}
                onChange={(e) =>
                  setIntegForm({
                    ...integForm,
                    telegramAllowedIds: e.target.value,
                  })
                }
                placeholder="123456789, 987654321"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Separados por coma. Encuéntralos hablando con @userinfobot.
              </p>
            </div>
          </IntegrationCard>

          <Separator />

          {/* SendGrid */}
          <IntegrationCard
            icon={<Send className="h-4 w-4" />}
            name="SendGrid (Email)"
            description="Para enviar propuestas por email. Requiere cuenta en SendGrid con API key y remitente verificado."
            configured={configured.sendgrid}
          >
            <div>
              <Label htmlFor="sendgridApiKey">API Key</Label>
              <Input
                id="sendgridApiKey"
                type="password"
                value={integForm.sendgridApiKey}
                onChange={(e) =>
                  setIntegForm({ ...integForm, sendgridApiKey: e.target.value })
                }
                placeholder="SG..."
              />
            </div>
            <div>
              <Label htmlFor="sendgridFromEmail">Email remitente</Label>
              <Input
                id="sendgridFromEmail"
                type="email"
                value={integForm.sendgridFromEmail}
                onChange={(e) =>
                  setIntegForm({
                    ...integForm,
                    sendgridFromEmail: e.target.value,
                  })
                }
                placeholder="ventas@tuempresa.com"
              />
            </div>
          </IntegrationCard>

          <Separator />

          {/* WhatsApp */}
          <IntegrationCard
            icon={<MessageCircle className="h-4 w-4" />}
            name="WhatsApp Cloud API (Meta)"
            description="Para enviar propuestas por WhatsApp Business. Requiere app en Meta for Developers con WhatsApp Cloud API."
            configured={configured.whatsapp}
          >
            <div>
              <Label htmlFor="whatsappToken">Access Token</Label>
              <Input
                id="whatsappToken"
                type="password"
                value={integForm.whatsappToken}
                onChange={(e) =>
                  setIntegForm({ ...integForm, whatsappToken: e.target.value })
                }
                placeholder="EAAG..."
              />
            </div>
            <div>
              <Label htmlFor="whatsappPhoneId">Phone Number ID</Label>
              <Input
                id="whatsappPhoneId"
                value={integForm.whatsappPhoneId}
                onChange={(e) =>
                  setIntegForm({
                    ...integForm,
                    whatsappPhoneId: e.target.value,
                  })
                }
                placeholder="123456789012345"
              />
            </div>
          </IntegrationCard>

          <Separator />

          {/* Apify */}
          <IntegrationCard
            icon={<Webhook className="h-4 w-4" />}
            name="Apify (opcional)"
            description="Para usar Google Search Scraper y otros scrapers de Apify. Opcional — el Web Scraper integrado funciona sin esto."
            configured={configured.apify}
          >
            <div>
              <Label htmlFor="apifyToken">API Token</Label>
              <Input
                id="apifyToken"
                type="password"
                value={integForm.apifyToken}
                onChange={(e) =>
                  setIntegForm({ ...integForm, apifyToken: e.target.value })
                }
                placeholder="apify_api_..."
              />
            </div>
          </IntegrationCard>

          <Button
            onClick={() => saveIntegration.mutate()}
            disabled={saveIntegration.isPending}
            className="w-full"
          >
            {saveIntegration.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Guardar integraciones
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function IntegrationCard({
  icon,
  name,
  description,
  configured,
  children,
}: {
  icon: React.ReactNode;
  name: string;
  description: string;
  configured: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            {icon}
          </div>
          <div>
            <div className="font-medium flex items-center gap-2">
              {name}
              {configured && (
                <Badge variant="secondary" className="text-[10px]">
                  Configurado
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-11">
        {children}
      </div>
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-muted rounded ${className}`} />
  );
}
