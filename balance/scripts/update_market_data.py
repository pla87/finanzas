import json
import os
import urllib.request
from datetime import datetime, timezone

import yfinance as yf

# 1. FOREX Rates (EUR as baseline)
# Las siete divisas de Retiro, que son las que admite la aplicación: un fichero
# tiene que valer en las dos herramientas.
CURRENCY_PAIRS = {
    "USD": "EURUSD=X",
    "JPY": "EURJPY=X",
    "GBP": "EURGBP=X",
    "CHF": "EURCHF=X",
    "HKD": "EURHKD=X",
    "PHP": "EURPHP=X"
}

# 2. Complete IBEX 35 + Top 10 by Market Cap per region
MARKET_TICKERS = {
    "IBEX": [
        "ANA.MC", "ACX.MC", "ACS.MC", "AENA.MC", "AMS.MC", "BBVA.MC", "SAB.MC", "SAN.MC",
        "BKT.MC", "CABK.MC", "CLNX.MC", "ENG.MC", "ELE.MC", "FER.MC", "FLUID.MC", "FDR.MC",
        "GRF.MC", "IAG.MC", "IBE.MC", "IDR.MC", "ITX.MC", "COL.MC", "LOG.MC", "MAP.MC",
        "MEL.MC", "MRL.MC", "NTGY.MC", "PUIG.MC", "RED.MC", "REP.MC", "ROVI.MC", "SCYR.MC",
        "SLR.MC", "TEF.MC", "UNI.MC"
    ],
    "NASDAQ": ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "COST", "ASML"],
    "NYSE": ["BRK-B", "JPM", "V", "WMT", "MA", "UNH", "PG", "JNJ", "HD", "XOM"],
    "EURONEXT": ["MC.PA", "OR.PA", "RMS.PA", "SAP.DE", "SIE.DE", "TTE.PA", "AIR.PA", "SAN.PA", "ALV.DE", "BNP.PA"],
    "LSE": ["AZN.L", "SHEL.L", "HSBA.L", "ULVR.L", "BP.L", "GSK.L", "RIO.L", "REL.L", "DGE.L", "BATS.L"],
    "TSE": ["7203.T", "6758.T", "8306.T", "9984.T", "6861.T", "8035.T", "6501.T", "4063.T", "9432.T", "6902.T"]
}

# El euríbor a 12 meses es la referencia de las hipotecas variables españolas.
# Se toma del portal de datos del BCE, que no pide clave y responde SDMX-JSON,
# así que basta con urllib y no hace falta añadir ninguna dependencia.
EURIBOR_URL = (
    "https://data-api.ecb.europa.eu/service/data/FM/M.U2.EUR.RT.MM.EURIBOR1YD_.HSTA"
    "?lastNObservations=1&format=jsondata"
)

# Fuera de esta horquilla damos el dato por erróneo antes que publicarlo: el
# euríbor ha estado en negativo y ha pasado del 5%, pero no de esto.
EURIBOR_MIN, EURIBOR_MAX = -2.0, 20.0


