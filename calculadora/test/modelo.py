"""Transcripción literal de las fórmulas de la hoja, independiente del motor JS.

Sólo sirve para contrastar: si dos implementaciones escritas por separado a partir de las
mismas fórmulas coinciden, las ramas que el escenario por defecto no toca (préstamo personal
vivo, amortización acelerada) están bien portadas.
"""
import json, os, sys

AQUI = os.path.dirname(os.path.abspath(__file__))

def PMT(rate, nper, pv):
    if nper <= 0 or pv <= 0: return 0.0
    if abs(rate) < 1e-12: return pv / nper
    return pv * rate / (1 - (1 + rate) ** -nper)

def TIR(flujos):
    """TIR por bisección, igual que la del motor: el flujo del año 0 va primero."""
    def vna(r):
        return sum(f / (1 + r) ** i for i, f in enumerate(flujos))
    if not any(f > 0 for f in flujos) or not any(f < 0 for f in flujos):
        return None
    bajo, alto = -0.9999, 10.0
    vbajo, valto = vna(bajo), vna(alto)
    if vbajo * valto > 0:
        return None
    for _ in range(200):
        medio = (bajo + alto) / 2
        v = vna(medio)
        if abs(v) < 1e-9 or alto - bajo < 1e-12:
            return medio
        if v * vbajo > 0:
            bajo, vbajo = medio, v
        else:
            alto = medio
    return (bajo + alto) / 2

