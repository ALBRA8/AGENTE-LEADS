"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Save,
  Loader2,
  Cpu,
  MessageCircle,
  QrCode,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  KeyRound,
  Send,
  Webhook,
  MapPin,
  Bot,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export function SettingsClient() {
  const qc = useQueryClient();

  // 1. Proveedor IA
  const [providerForm, setProviderForm] = useState({
    provider: "nvidia",
    base_url: "https://integrate.api.nvidia.com/v1",
    model: "z-ai/glm-5.3-flash",
    api_key: "",
    temperature: 0.6,
    top_p: 0.7,
  });
  const [testingProvider, setTestingProvider] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);

  // 2. WhatsApp Daemon
  const [waStatus, setWaStatus] = useState<any>({ status: "checking" });
  const [waQr, setWaQr] = useState<string | null>(null);
  const [loadingWa, setLoadingWa] = useState(false);

  // 3. Ofertas de Negocio
  const { data: offersData } = useQuery({
    queryKey: ["offers"],
    queryFn: async () => (await fetch("/api/offers")).json(),
  });
  const offers = offersData?.offers || [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [offerForm, setOfferForm] = useState<any>({
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

  // 4. APIs e Integraciones de Comunicación / Scraping
  const { data: integData } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => (await fetch("/api/integrations")).json(),
  });
  const [integForm, setIntegForm] = useState({
    telegramBotToken: "",
    telegramAllowedIds: "",
    sendgridApiKey: "",
    sendgridFromEmail: "",
    apifyToken: "",
    googlePlacesApiKey: "",
    whatsappToken: "",
    whatsappPhoneId: "",
  });

  useEffect(() => {
    // Cargar config IA
    fetch("/api/provider-settings")
      .then((res) => res.json())
      .then((data) => {
        if (data && !data.error) setProviderForm((prev) => ({ ...prev, ...data }));
      })
      .catch(() => {});

    // Comprobar WhatsApp
    checkWhatsApp();
  }, []);

  useEffect(() => {
    if (offers.length > 0 && !editingId) {
      const o = offers[0];
      setOfferForm({
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

  useEffect(() => {
    if (integData?.integration) {
      setIntegForm({
        telegramBotToken: integData.integration.telegramBotToken || "",
        telegramAllowedIds: integData.integration.telegramAllowedIds || "",
        sendgridApiKey: integData.integration.sendgridApiKey || "",
        sendgridFromEmail: integData.integration.sendgridFromEmail || "",
        apifyToken: integData.integration.apifyToken || "",
        googlePlacesApiKey: integData.integration.googlePlacesApiKey || "",
        whatsappToken: integData.integration.whatsappToken || "",
        whatsappPhoneId: integData.integration.whatsappPhoneId || "",
      });
    }
  }, [integData]);

  // Handlers Proveedor IA
  const handleSaveProvider = async () => {
    setSavingProvider(true);
    try {
      const res = await fetch("/api/provider-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerForm),
      });
      const data = await res.json();
      if (data.ok) toast.success("Configuración de IA guardada");
      else toast.error("Error al guardar: " + data.error);
    } catch {
      toast.error("Error de conexión al guardar");
    } finally {
      setSavingProvider(false);
    }
  };

  const handleTestProvider = async () => {
    setTestingProvider(true);
    try {
      const res = await fetch("/api/provider-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerForm),
      });
      const data = await res.json();
      if (data.ok) toast.success(`Conexión exitosa (${data.latency_ms} ms)`);
      else toast.error(data.message || "Error al conectar con el proveedor");
    } catch {
      toast.error("Fallo la llamada de prueba");
    } finally {
      setTestingProvider(false);
    }
  };

  // Handlers WhatsApp
  const checkWhatsApp = async () => {
    setLoadingWa(true);
    try {
      const res = await fetch("/api/whatsapp/daemon-proxy?path=/status");
      const data = await res.json();
      setWaStatus(data);
      if (data.status === "linking" || data.qr) {
        const qrRes = await fetch("/api/whatsapp/daemon-proxy?path=/qr");
        const qrData = await qrRes.json();
        setWaQr(qrData.qr || null);
      } else {
        setWaQr(null);
      }
    } catch {
      setWaStatus({ status: "daemon_offline" });
      setWaQr(null);
    } finally {
      setLoadingWa(false);
    }
  };

  const handleWaConnect = async () => {
    try {
      await fetch("/api/whatsapp/daemon-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/connect" }),
      });
      toast.info("Iniciando conexión WhatsApp...");
      setTimeout(checkWhatsApp, 2000);
    } catch {
      toast.error("No se pudo iniciar conexión");
    }
  };

  const handleWaDisconnect = async () => {
    try {
      await fetch("/api/whatsapp/daemon-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/disconnect" }),
      });
      toast.success("Sesión cerrada");
      checkWhatsApp();
    } catch {
      toast.error("Error al desconectar");
    }
  };

  // Handlers Ofertas
  const saveOffer = useMutation({
    mutationFn: async () => {
      if (editingId) {
        const r = await fetch("/api/offers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, ...offerForm }),
        });
        return r.json();
      } else {
        const r = await fetch("/api/offers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(offerForm),
        });
        return r.json();
      }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["offers"] });
      toast.success("Oferta guardada exitosamente");
      if (data?.offer?.id) setEditingId(data.offer.id);
    },
  });

  // Handlers Integraciones
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
      toast.success("APIs e integraciones guardadas");
    },
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ajustes del Sistema</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configura el cerebro de IA, WhatsApp, APIs de prospección y ofertas comerciales
        </p>
      </div>

      <Tabs defaultValue="ai" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="ai" className="flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            <span>Proveedor IA</span>
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            <span>WhatsApp</span>
          </TabsTrigger>
          <TabsTrigger value="apis" className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            <span>APIs & Scrapers</span>
          </TabsTrigger>
          <TabsTrigger value="offers" className="flex items-center gap-2">
            <Briefcase className="h-4 w-4" />
            <span>Oferta Comercial</span>
          </TabsTrigger>
        </TabsList>

        {/* 1. TAB PROVEEDOR IA */}
        <TabsContent value="ai">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Cerebro del Agente (LLM)</CardTitle>
                  <CardDescription>
                    Configuración de NVIDIA NIM / Groq / OpenAI para razonamiento y respuestas
                  </CardDescription>
                </div>
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                  NVIDIA NIM Activo
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Proveedor</Label>
                  <select
                    value={providerForm.provider}
                    onChange={(e) =>
                      setProviderForm({ ...providerForm, provider: e.target.value })
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="nvidia">NVIDIA NIM (Kimi K2.5 / GLM / Llama 3)</option>
                    <option value="groq">Groq (Llama 3 / Mistral)</option>
                    <option value="openai">OpenAI Oficial</option>
                    <option value="mock">Modo Mock (Pruebas)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Modelo Activo</Label>
                  <Input
                    value={providerForm.model}
                    onChange={(e) =>
                      setProviderForm({ ...providerForm, model: e.target.value })
                    }
                    placeholder="z-ai/glm-5.3-flash"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Base URL (Endpoint API)</Label>
                <Input
                  value={providerForm.base_url}
                  onChange={(e) =>
                    setProviderForm({ ...providerForm, base_url: e.target.value })
                  }
                  placeholder="https://integrate.api.nvidia.com/v1"
                />
              </div>

              <div className="space-y-2">
                <Label>API Key de NVIDIA / Proveedor</Label>
                <Input
                  type="password"
                  value={providerForm.api_key}
                  onChange={(e) =>
                    setProviderForm({ ...providerForm, api_key: e.target.value })
                  }
                  placeholder="nvapi-..."
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button onClick={handleTestProvider} variant="outline" disabled={testingProvider}>
                  {testingProvider ? "Probando..." : "Probar Conexión"}
                </Button>
                <Button onClick={handleSaveProvider} disabled={savingProvider}>
                  <Save className="h-4 w-4 mr-2" />
                  {savingProvider ? "Guardando..." : "Guardar Ajustes de IA"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 2. TAB WHATSAPP */}
        <TabsContent value="whatsapp">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>WhatsApp Daemon (Baileys)</CardTitle>
                  <CardDescription>
                    Vincula tu número de WhatsApp escaneando el código QR
                  </CardDescription>
                </div>
                {waStatus.status === "connected" ? (
                  <Badge className="bg-emerald-500 text-white flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Conectado ({waStatus.phone})
                  </Badge>
                ) : waStatus.status === "linking" ? (
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                    Esperando Escaneo QR
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Desconectado
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col items-center justify-center p-6 border rounded-xl bg-muted/20">
                {waQr ? (
                  <div className="text-center space-y-4">
                    <div className="bg-white p-4 rounded-xl inline-block shadow-md">
                      <img src={waQr} alt="QR WhatsApp" className="w-56 h-56 mx-auto" />
                    </div>
                    <p className="text-sm font-medium">
                      Abre WhatsApp en tu teléfono &gt; Dispositivos vinculados &gt; Vincular dispositivo
                    </p>
                  </div>
                ) : waStatus.status === "connected" ? (
                  <div className="text-center space-y-2 py-4">
                    <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
                    <h3 className="font-semibold text-lg">WhatsApp Vinculado con éxito</h3>
                    <p className="text-sm text-muted-foreground">
                      Número activo: {waStatus.phone || "Conectado"}
                    </p>
                  </div>
                ) : (
                  <div className="text-center space-y-2 py-6">
                    <QrCode className="h-12 w-12 text-muted-foreground mx-auto" />
                    <p className="text-sm text-muted-foreground">
                      Presiona &quot;Vincular WhatsApp&quot; para generar el código QR.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button variant="outline" onClick={checkWhatsApp} disabled={loadingWa}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${loadingWa ? "animate-spin" : ""}`} />
                  Actualizar Estado
                </Button>
                <div>
                  {waStatus.status === "connected" ? (
                    <Button variant="destructive" onClick={handleWaDisconnect}>
                      Desconectar Sesión
                    </Button>
                  ) : (
                    <Button onClick={handleWaConnect}>
                      Vincular WhatsApp (Generar QR)
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 3. TAB APIS & SCRAPERS */}
        <TabsContent value="apis">
          <Card>
            <CardHeader>
              <CardTitle>APIs y Canales de Comunicación</CardTitle>
              <CardDescription>
                Configura Telegram, SendGrid y motores de búsqueda para prospección
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Telegram */}
              <div className="space-y-3 p-4 border rounded-lg">
                <div className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold text-sm">Telegram Bot</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="telegramBotToken">Bot Token (@BotFather)</Label>
                    <Input
                      id="telegramBotToken"
                      type="password"
                      value={integForm.telegramBotToken}
                      onChange={(e) =>
                        setIntegForm({ ...integForm, telegramBotToken: e.target.value })
                      }
                      placeholder="8539019258:AA..."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="telegramAllowedIds">IDs Permitidos (Whitelist)</Label>
                    <Input
                      id="telegramAllowedIds"
                      value={integForm.telegramAllowedIds}
                      onChange={(e) =>
                        setIntegForm({ ...integForm, telegramAllowedIds: e.target.value })
                      }
                      placeholder="1204900940, ..."
                    />
                  </div>
                </div>
              </div>

              {/* Apify & Google Places */}
              <div className="space-y-3 p-4 border rounded-lg">
                <div className="flex items-center gap-2">
                  <Webhook className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold text-sm">Scrapers de Extracción (Apify & Google)</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="apifyToken">Apify API Token (Instagram / Google)</Label>
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
                  <div className="space-y-1">
                    <Label htmlFor="googlePlacesApiKey">Google Places API Key</Label>
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
                </div>
              </div>

              {/* SendGrid */}
              <div className="space-y-3 p-4 border rounded-lg">
                <div className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold text-sm">Envío de Emails (SendGrid)</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="sendgridApiKey">SendGrid API Key</Label>
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
                  <div className="space-y-1">
                    <Label htmlFor="sendgridFromEmail">Email Remitente Verificado</Label>
                    <Input
                      id="sendgridFromEmail"
                      value={integForm.sendgridFromEmail}
                      onChange={(e) =>
                        setIntegForm({ ...integForm, sendgridFromEmail: e.target.value })
                      }
                      placeholder="contacto@tuempresa.com"
                    />
                  </div>
                </div>
              </div>

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
                Guardar Configuración de APIs
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 4. TAB OFERTA COMERCIAL */}
        <TabsContent value="offers">
          <Card>
            <CardHeader>
              <CardTitle>Definición de Oferta Comercial</CardTitle>
              <CardDescription>
                Define tu producto, precios y nichos para que el agente filtre y califique los leads
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nombre de la Oferta</Label>
                  <Input
                    value={offerForm.name}
                    onChange={(e) => setOfferForm({ ...offerForm, name: e.target.value })}
                    placeholder="Servicio de Automatización IA"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Rango de Precios</Label>
                  <Input
                    value={offerForm.priceRange}
                    onChange={(e) => setOfferForm({ ...offerForm, priceRange: e.target.value })}
                    placeholder="$1,000 - $3,000 USD"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Descripción del Servicio</Label>
                <Textarea
                  value={offerForm.description}
                  onChange={(e) => setOfferForm({ ...offerForm, description: e.target.value })}
                  placeholder="Detalla qué incluye tu oferta comercial..."
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nichos Objetivo</Label>
                  <Input
                    value={offerForm.targetNiches}
                    onChange={(e) => setOfferForm({ ...offerForm, targetNiches: e.target.value })}
                    placeholder="Inmobiliarias, Clínicas, Dentistas, Abogados"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Ciudades / Regiones</Label>
                  <Input
                    value={offerForm.cities}
                    onChange={(e) => setOfferForm({ ...offerForm, cities: e.target.value })}
                    placeholder="Madrid, Barcelona, Bogotá, Miami"
                  />
                </div>
              </div>

              <Button
                onClick={() => saveOffer.mutate()}
                disabled={saveOffer.isPending}
                className="w-full"
              >
                {saveOffer.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Guardar Oferta Comercial
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