def fetch_euribor(previous=None):
    """Último euríbor a 12 meses publicado. Si la descarga falla se conserva el
    valor anterior marcado como obsoleto: es preferible una referencia de hace
    unos días a que las hipotecas variables se queden sin tipo."""
    try:
        req = urllib.request.Request(EURIBOR_URL, headers={"User-Agent": "balance-market-data"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            doc = json.load(resp)

        series = doc["dataSets"][0]["series"]
        observations = next(iter(series.values()))["observations"]
        # Con lastNObservations=1 solo viene una, pero no damos por hecho el índice.
        last_index = max(observations, key=int)
        value = float(observations[last_index][0])

        periods = doc["structure"]["dimensions"]["observation"][0]["values"]
        period = periods[int(last_index)]["id"] if int(last_index) < len(periods) else None

        if not EURIBOR_MIN <= value <= EURIBOR_MAX:
            raise ValueError(f"valor inverosímil: {value}")

        print(f"Euríbor 12M: {value} ({period})")
        return {"ratePct": round(value, 3), "period": period, "stale": False}
    except Exception as e:
        print(f"Euríbor: {e}")
        if previous and previous.get("ratePct") is not None:
            print(f"Euríbor: sin dato nuevo, se conserva {previous['ratePct']}")
            return {**previous, "stale": True}
        return None


# Rendimiento por dividendo por encima del cual asumimos que el dato es basura.
MAX_PLAUSIBLE_DIV_YIELD = 25.0

# Divisas cotizadas en unidad menor -> (divisa padre, unidades por padre).
MINOR_UNIT_CURRENCIES = {
    "GBp": ("GBP", 100),
    "ZAc": ("ZAR", 100),
    "ILA": ("ILS", 100),
}


def fetch_rates(previous=None):
    """Tipos con el euro como base. Un par que falla conserva su valor
    anterior en lugar de desaparecer: sin la clave, el cliente trataba la
    divisa como si estuviera a la par con el euro."""
    previous = previous or {}
    rates = {"EUR": 1.0}
    stale = []
    for code, ticker in CURRENCY_PAIRS.items():
        value = None
        try:
            data = yf.Ticker(ticker).history(period="5d")
            if not data.empty:
                value = round(float(data["Close"].iloc[-1]), 4)
        except Exception as e:
            print(f"FX {code}: {e}")
        if value:
            rates[code] = value
        elif previous.get(code):
            rates[code] = previous[code]
            stale.append(code)
            print(f"FX {code}: sin dato nuevo, se conserva {previous[code]}")
        else:
            stale.append(code)
            print(f"FX {code}: sin dato y sin valor previo")
    return rates, stale

def index_previous_tickers(previous_db):
    """Índice por símbolo original de la última tanda buena, para poder
    conservar un valor cuando la descarga de hoy falle."""
    index = {}
    for entries in (previous_db or {}).values():
        for entry in entries or []:
            symbol = entry.get("rawSymbol")
            if symbol:
                index[symbol] = entry
    return index


def fetch_tickers(previous_db=None):
    """Cotizaciones por mercado. Un valor que falla conserva su entrada
    anterior en lugar de desaparecer: sin esto, una tanda en la que Yahoo
    rechaza todas las peticiones escribía un fichero con cero valores y lo
    publicaba como si fuera bueno."""
    known = index_previous_tickers(previous_db)
    db = {}
    stale = []
    for market, tickers in MARKET_TICKERS.items():
        db[market] = []
        for sym in tickers:
            entry = None
            try:
                t = yf.Ticker(sym)
                info = t.info
                price = info.get("regularMarketPrice") or info.get("currentPrice") or info.get("previousClose")

                # Fallback to history if current price field is empty
                if price is None:
                    hist = t.history(period="5d")
                    if not hist.empty:
                        price = float(hist["Close"].iloc[-1])

                # yfinance ya devuelve el rendimiento en porcentaje. La regla
                # anterior multiplicaba por 100 todo lo que fuera <= 1, es decir
                # justo los valores que ya venían bien: Apple 0,33% se guardaba
                # como 33%. Lo tomamos tal cual y descartamos lo inverosímil.
                div_yield = info.get("dividendYield")
                try:
                    div_yield = round(float(div_yield), 2) if div_yield is not None else 0.0
                except (TypeError, ValueError):
                    div_yield = 0.0
                if not 0.0 <= div_yield <= MAX_PLAUSIBLE_DIV_YIELD:
                    print(f"{sym}: rendimiento por dividendo inverosímil ({div_yield}); se guarda 0")
                    div_yield = 0.0

                clean_ticker = sym.split(".")[0]
                currency = info.get("currency", "EUR")
                name = info.get("shortName") or info.get("longName") or clean_ticker

                # El LSE cotiza en peniques (GBp). Sin normalizar, 12.146
                # peniques entraban en el balance como 12.146 libras.
                if price and currency in MINOR_UNIT_CURRENCIES:
                    parent, per = MINOR_UNIT_CURRENCIES[currency]
                    price = float(price) / per
                    currency = parent

                if price:
                    entry = {
                        "ticker": clean_ticker,
                        "rawSymbol": sym,
                        "name": name,
                        "price": round(float(price), 2),
                        "divYield": div_yield,
                        "currency": currency
                    }
            except Exception as e:
                print(f"Skipping {sym}: {e}")

            if entry is None and sym in known:
                entry = known[sym]
                stale.append(sym)
                print(f"{sym}: sin dato nuevo, se conserva {entry.get('price')}")

            if entry is not None:
                db[market].append(entry)
    return db, stale


# Vite sirve `public/` en la raíz del sitio; la app pide ./market_data.json.
# Escribir en la raíz del repositorio dejaba el archivo fuera del despliegue.
OUTPUT_PATH = os.path.join("public", "market_data.json")

# Por debajo de esta fracción de los valores que ya teníamos, damos la tanda
# por rota y no escribimos nada. Publicar un fichero medio vacío deja el
# selector de valores del sitio sin contenido y nadie se entera.
MIN_TICKER_RATIO = 0.5


def count_tickers(db):
    return sum(len(entries or []) for entries in (db or {}).values())


if __name__ == "__main__":
    previous_doc = {}
    try:
        with open(OUTPUT_PATH, encoding="utf-8") as f:
            previous_doc = json.load(f)
    except (OSError, ValueError):
        pass

    previous_rates = previous_doc.get("rates", {})
    previous_tickers = previous_doc.get("tickers", {})
    previous_count = count_tickers(previous_tickers)

    rates, stale_rates = fetch_rates(previous_rates)
    tickers, stale_tickers = fetch_tickers(previous_tickers)
    euribor = fetch_euribor(previous_doc.get("euribor"))
    written_count = count_tickers(tickers)

    # Si había datos y hoy se ha perdido la mitad, salimos en rojo sin tocar
    # el fichero: es preferible que el workflow falle a la vista de todos
    # antes que publicar un balance sin valores.
    if previous_count and written_count < previous_count * MIN_TICKER_RATIO:
        raise SystemExit(
            f"Abortado: solo {written_count} valores frente a los {previous_count} "
            f"anteriores. No se escribe {OUTPUT_PATH}."
        )

    market_data = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "staleRates": stale_rates,
        "staleTickers": stale_tickers,
        "euribor": euribor,
        "rates": rates,
        "tickers": tickers,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(market_data, f, ensure_ascii=False, indent=2)
    print(
        f"Escrito {OUTPUT_PATH} ({len(rates)} divisas, {len(stale_rates)} sin refrescar; "
        f"{written_count} valores, {len(stale_tickers)} sin refrescar)"
    )
