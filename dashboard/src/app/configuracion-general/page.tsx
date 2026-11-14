"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Cpu, MessageCircle, QrCode, RefreshCw, CheckCircle2, AlertCircle, Save } from "lucide-react";
import { toast } from "sonner";

export default function ConfiguracionGeneralPage() {
  // Provider Settings State
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

  // WhatsApp Daemon State
  const [waStatus, setWaStatus] = useState<any>({ status: "checking" });
  const [waQr, setWaQr] = useState<string | null>(null);
  const [loadingWa, setLoadingWa] = useState(false);

  // Load Provider Settings
  useEffect(() => {
    fetch("/api/provider-settings")
      .then((res) => res.json())
      .then((data) => {
        if (data && !data.error) {
          setProviderForm((prev) => ({
            ...prev,
            ...data,
          }));
        }
      })
      .catch(() => {});

    checkWhatsApp();
  }, []);

  const handleSaveProvider = async () => {
    setSavingProvider(true);
    try {
      const res = await fetch("/api/provider-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerForm),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success("Configuración de IA guardada");
      } else {
        toast.error("Error al guardar: " + data.error);
      }
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
      if (data.ok) {
        toast.success(`Conexión exitosa (${data.latency_ms} ms)`);
      } else {
        toast.error(data.message || "Error al conectar con el proveedor");
      }
    } catch {
      toast.error("Fallo la llamada de prueba");
    } finally {
      setTestingProvider(false);
    }
  };

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

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configuración Unificada</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Administra los cerebros de IA (NVIDIA NIM, Groq, OpenAI) y la integración de WhatsApp
          </p>
        </div>

        <Tabs defaultValue="provider" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="provider" className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              <span>Proveedor de IA</span>
            </TabsTrigger>
            <TabsTrigger value="whatsapp" className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              <span>WhatsApp Daemon (Baileys)</span>
            </TabsTrigger>
          </TabsList>

          {/* TAB PROVEEDOR IA */}
          <TabsContent value="provider">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Configuración de IA</CardTitle>
                    <CardDescription>
                      Selecciona y configura el modelo que alimenta tanto al Bot como al Dashboard
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                    NVIDIA NIM / Compatible
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
                    <Label>Modelo</Label>
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
                  <Label>Base URL (Endpoint)</Label>
                  <Input
                    value={providerForm.base_url}
                    onChange={(e) =>
                      setProviderForm({ ...providerForm, base_url: e.target.value })
                    }
                    placeholder="https://integrate.api.nvidia.com/v1"
                  />
                </div>

                <div className="space-y-2">
                  <Label>API Key</Label>
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
                  <Button
                    onClick={handleTestProvider}
                    variant="outline"
                    disabled={testingProvider}
                  >
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

          {/* TAB WHATSAPP */}
          <TabsContent value="whatsapp">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Conexión WhatsApp (Daemon Baileys)</CardTitle>
                    <CardDescription>
                      Conexión directa mediante sesión de código QR en puerto 3002
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
                        El número vinculado es: {waStatus.phone || "Activo"}
                      </p>
                    </div>
                  ) : (
                    <div className="text-center space-y-2 py-6">
                      <QrCode className="h-12 w-12 text-muted-foreground mx-auto" />
                      <p className="text-sm text-muted-foreground">
                        Presiona &quot;Vincular WhatsApp&quot; para generar un nuevo código QR.
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <Button variant="outline" onClick={checkWhatsApp} disabled={loadingWa}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loadingWa ? "animate-spin" : ""}`} />
                    Actualizar Estado
                  </Button>

                  <div className="flex gap-2">
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
        </Tabs>
      </div>
    </AppShell>
  );
}
