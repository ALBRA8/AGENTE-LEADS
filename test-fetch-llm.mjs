import dotenv from "dotenv";
dotenv.config({ override: true });

const apiKey = process.env.NVIDIA_API_KEY;
const baseURL = "https://integrate.api.nvidia.com/v1";

// Use Node's native fetch (undici)
const start = Date.now();
try {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
    },
    body: JSON.stringify({
      model: "z-ai/glm-5.3-flash",
      messages: [
        { role: "system", content: "Return JSON only: {\"summary\":\"hello\",\"opportunity_size\":\"small\",\"outreach_angle\":\"x\",\"confidence\":\"low\",\"signals_used\":[\"email\"]}" },
        { role: "user", content: "Return the JSON." }
      ],
      max_tokens: 256,
      temperature: 0.5,
      top_p: 1,
    }),
  });
  const elapsed = Date.now() - start;
  const text = await res.text();
  console.log(`HTTP ${res.status} in ${elapsed}ms`);
  try {
    const j = JSON.parse(text);
    console.log("content:", j.choices?.[0]?.message?.content);
    console.log("reasoning (first 200):", (j.choices?.[0]?.message?.reasoning_content ?? "").substring(0, 200));
    console.log("finish_reason:", j.choices?.[0]?.finish_reason);
    console.log("usage:", JSON.stringify(j.usage));
  } catch (e) {
    console.log("Raw response (first 500):", text.substring(0, 500));
  }
} catch (e) {
  console.log(`FAILED in ${Date.now() - start}ms: ${e.message}`);
  if (e.cause) console.log("Cause:", e.cause.message ?? e.cause);
}
