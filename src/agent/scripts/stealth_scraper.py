import sys
import json
import argparse
import re

try:
    from scrapling import StealthyFetcher
except ImportError:
    print(json.dumps({"error": "Scrapling library not installed."}))
    sys.exit(1)

def extract_emails(text):
    """Extrae emails básicos del texto usando regex."""
    if not text:
        return []
    # Regex simple para emails
    matches = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', text)
    return list(set(matches))

def main():
    parser = argparse.ArgumentParser(description='Stealth scraper usando Scrapling.')
    parser.add_argument('--url', required=True, help='URL a procesar')
    parser.add_argument('--selector', required=False, help='Selector CSS opcional')
    parser.add_argument('--adaptive', action='store_true', help='Usar selector adaptativo')
    
    args = parser.parse_args()

    try:
        # Inicializa StealthyFetcher que usa Playwright por debajo para evasión
        fetcher = StealthyFetcher()
    except Exception as e:
        print(json.dumps({"error": f"Fallo al inicializar StealthyFetcher: {str(e)}"}))
        sys.exit(1)

    try:
        response = fetcher.fetch(
            args.url,
            headless=True,
            network_idle=True, # Esperar que la red esté inactiva (ideal para SPA/IG)
            timeout=45000
        )
        
        result = {}
        
        if args.selector:
            # Extraer con selector específico
            elements = response.css(args.selector, adaptive=args.adaptive)
            if elements:
                result['data'] = [el.text for el in elements if el.text]
            else:
                result['data'] = []
        else:
            # Extracción general para análisis del LLM
            body_element = response.css('body')
            # Extraer todo el texto visible (o solo de ciertas etiquetas)
            body_text = body_element.text if body_element else ""
            
            # Limitar longitud para no saturar el contexto del LLM
            result['text'] = body_text[:8000] 
            
            # Tratar de encontrar emails en todo el texto
            emails = extract_emails(body_text)
            if not emails:
                # Buscar en el código fuente de la página por si hay mailto o emails ocultos
                emails = extract_emails(str(response.body))
                
            result['emails_found'] = emails
            
            # Extraer links de perfiles sociales (opcional, útil para enriquecimiento)
            links = []
            for a in response.css('a'):
                href = a.attributes.get("href")
                if href and ("instagram.com" in href or "linkedin.com" in href or "twitter.com" in href):
                    links.append(href)
                    
            result['social_links'] = list(set(links))
        
        print(json.dumps({"success": True, "result": result}))
        
    except Exception as e:
        print(json.dumps({"error": f"Scraping falló: {str(e)}"}))

if __name__ == "__main__":
    main()
