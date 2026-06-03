"use client";

import { useEffect, useMemo, useState } from "react";

const TALLES = ["34", "36", "38", "40", "42", "44", "46", "48", "50"];
const MEDIOS = ["Efectivo", "Transferencia", "Mercado Pago", "Tarjeta", "Otro"];
const hoy = () => new Date().toISOString().slice(0, 10);
const hora = () => new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const plata = (n) => "$" + Number(n || 0).toLocaleString("es-AR");
const stockVacio = () => Object.fromEntries(TALLES.map((t) => [t, 0]));

export default function Home() {
  const [tab, setTab] = useState("inicio");
  const [mensaje, setMensaje] = useState("Iniciando sistema...");

  const [productos, setProductos] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [cajas, setCajas] = useState([]);
  const [movimientos, setMovimientos] = useState([]);

  const [busqueda, setBusqueda] = useState("");
  const [filtroTalle, setFiltroTalle] = useState("");
  const [soloDisponible, setSoloDisponible] = useState(true);

  const [producto, setProducto] = useState({
    codigo: "",
    nombre: "",
    marca: "",
    categoria: "",
    color: "",
    costo: "",
    venta: "",
    stockMinimo: 1,
    foto: "",
    stock: stockVacio(),
  });

  const [venta, setVenta] = useState({
    productoId: "",
    talle: "34",
    cantidad: 1,
    medio: "Efectivo",
    descuento: 0,
  });

  const [gasto, setGasto] = useState({
    concepto: "",
    categoria: "General",
    monto: "",
    medio: "Efectivo",
  });

  const [caja, setCaja] = useState({
    apertura: "",
    efectivoReal: "",
    observacion: "",
  });

  useEffect(() => {
    async function cargar() {
      try {
        if (window.delpaDB) {
          const data = await window.delpaDB.load();
          setProductos(data.productos || []);
          setVentas(data.ventas || []);
          setGastos(data.gastos || []);
          setCajas(data.cajas || []);
          setMovimientos(data.movimientos || []);
          setMensaje("Base de datos local conectada");
        } else {
          const data = JSON.parse(localStorage.getItem("gestion-delpa-pro") || "{}");
          setProductos(data.productos || []);
          setVentas(data.ventas || []);
          setGastos(data.gastos || []);
          setCajas(data.cajas || []);
          setMovimientos(data.movimientos || []);
          setMensaje("Guardado en navegador activo");
        }
      } catch {
        setMensaje("Error al cargar datos");
      }
    }
    cargar();
  }, []);

  useEffect(() => {
    async function guardar() {
      const data = { productos, ventas, gastos, cajas, movimientos };
      try {
        if (window.delpaDB) {
          await window.delpaDB.save(data);
          setMensaje("Guardado automático en archivo local");
        } else {
          localStorage.setItem("gestion-delpa-pro", JSON.stringify(data));
          setMensaje("Guardado automático en navegador");
        }
      } catch {
        setMensaje("Error al guardar");
      }
    }
    guardar();
  }, [productos, ventas, gastos, cajas, movimientos]);

  const ventasHoy = ventas.filter((v) => v.fecha === hoy());
  const gastosHoy = gastos.filter((g) => g.fecha === hoy());

  const resumen = useMemo(() => {
    const cajaVentas = ventasHoy.reduce((a, v) => a + v.total, 0);
    const costo = ventasHoy.reduce((a, v) => a + v.costoTotal, 0);
    const gananciaBruta = cajaVentas - costo;
    const totalGastos = gastosHoy.reduce((a, g) => a + g.monto, 0);
    const neto = gananciaBruta - totalGastos;

    const porMedio = {};
    MEDIOS.forEach((m) => {
      porMedio[m] = ventasHoy.filter((v) => v.medio === m).reduce((a, v) => a + v.total, 0);
    });

    const gastosEfectivo = gastosHoy.filter((g) => g.medio === "Efectivo").reduce((a, g) => a + g.monto, 0);
    const efectivoSistema = porMedio["Efectivo"] - gastosEfectivo;

    return { cajaVentas, costo, gananciaBruta, totalGastos, neto, porMedio, efectivoSistema };
  }, [ventas, gastos]);

  const stockTotal = productos.reduce(
    (a, p) => a + TALLES.reduce((s, t) => s + Number(p.stock?.[t] || 0), 0),
    0
  );

  const inversionStock = productos.reduce(
    (a, p) => a + TALLES.reduce((s, t) => s + Number(p.stock?.[t] || 0), 0) * Number(p.costo || 0),
    0
  );

  const ventaPotencial = productos.reduce(
    (a, p) => a + TALLES.reduce((s, t) => s + Number(p.stock?.[t] || 0), 0) * Number(p.venta || 0),
    0
  );

  const stockBusqueda = productos
    .flatMap((p) =>
      TALLES.map((t) => ({
        ...p,
        talle: t,
        cantidad: Number(p.stock?.[t] || 0),
      }))
    )
    .filter((x) => !soloDisponible || x.cantidad > 0)
    .filter((x) => !filtroTalle || x.talle === filtroTalle)
    .filter((x) =>
      `${x.codigo} ${x.nombre} ${x.marca} ${x.categoria} ${x.color} ${x.talle}`
        .toLowerCase()
        .includes(busqueda.toLowerCase())
    );

  const alertas = productos
    .flatMap((p) =>
      TALLES.map((t) => ({
        producto: p,
        talle: t,
        cantidad: Number(p.stock?.[t] || 0),
      }))
    )
    .filter((x) => x.cantidad <= Number(x.producto.stockMinimo || 0));

  function movimiento(tipo, detalle) {
    setMovimientos([{ id: uid(), tipo, detalle, fecha: hoy(), hora: hora() }, ...movimientos]);
  }

  function cargarFoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setProducto({ ...producto, foto: reader.result });
    reader.readAsDataURL(file);
  }

  function guardarProducto() {
    if (!producto.nombre || !producto.costo || !producto.venta) return alert("Faltan datos del producto");

    setProductos([
      ...productos,
      {
        ...producto,
        id: uid(),
        costo: Number(producto.costo),
        venta: Number(producto.venta),
        stockMinimo: Number(producto.stockMinimo || 0),
      },
    ]);

    movimiento("Producto", `Alta de ${producto.nombre}`);
    setProducto({
      codigo: "",
      nombre: "",
      marca: "",
      categoria: "",
      color: "",
      costo: "",
      venta: "",
      stockMinimo: 1,
      foto: "",
      stock: stockVacio(),
    });
  }

  function registrarVenta() {
    const p = productos.find((x) => x.id === venta.productoId);
    if (!p) return alert("Elegí un producto");

    const cantidad = Number(venta.cantidad || 1);
    const stockActual = Number(p.stock?.[venta.talle] || 0);
    if (stockActual < cantidad) return alert("No hay stock suficiente");

    const descuento = Number(venta.descuento || 0);
    const total = p.venta * cantidad - descuento;

    const nuevaVenta = {
      id: uid(),
      productoId: p.id,
      nombre: p.nombre,
      codigo: p.codigo,
      color: p.color,
      talle: venta.talle,
      cantidad,
      medio: venta.medio,
      descuento,
      total,
      costoTotal: p.costo * cantidad,
      fecha: hoy(),
      hora: hora(),
    };

    setVentas([nuevaVenta, ...ventas]);

    setProductos(
      productos.map((x) =>
        x.id === p.id
          ? { ...x, stock: { ...x.stock, [venta.talle]: stockActual - cantidad } }
          : x
      )
    );

    movimiento("Venta", `${p.nombre} ${p.color} T${venta.talle} x${cantidad}`);
    setVenta({ productoId: "", talle: "34", cantidad: 1, medio: "Efectivo", descuento: 0 });
  }

  function guardarGasto() {
    if (!gasto.concepto || !gasto.monto) return alert("Faltan datos del gasto");

    const nuevo = {
      id: uid(),
      ...gasto,
      monto: Number(gasto.monto),
      fecha: hoy(),
      hora: hora(),
    };

    setGastos([nuevo, ...gastos]);
    movimiento("Gasto", `${gasto.concepto} ${plata(gasto.monto)}`);
    setGasto({ concepto: "", categoria: "General", monto: "", medio: "Efectivo" });
  }

  function cerrarCaja() {
    const apertura = Number(caja.apertura || 0);
    const efectivoReal = Number(caja.efectivoReal || 0);
    const esperado = apertura + resumen.efectivoSistema;
    const diferencia = efectivoReal - esperado;

    const cierre = {
      id: uid(),
      fecha: hoy(),
      hora: hora(),
      apertura,
      cajaVentas: resumen.cajaVentas,
      costo: resumen.costo,
      gastos: resumen.totalGastos,
      gananciaBruta: resumen.gananciaBruta,
      neto: resumen.neto,
      efectivoSistema: resumen.efectivoSistema,
      efectivoEsperado: esperado,
      efectivoReal,
      diferencia,
      observacion: caja.observacion,
    };

    setCajas([cierre, ...cajas]);
    movimiento("Caja", `Cierre con diferencia ${plata(diferencia)}`);
    setCaja({ apertura: "", efectivoReal: "", observacion: "" });
    alert("Cierre de caja guardado");
  }

  return (
    <main style={S.page}>
      <header style={S.header}>
        <div>
          <h1 style={S.h1}>DELPA Gestión PRO</h1>
          <p style={S.sub}>Sistema comercial local para stock, ventas, caja y control diario</p>
          <p style={S.save}>{mensaje}</p>
        </div>
      </header>

      <nav style={S.nav}>
        {["inicio", "stock", "productos", "ventas", "caja", "gastos", "movimientos"].map((x) => (
          <button key={x} onClick={() => setTab(x)} style={tab === x ? S.tabA : S.tab}>
            {x.toUpperCase()}
          </button>
        ))}
      </nav>

      {tab === "inicio" && (
        <>
          <section style={S.cards}>
            <Card t="Caja ventas hoy" v={plata(resumen.cajaVentas)} />
            <Card t="Separar costo" v={plata(resumen.costo)} amarillo />
            <Card t="Ganancia bruta" v={plata(resumen.gananciaBruta)} verde />
            <Card t="Ganancia neta" v={plata(resumen.neto)} verde />
            <Card t="Stock total" v={stockTotal} />
            <Card t="Inversión stock" v={plata(inversionStock)} />
            <Card t="Venta potencial" v={plata(ventaPotencial)} />
            <Card t="Ganancia potencial" v={plata(ventaPotencial - inversionStock)} verde />
          </section>

          <section style={S.grid}>
            <Panel title="Alertas de stock mínimo">
              {alertas.length ? alertas.slice(0, 30).map((x) => (
                <Fila key={x.producto.id + x.talle} a={`${x.producto.nombre} ${x.producto.color} T${x.talle}`} b={`Quedan ${x.cantidad}`} rojo />
              )) : <p style={S.muted}>No hay alertas</p>}
            </Panel>

            <Panel title="Medios de pago de hoy">
              {MEDIOS.map((m) => (
                <Fila key={m} a={m} b={plata(resumen.porMedio[m] || 0)} />
              ))}
            </Panel>
          </section>
        </>
      )}

      {tab === "stock" && (
        <Panel title="Stock completo de mercadería">
          <div style={S.filters}>
            <input style={S.input} placeholder="Buscar por item, código, marca, color o talle..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            <select style={S.input} value={filtroTalle} onChange={(e) => setFiltroTalle(e.target.value)}>
              <option value="">Todos los talles</option>
              {TALLES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <label style={S.check}>
              <input type="checkbox" checked={soloDisponible} onChange={(e) => setSoloDisponible(e.target.checked)} />
              Solo disponible
            </label>
          </div>

          <div style={S.stockGrid}>
            {stockBusqueda.map((x) => (
              <div key={x.id + x.talle} style={S.stockCard}>
                {x.foto ? <img src={x.foto} style={S.img} alt="" /> : <div style={S.noImg}>SIN FOTO</div>}
                <h3>{x.nombre}</h3>
                <p style={S.muted}>{x.marca} · {x.color}</p>
                <p>Talle: <b>{x.talle}</b></p>
                <p>Stock: <b style={{ color: x.cantidad > 0 ? "#00e676" : "#ff5252" }}>{x.cantidad}</b></p>
                <p>Venta: <b>{plata(x.venta)}</b></p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === "productos" && (
        <section style={S.grid}>
          <Panel title="Cargar producto">
            <Input label="Código / barra" value={producto.codigo} setValue={(v) => setProducto({ ...producto, codigo: v })} />
            <Input label="Nombre / item" value={producto.nombre} setValue={(v) => setProducto({ ...producto, nombre: v })} />
            <Input label="Marca" value={producto.marca} setValue={(v) => setProducto({ ...producto, marca: v })} />
            <Input label="Categoría" value={producto.categoria} setValue={(v) => setProducto({ ...producto, categoria: v })} />
            <Input label="Color" value={producto.color} setValue={(v) => setProducto({ ...producto, color: v })} />
            <Input label="Costo" type="number" value={producto.costo} setValue={(v) => setProducto({ ...producto, costo: v })} />
            <Input label="Precio venta" type="number" value={producto.venta} setValue={(v) => setProducto({ ...producto, venta: v })} />
            <Input label="Stock mínimo por talle" type="number" value={producto.stockMinimo} setValue={(v) => setProducto({ ...producto, stockMinimo: v })} />

            <label style={S.label}>Foto</label>
            <input type="file" accept="image/*" onChange={cargarFoto} />
            {producto.foto && <img src={producto.foto} style={S.preview} alt="" />}

            <h3>Stock inicial</h3>
            <div style={S.talles}>
              {TALLES.map((t) => (
                <label key={t}>
                  {t}
                  <input style={S.talleInput} type="number" value={producto.stock[t]} onChange={(e) =>
                    setProducto({ ...producto, stock: { ...producto.stock, [t]: Number(e.target.value || 0) } })
                  } />
                </label>
              ))}
            </div>

            <button style={S.btn} onClick={guardarProducto}>Guardar producto</button>
          </Panel>

          <Panel title="Items cargados">
            {productos.map((p) => {
              const unidades = TALLES.reduce((a, t) => a + Number(p.stock?.[t] || 0), 0);
              return <Fila key={p.id} a={`${p.nombre} ${p.color}`} b={`${unidades} u. · ${plata(p.venta)}`} />;
            })}
          </Panel>
        </section>
      )}

      {tab === "ventas" && (
        <section style={S.grid}>
          <Panel title="Registrar venta">
            <Select label="Producto" value={venta.productoId} setValue={(v) => setVenta({ ...venta, productoId: v })}
              options={[["", "Elegir producto"], ...productos.map((p) => [p.id, `${p.nombre} ${p.color} - ${plata(p.venta)}`])]} />
            <Select label="Talle" value={venta.talle} setValue={(v) => setVenta({ ...venta, talle: v })} options={TALLES.map((t) => [t, t])} />
            <Input label="Cantidad" type="number" value={venta.cantidad} setValue={(v) => setVenta({ ...venta, cantidad: v })} />
            <Input label="Descuento" type="number" value={venta.descuento} setValue={(v) => setVenta({ ...venta, descuento: v })} />
            <Select label="Medio de pago" value={venta.medio} setValue={(v) => setVenta({ ...venta, medio: v })} options={MEDIOS.map((m) => [m, m])} />
            <button style={S.btn} onClick={registrarVenta}>Registrar venta</button>
          </Panel>

          <Panel title="Ventas del día">
            {ventasHoy.map((v) => (
              <Fila key={v.id} a={`${v.hora} · ${v.nombre} ${v.color} T${v.talle} x${v.cantidad}`} b={`${plata(v.total)} · gana ${plata(v.total - v.costoTotal)}`} />
            ))}
          </Panel>
        </section>
      )}

      {tab === "caja" && (
        <section style={S.grid}>
          <Panel title="Caja diaria">
            <Fila a="Caja ventas" b={plata(resumen.cajaVentas)} />
            <Fila a="Efectivo sistema" b={plata(resumen.efectivoSistema)} />
            <Fila a="Separar costo" b={plata(resumen.costo)} amarillo />
            <Fila a="Gastos" b={plata(resumen.totalGastos)} rojo />
            <Fila a="Ganancia neta" b={plata(resumen.neto)} />

            <Input label="Apertura de caja / efectivo inicial" type="number" value={caja.apertura} setValue={(v) => setCaja({ ...caja, apertura: v })} />
            <Input label="Efectivo real contado al cierre" type="number" value={caja.efectivoReal} setValue={(v) => setCaja({ ...caja, efectivoReal: v })} />
            <Input label="Observación" value={caja.observacion} setValue={(v) => setCaja({ ...caja, observacion: v })} />
            <button style={S.btn} onClick={cerrarCaja}>Cerrar caja</button>
          </Panel>

          <Panel title="Historial de cierres">
            {cajas.map((c) => (
              <Fila key={c.id} a={`${c.fecha} ${c.hora} · Real ${plata(c.efectivoReal)}`} b={`Dif. ${plata(c.diferencia)}`} rojo={c.diferencia !== 0} />
            ))}
          </Panel>
        </section>
      )}

      {tab === "gastos" && (
        <section style={S.grid}>
          <Panel title="Cargar gasto / retiro">
            <Input label="Concepto" value={gasto.concepto} setValue={(v) => setGasto({ ...gasto, concepto: v })} />
            <Input label="Categoría" value={gasto.categoria} setValue={(v) => setGasto({ ...gasto, categoria: v })} />
            <Input label="Monto" type="number" value={gasto.monto} setValue={(v) => setGasto({ ...gasto, monto: v })} />
            <Select label="Medio" value={gasto.medio} setValue={(v) => setGasto({ ...gasto, medio: v })} options={MEDIOS.map((m) => [m, m])} />
            <button style={S.btn} onClick={guardarGasto}>Guardar gasto</button>
          </Panel>

          <Panel title="Gastos de hoy">
            {gastosHoy.map((g) => <Fila key={g.id} a={`${g.hora} · ${g.concepto}`} b={plata(g.monto)} rojo />)}
          </Panel>
        </section>
      )}

      {tab === "movimientos" && (
        <Panel title="Auditoría de movimientos">
          {movimientos.map((m) => <Fila key={m.id} a={`${m.fecha} ${m.hora} · ${m.tipo}`} b={m.detalle} />)}
        </Panel>
      )}
    </main>
  );
}

function Card({ t, v, verde, amarillo }) {
  return <div style={S.card}><p>{t}</p><h2 style={{ color: verde ? "#00e676" : amarillo ? "#ffd740" : "white" }}>{v}</h2></div>;
}

function Panel({ title, children }) {
  return <div style={S.panel}><h2>{title}</h2>{children}</div>;
}

function Fila({ a, b, rojo, amarillo }) {
  return <div style={S.fila}><span>{a}</span><b style={{ color: rojo ? "#ff5252" : amarillo ? "#ffd740" : "white" }}>{b}</b></div>;
}

function Input({ label, value, setValue, type = "text" }) {
  return <><label style={S.label}>{label}</label><input style={S.input} type={type} value={value} onChange={(e) => setValue(e.target.value)} /></>;
}

function Select({ label, value, setValue, options }) {
  return <><label style={S.label}>{label}</label><select style={S.input} value={value} onChange={(e) => setValue(e.target.value)}>{options.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select></>;
}

const S = {
  page: { background: "#070707", color: "white", minHeight: "100vh", padding: 24, fontFamily: "Arial" },
  header: { marginBottom: 25 },
  h1: { fontSize: 42, margin: 0, fontWeight: 900 },
  sub: { color: "#999" },
  save: { color: "#00e676", fontWeight: 700 },
  nav: { display: "flex", gap: 10, marginBottom: 25, flexWrap: "wrap" },
  tab: { background: "#151515", border: "1px solid #333", color: "white", borderRadius: 12, padding: "12px 18px", cursor: "pointer" },
  tabA: { background: "white", color: "black", borderRadius: 12, padding: "12px 18px", cursor: "pointer", fontWeight: 700 },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 15, marginBottom: 20 },
  card: { background: "#131313", padding: 20, borderRadius: 18, border: "1px solid #2a2a2a" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 },
  panel: { background: "#131313", padding: 20, borderRadius: 20, border: "1px solid #2a2a2a", marginBottom: 20 },
  label: { display: "block", marginBottom: 5, marginTop: 10, color: "#aaa" },
  input: { width: "100%", padding: 12, background: "#090909", border: "1px solid #333", borderRadius: 12, color: "white", boxSizing: "border-box" },
  btn: { width: "100%", padding: 15, background: "#00c853", border: 0, borderRadius: 14, color: "white", marginTop: 20, fontWeight: 700, cursor: "pointer" },
  fila: { display: "flex", justifyContent: "space-between", gap: 10, padding: 12, background: "#090909", borderRadius: 12, marginBottom: 8 },
  talles: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(70px,1fr))", gap: 10, marginTop: 20 },
  talleInput: { width: "100%", padding: 8, background: "#090909", border: "1px solid #333", borderRadius: 10, color: "white" },
  filters: { display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, marginBottom: 15 },
  check: { display: "flex", gap: 8, alignItems: "center", background: "#090909", padding: 12, borderRadius: 12, border: "1px solid #333" },
  stockGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 },
  stockCard: { background: "#090909", border: "1px solid #333", borderRadius: 16, padding: 12 },
  img: { width: "100%", height: 140, objectFit: "cover", borderRadius: 12 },
  noImg: { height: 140, background: "#222", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "#777" },
  preview: { width: 150, height: 150, objectFit: "cover", borderRadius: 14, marginTop: 10 },
  muted: { color: "#888" },
};