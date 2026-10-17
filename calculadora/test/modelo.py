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

def FV(rate, nper, pmt, pv):
    # FV(rate,nper,pmt,pv) de Excel, con type=0
    if abs(rate) < 1e-12: return -(pv + pmt * nper)
    g = (1 + rate) ** nper
    return -(pv * g + pmt * (g - 1) / rate)

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
    C33 = 0.03*(C4*0.6 + C10 + C9)
    C49 = p['C49']

    F3 = C4 - C11
    H3 = C12 - C13
    tasa = 0.45*0.4

    def desglosar(ini, fin, cuota_anual):
        """Interés y principal de un año, por diferencia de saldo."""
        interes = min(max(cuota_anual - max(ini - fin, 0), 0), cuota_anual)
        return interes, cuota_anual - interes

    def regimen(interes, cuotas):
        base = C30*12 - C32 - interes - C33
        imp = max(base*tasa, 0)
        return imp, C30*12 - imp - C32 - cuotas

    # El interés deducible es el del año, no la media de la vida del préstamo: en una cuota
    # francesa está casi todo al principio, y deducir la media desplaza impuestos entre años.
    int_hip1 = desglosar(F3, max(FV(C16/12, 12, C18, -F3), 0), C18*12)[0] if F3 > 0 else 0
    int_pre1 = desglosar(H3, max(FV(C22/12, 12, C23, -H3), 0), C23*12)[0] if H3 > 0 else 0
    C36, C37 = regimen(int_hip1 + int_pre1, C18*12 + (C23*12 if H3 > 0 else 0))
    C38, C39 = regimen(int_hip1, C18*12)
    C40, C41 = regimen(0, 0)

    # IRPF de la ganancia patrimonial: escala del ahorro, por tramos.
    TRAMOS = [(6000, 0.19), (50000, 0.21), (200000, 0.23), (300000, 0.27), (float('inf'), 0.28)]
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
    aportado_acum = C13
    flujos = [-C13]
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
        G = max(FV(C16/12, 12, C18, -F), 0) if F > 0 else 0
        I = max(FV(C22/12, 12, C23, -H), 0) if H > 0 else 0
        J = (C3 + C10)*(1+C49)**n - G - I
        cuota_hip = C18*12 if F > 0 else 0
        cuota_pre = C23*12 if H > 0 else 0
        int_hip = desglosar(F, G, cuota_hip)[0]
        int_pre = desglosar(H, I, cuota_pre)[0]
        K = regimen(int_hip + int_pre, cuota_hip + cuota_pre)[1] / (2 if n == 1 else 1)
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
        base_amortizable = C4*0.6 + C10 + C9
        ganancia = max(precio - gastos_venta - ((C4 + C9 + C10) - min(C33*n, base_amortizable)), 0)
        imp_venta = impuesto_ganancia(ganancia)
        neto = precio - gastos_venta - imp_venta - G - I + L
        MV = TIR(flujos[:n] + [flujos[n] + neto]) if C13 else None
        filas.append({'n':n,'hipIni':F,'hipFin':G,'preIni':H,'preFin':I,'patrimonio':J,'cajaAno':K,
                      'aportacion':aportacion,'cajaAcum':L,'anualizada':M,'aportadoAcum':aportado_acum,
                      'gananciaFiscal':ganancia,'impuestoVenta':imp_venta,'netoVenta':neto,'tirVenta':MV})
        G_prev, I_prev, L_prev = G, I, L
    return {'escalares':{'gastosCompra':C9,'desembolso':C12,'aportado':C13,'cuotaHip':C18,'cuotaPre':C23,
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
}
res = {}
for nombre, cambios in ESC.items():
    p = dict(BASE); p.update(cambios)
    res[nombre] = {'params':p, 'salida':correr(p)}
json.dump(res, open(os.path.join(AQUI, 'modelo.json'), 'w'), indent=1)
print('escenarios:', list(res))