def correr(p):
    C2,C3,C4 = p['C2'],p['C3'],p['C4']
    C7,C8,C10,C11 = p['C7'],p['C8'],p['C10'],p['C11']
    C9 = 0.1*C4 + 1000 + C7*(1.21 if C8=='Sí' else 1)
    C12 = C11 + C9 + C10
    C13 = p['C13']
    C15,C16 = p['C15'],p['C16']
    C18 = PMT(C16/12, C15*12, C4-C11)
    C19 = p['C19']
    C21,C22 = p['C21'],p['C22']
    C23 = PMT(C22/12, C21*12, C12-C13)
    C24 = p['C24']
    C26,C27,C28,C30,C31 = p['C26'],p['C27'],p['C28'],p['C30'],p['C31']
    C29 = C30/2
    C32 = C27*12 + C26 + C28 + C29 + C31
    # Fiscalmente sólo se amortiza la construcción: el precio y los gastos de compra entran en la
    # proporción del 60 % de construcción, y la reforma entera.
    BASE_AMORT = 0.6*(C4 + C9) + C10
    C33 = 0.03*BASE_AMORT
    C49 = p['C49']

    F3 = C4 - C11
    H3 = C12 - C13
    tasa = 0.45*0.4
    # Comisión de apertura: porcentaje del principal de cada deuda, pagado al firmar y por tanto
    # parte de lo aportado. No entra en el coste ni en el valor de adquisición del piso.
    com_hip = p.get('comHip', 0.0) * max(F3, 0)
    com_pre = p.get('comPre', 0.0) * max(H3, 0)
    com = com_hip + com_pre

    def ano_deuda(ini, tipo, cuota):
        """Un año de una deuda: (saldo final, cuotas pagadas, interés). Sin fórmula cerrada: mes a
        mes, y el último pago es sólo el saldo más su interés, así que el año en que la deuda se
        cancela no se cobran doce cuotas. Es deliberadamente distinto de lo que hace el motor
        (cerrado si el saldo sobrevive), para que el cruce compruebe las dos formas."""
        s, pagado, interes = ini, 0.0, 0.0
        for _ in range(12):
            if s <= 0: break
            i = s*tipo/12
            pago = min(cuota, s + i)
            s = s + i - pago
            pagado += pago
            interes += i
        return max(s, 0.0), pagado, interes

    def regimen(interes, cuotas, n=1, comision=0.0, lotes=None):
        """Un año fiscal de alquiler: (impuesto, caja, datos del límite y del arrastre).

        Art. 23.1.a LIRPF: intereses + gastos de financiación (la comisión de apertura, en el año
        en que se paga) + reparación y conservación (el mantenimiento) no pueden superar los
        ingresos íntegros del año. El exceso se deduce en los 4 años siguientes con el mismo
        límite, lo más antiguo primero; lo que no quepa en ese plazo se pierde. Los gastos del año
        entran antes que los arrastrados.

        El rendimiento neto negativo por los demás gastos (comunidad, IBI, seguros, amortización)
        da impuesto 0 y no se compensa: la herramienta no conoce otros ingresos del usuario."""
        lotes = lotes or []
        ingresos = C30*12
        deduccion = min(C33, max(BASE_AMORT - C33*(n-1), 0))
        propios = interes + comision + C31
        del_ano = min(propios, ingresos)
        hueco = ingresos - del_ano
        usado, perdido, nuevos = 0.0, 0.0, []
        for ano, importe in lotes:                     # ya van de más antiguo a más reciente
            if n - ano > 4:                            # el plazo de cuatro años siguientes ya pasó
                perdido += importe
                continue
            u = min(importe, hueco)
            hueco -= u; usado += u
            if importe - u > 1e-9: nuevos.append((ano, importe - u))
        if propios > ingresos: nuevos.append((n, propios - ingresos))
        base = ingresos - (C32 - C31) - (del_ano + usado) - deduccion
        imp = max(base*tasa, 0)
        datos = {'deducido': del_ano + usado, 'pendiente': sum(i for _, i in nuevos), 'perdido': perdido, 'lotes': nuevos}
        return imp, ingresos - imp - C32 - cuotas, datos

    # El interés deducible es el del año, no la media de la vida del préstamo: en una cuota
    # francesa está casi todo al principio, y deducir la media desplaza impuestos entre años.
    h1 = ano_deuda(F3, C16, C18) if F3 > 0 else (0, 0, 0)
    p1 = ano_deuda(H3, C22, C23) if H3 > 0 else (0, 0, 0)
    int_hip1, int_pre1 = h1[2], p1[2]
    # Las tres columnas del primer año describen el régimen anual, sin la comisión de apertura
    # (un gasto de una sola vez): el límite sí se aplica, pero sin nada arrastrado de antes.
    C36, C37, _ = regimen(int_hip1 + int_pre1, h1[1] + p1[1])
    C38, C39, _ = regimen(int_hip1, h1[1])
    C40, C41, _ = regimen(0, 0)

    # IRPF de la ganancia patrimonial: escala del ahorro, por tramos (el 30 % por encima de 300.000 € desde 2025).
    TRAMOS = [(6000, 0.19), (50000, 0.21), (200000, 0.23), (300000, 0.27), (float('inf'), 0.30)]
    def impuesto_ganancia(g):
        resto, anterior, cuota = g, 0, 0.0
        for tope, tipo in TRAMOS:
            parte = min(resto, tope - anterior)
            if parte <= 0:
                break
            cuota += parte*tipo
            resto -= parte
            anterior = tope
        return cuota
    pct_venta = p.get('pctGastosVenta', 0.05)

    filas = []
    G_prev = I_prev = None
    L_prev = 0.0
    lotes = []
    perdido_acum = 0.0
    aportado_acum = C13 + com
    flujos = [-(C13 + com)]
    for n in range(1, p['horizonte']+1):
        # La caja acumulada se reparte en un solo sentido: primero la deuda con el tipo más
        # alto y sólo el sobrante contra la otra. Lo que no se gaste sigue acumulado.
        if n == 1:
            F = F3; H = H3; sobrante = 0.0
        else:
            sobrante = L_prev
            saldos = {'hip': max(G_prev, 0.0), 'pre': max(I_prev, 0.0)}
            acelera = {'hip': C19 == 'Sí', 'pre': C24 == 'Sí'}
            tipos = {'hip': C16, 'pre': C22}
            # A igualdad de tipo manda el préstamo, que es el de plazo más corto.
            for cual in sorted(['pre', 'hip'], key=lambda c: -tipos[c]):
                if saldos[cual] > 0 and acelera[cual]:
                    pago = min(sobrante, saldos[cual])
                    saldos[cual] -= pago
                    sobrante -= pago
            F, H = saldos['hip'], saldos['pre']
        G, cuota_hip, int_hip = ano_deuda(F, C16, C18) if F > 0 else (0.0, 0.0, 0.0)
        I, cuota_pre, int_pre = ano_deuda(H, C22, C23) if H > 0 else (0.0, 0.0, 0.0)
        J = (C3 + C10)*(1+C49)**n - G - I
        # El año 1 es un año completo, como los demás: la deuda baja doce cuotas y el piso se
        # revaloriza doce meses, así que el alquiler, los gastos y el IRPF también son de doce.
        irpf, K, dat = regimen(int_hip + int_pre, cuota_hip + cuota_pre, n, com if n == 1 else 0.0, lotes)
        lotes = dat['lotes']
        perdido_acum += dat['perdido']
        base = sobrante
        # Un año en pérdidas se cubre con la caja acumulada y, si no llega, con dinero nuevo.
        disponible = base + K
        aportacion = -disponible if disponible < 0 else 0.0
        L = max(disponible, 0.0)
        aportado_acum += aportacion
        flujos.append(-aportacion)
        M = TIR(flujos[:n] + [flujos[n] + J + L]) if C13 else None
        # Vender al final del año: precio de mercado menos gastos, deuda e IRPF de la ganancia.
        # La amortización deducida resta del valor de adquisición y vuelve a tributar.
        precio = (C3 + C10)*(1+C49)**n
        gastos_venta = precio*pct_venta
        # La amortización acumulada topa en la base amortizable: al 3% se agota a los 33 años.
        ganancia = max(precio - gastos_venta - ((C4 + C9 + C10) - min(C33*n, BASE_AMORT)), 0)
        imp_venta = impuesto_ganancia(ganancia)
        neto = precio - gastos_venta - imp_venta - G - I + L
        MV = TIR(flujos[:n] + [flujos[n] + neto]) if C13 else None
        filas.append({'n':n,'irpf':irpf,'hipIni':F,'hipFin':G,'preIni':H,'preFin':I,'patrimonio':J,'cajaAno':K,
                      'aportacion':aportacion,'cajaAcum':L,'finDeducido':dat['deducido'],'finPendiente':dat['pendiente'],'finPerdido':perdido_acum,'anualizada':M,'aportadoAcum':aportado_acum,
                      'gananciaFiscal':ganancia,'impuestoVenta':imp_venta,'netoVenta':neto,'tirVenta':MV})
        G_prev, I_prev, L_prev = G, I, L
    return {'escalares':{'gastosCompra':C9,'desembolso':C12,'aportado':C13 + com,'comision':com,'cuotaHip':C18,'cuotaPre':C23,
            'gastosAnuales':C32,'amortizacion':C33,'impConPrestamo':C36,'cajaConPrestamo':C37,
            'impConHipoteca':C38,'cajaConHipoteca':C39,'impSinDeuda':C40,'cajaSinDeuda':C41,
            'costeTotal':C4+C9+C10}, 'filas':filas}

