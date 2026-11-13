import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import path from "path";

const SETTINGS_FILE = path.join(process.cwd(), "..", ".provider-settings.json");

const DEFAULT_SETTINGS = {
  provider: "nvidia",
  base_url: "https://integrate.api.nvidia.com/v1",
  model: "z-ai/glm-5.3-flash",
  api_key: process.env.NVIDIA_API_KEY || "",
  temperature: 0.6,
  top_p: 0.7,
  max_tokens: 8192,
  timeout: 90,
};

export async function GET() {
  try {
    const data = await readFile(SETTINGS_FILE, "utf-8");
    const json = JSON.parse(data);
    return NextResponse.json({ ...DEFAULT_SETTINGS, ...json });
  } catch {
    const current = {
      provider: "nvidia",
      base_url: "https://integrate.api.nvidia.com/v1",
      model: "z-ai/glm-5.3-flash",
      api_key: process.env.NVIDIA_API_KEY || "",
      temperature: 0.6,
      top_p: 0.7,
      max_tokens: 8192,
      timeout: 90,
    };
    return NextResponse.json(current);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const provider = body.provider || "nvidia";
    const baseUrl = body.base_url || "https://integrate.api.nvidia.com/v1";
    const model = body.model || "z-ai/glm-5.3-flash";
    const apiKey = body.api_key || "";
    const temperature = Number(body.temperature) || 0.6;
    const topP = Number(body.top_p) || 0.7;
    const maxTokens = Number(body.max_tokens) || 8192;
    const timeout = Number(body.timeout) || 90;

    const toSave = {
      provider,
      base_url: baseUrl,
      model,
      api_key: apiKey,
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
      timeout,
    };

    await writeFile(SETTINGS_FILE, JSON.stringify(toSave, null, 2), "utf-8");

    return NextResponse.json({ ok: true, config: toSave });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save settings" }, { status: 500 });
  }
}
