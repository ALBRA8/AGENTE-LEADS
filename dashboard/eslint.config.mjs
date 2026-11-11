// Configuración plana de ESLint (ESLint 9) — usa el preset core-web-vitals de Next.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextCoreWebVitals,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "next-env.d.ts",
      "prisma/migrations/**",
    ],
  },
  {
    // Componentes stock de shadcn/ui: las reglas nuevas de react-hooks v6
    // (set-state-in-effect / purity) marcan las plantillas upstream tal cual
    // se distribuyen. Se degradan a aviso en ESTOS archivos hasta que el
    // refactor llegue desde upstream; en el resto del código siguen como error.
    files: ["src/components/ui/**", "src/hooks/use-mobile.ts"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
];

export default config;