BASE = dict(C2=500000,C3=500000,C4=500000,C7=0,C8='No',C10=0,C11=100000,C13=151000,
            C15=30,C16=0.022,C19='No',C21=5,C22=0.11,C24='Sí',
            C26=250,C27=30,C28=250,C30=2000,C31=50,C49=0.03,horizonte=30)

ESC = {
 'defecto':       {},
 'prestamo':      {'C13':100000},
 'hip_acelerada': {'C19':'Sí'},
 'ambas':         {'C13':100000,'C19':'Sí'},
 'pre_no_acel':   {'C13':100000,'C24':'No'},
 'barato':        {'C2':120000,'C3':120000,'C4':120000,'C11':20000,'C13':32000,'C30':900},
 'sin_entrada':   {'C11':0,'C13':51000},
 # La deuda se cancela a mitad de año: hipoteca a 10,5 años (el año 11 sólo cobra seis meses) y
 # acelerada, que la cancela dentro de un año completo.
 'cancela_medio': {'C11':250000, 'C13':301000, 'C15':10.5},
 'cancela_acel':  {'C11':250000, 'C13':301000, 'C15':25, 'C19':'Sí', 'C30':3500},
 # Cuarenta años: la amortización fiscal se agota al año 34 y el tipo del ahorro llega al 30 %.
 'tope_amort':    {'horizonte':40, 'C11':500000, 'C13':551000},
 # Comisión de apertura del 1 % en la hipoteca y del 2 % en el préstamo personal.
 'comision':      {'C13':100000,'comHip':0.01,'comPre':0.02},
 # Gastos ESTIMADOS con las tasas por defecto de la herramienta, en vez de cifras escritas a mano:
 # IBI 0,2 % del precio, comunidad 1,2 €/m²·mes, seguro de hogar 2,5 €/m²·año, impagos 0,5
 # mensualidades y mantenimiento 2 % del alquiler anual (la superficie de estos escenarios es de
 # 100 m²). Si alguien cambia una tasa por defecto sin tocar esto, motor y transcripción divergen.
 # Límite del art. 23.1.a (intereses + financiación + conservación <= ingresos íntegros del año) y
 # arrastre de cuatro años. Alquiler muy bajo y apertura del 10 %: la comisión no cabe en el año 1,
 # se arrastra y rebaja el IRPF del año 2 (que sin arrastre pagaría 689 € en vez de 213 €).
 'apertura_arrastre': {'C2':100000,'C3':100000,'C4':100000,'C11':10000,'C13':21000,'C26':100,'C27':10,'C28':100,'C30':700,'C31':40,'comHip':0.10,'horizonte':10},
 # Interés que choca con el límite: hipoteca corta al 6 % sobre un alquiler que no la cubre. El
 # exceso del año 1 se aprovecha en el 2.
 'interes_limite': {'C16':0.06,'C15':6,'C30':1800,'horizonte':10},
 # Interés tan alto que ningún año deja hueco: el exceso se acumula y lo de más de cuatro años se pierde.
 'interes_caduca': {'C16':0.08,'horizonte':12},
 'estimados':     {'estimados':True, 'C26':0.002*500000, 'C27':1.2*100, 'C28':2.5*100, 'C31':0.02*2000*12},
}
res = {}
for nombre, cambios in ESC.items():
    p = dict(BASE); p.update(cambios)
    res[nombre] = {'params':p, 'salida':correr(p)}
json.dump(res, open(os.path.join(AQUI, 'modelo.json'), 'w'), indent=1)
print('escenarios:', list(res))
