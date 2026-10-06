import { Tool } from "../types.js";

export const verifyEmail: Tool = {
  definition: {
    type: "function",
    function: {
      name: "verify_email",
      description: "Verifica si un correo electrónico es válido y existe.",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string" }
        },
        required: ["email"]
      }
    }
  },
  async execute({ email }) {
    try {
      const response = await fetch(`https://rapid-email-verifier.fly.dev/api/validate?email=${email}`, {
        headers: { "accept": "application/json" }
      });
      
      if (!response.ok) {
        return `Error verifying email: ${response.status} ${response.statusText}`;
      }

      const result = await response.json();
      return JSON.stringify(result);
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }
};
