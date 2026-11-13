# ⚖️ 03 — Deduplicación y Calidad del Sistema

## 1. El Problema de la Deduplicación Tradicional

En sistemas simples de prospección es común encontrar dos errores críticos:
1. **Falso Negativo (Duplicados No Detectados)**: Variaciones mínimas en el teléfono (`+34 600...` vs `0034600...`) o en el nombre de la empresa crean registros duplicados.
2. **Falso Positivo (Fusión Incorrecta)**: Dos negocios distintos que comparten un nombre genérico (ej: "Clínica Dental Madrid" o "Restaurante Central") terminan fusionados si el sistema solo compara texto.

---

## 2. El Algoritmo Canónico de AGENTE LEADS (`dedup.ts`)

AGENTE LEADS implementa deduplicación basada en señales compuestas y detección activa de conflictos:

### A. Normalización Rigurosa
- **Nombres**: Eliminación de acentos, caracteres especiales, stopwords ("sl", "sa", "inc") y espacios repetidos.
- **Teléfonos**: E.164 canónico eliminando prefijos de país y espacios.
- **Sitios Web**: Extracción del dominio raíz limpio (`https://www.ejemplo.es/contacto` $\rightarrow$ `ejemplo.es`).

### B. Niveles de Coincidencia
- `EXACT`: Mismo teléfono o mismo dominio web canónico.
- `STRONG`: Mismo nombre normalizado con coincidencia parcial de ubicación o dirección.
- `PROBABLE`: Similitud de nombre alta sin señales contradictorias.

### C. Detección Decisiva de Conflictos
Si dos candidatos tienen el mismo nombre pero presentan **teléfonos o dominios web diferentes y no vacíos**, el algoritmo declara **conflicto**. En ese caso, **rechaza la fusión**, reconociendo que son entidades comerciales independientes.

### D. Superviviente Determinista
Cuando dos registros se fusionan válidamente, el sistema no escoge al azar ni por orden de llegada: selecciona como registro base aquel que tenga mayor completitud de datos (email, teléfono, web, dirección) y enriquece los huecos vacíos con el segundo.

---

## 3. Monitoreo de Salud de Proveedores (`quality.ts`)

Para evitar bloqueos silenciosos de servicios externos (Apify, SendGrid, verificadores, NIM):
- Se persiste el ratio de éxito/fallo de cada proveedor.
- Si un proveedor supera el umbral de fallos consecutivos, pasa a estado `DEGRADED`.
- El agente notifica en su reporte técnico si operó bajo degradación o conmutó a una herramienta alternativa.
