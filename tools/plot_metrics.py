# src/plot_metrics.py
import os
import math
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

IN_CSV = os.path.join("logs", "notarize_metrics.csv")
OUT_DIR = "plots"

# Columnas esperadas (si faltan, el script igual corre con las disponibles)
COLS = [
    "ts", "device_id", "op", "digest", "sha25610",
    "ms_total", "ms_iota", "lat_ttn_to_oracle_ms", "lat_end_to_end_ms",
    "gas_comp", "gas_storage", "gas_rebate", "gas_nonref",
    "cpu_user_ms", "cpu_system_ms",
    "rss_bytes", "heap_used_bytes",
]

def ensure_dir(p):
    os.makedirs(p, exist_ok=True)

def savefig(name):
    path = os.path.join(OUT_DIR, name)
    plt.tight_layout()
    plt.savefig(path, dpi=200)
    plt.close()
    print("✅", path)

def cdf_xy(x: np.ndarray):
    x = x[np.isfinite(x)]
    x = np.sort(x)
    if x.size == 0:
        return None, None
    y = np.arange(1, x.size + 1) / x.size
    return x, y

def maybe(df, col):
    return col in df.columns

def boxplot_by_group(df, value_col, group_col="device_id", op_col="op", title=None, fname="box.png"):
    # Boxplot por (device_id|op) para comparar nodo2 vs nodo-2 y create/update
    if not maybe(df, value_col):
        return
    d = df[[group_col, op_col, value_col]].dropna()
    if d.empty:
        return

    d["group"] = d[group_col].astype(str) + "|" + d[op_col].astype(str)
    groups = sorted(d["group"].unique())

    data = [d.loc[d["group"] == g, value_col].to_numpy() for g in groups]
    plt.figure()
    plt.boxplot(data, labels=groups, showfliers=True)
    plt.xticks(rotation=45, ha="right")
    plt.ylabel(value_col)
    plt.title(title or f"Boxplot {value_col} por device|op")
    savefig(fname)

def cdf_by_op(df, value_col, title=None, fname="cdf.png"):
    if not maybe(df, value_col):
        return
    d = df[["op", value_col]].dropna()
    if d.empty:
        return

    plt.figure()
    for op in sorted(d["op"].unique()):
        x = d.loc[d["op"] == op, value_col].to_numpy(dtype=float)
        xs, ys = cdf_xy(x)
        if xs is None:
            continue
        plt.plot(xs, ys, label=str(op))

    plt.xlabel(value_col)
    plt.ylabel("CDF")
    plt.title(title or f"CDF {value_col} (por op)")
    plt.legend()
    savefig(fname)

def timeseries(df, value_col, title=None, fname="ts.png"):
    if not maybe(df, value_col):
        return
    d = df[["ts", "device_id", "op", value_col]].dropna()
    if d.empty:
        return
    d = d.sort_values("ts")

    plt.figure()
    # serie simple: valor vs tiempo, separando por device_id
    for dev in sorted(d["device_id"].unique()):
        dd = d[d["device_id"] == dev]
        plt.plot(dd["ts"], dd[value_col], label=str(dev))

    plt.xlabel("ts")
    plt.ylabel(value_col)
    plt.title(title or f"Serie temporal {value_col} (por device)")
    plt.xticks(rotation=45, ha="right")
    plt.legend()
    savefig(fname)

def hist_by_op(df, value_col, title=None, fname="hist.png"):
    if not maybe(df, value_col):
        return
    d = df[["op", value_col]].dropna()
    if d.empty:
        return

    plt.figure()
    # hist overlay por op (matplotlib define colores por defecto)
    for op in sorted(d["op"].unique()):
        x = d.loc[d["op"] == op, value_col].to_numpy(dtype=float)
        plt.hist(x[np.isfinite(x)], bins=30, alpha=0.5, label=str(op))

    plt.xlabel(value_col)
    plt.ylabel("count")
    plt.title(title or f"Hist {value_col} (por op)")
    plt.legend()
    savefig(fname)

def main():
    if not os.path.exists(IN_CSV):
        raise SystemExit(f"No existe {IN_CSV}. Ejecuta primero el oracle para generar logs.")

    ensure_dir(OUT_DIR)

    df = pd.read_csv(IN_CSV)
    # Normalizaciones
    if "ts" in df.columns:
        df["ts"] = pd.to_datetime(df["ts"], errors="coerce")
    if "device_id" in df.columns:
        df["device_id"] = df["device_id"].astype(str).str.strip()
    if "op" in df.columns:
        df["op"] = df["op"].astype(str).str.strip()

    # Convierto numéricas si existen
    num_cols = [
        "ms_total", "ms_iota", "lat_ttn_to_oracle_ms", "lat_end_to_end_ms",
        "gas_comp", "gas_storage", "gas_rebate", "gas_nonref",
        "cpu_user_ms", "cpu_system_ms",
        "rss_bytes", "heap_used_bytes",
    ]
    for c in num_cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    # --- Gráficas clave para performance evaluation ---

    # 1) Latencias: CDF por operación
    cdf_by_op(df, "lat_end_to_end_ms",
              title="CDF lat_end_to_end_ms (TTN receive -> IOTA confirmed)",
              fname="cdf_lat_end_to_end_ms_by_op.png")

    cdf_by_op(df, "ms_iota",
              title="CDF ms_iota (solo tiempo de TX IOTA)",
              fname="cdf_ms_iota_by_op.png")

    # 2) Boxplots por device|op (para separar nodo2 vs nodo-2 + create/update)
    boxplot_by_group(df, "lat_end_to_end_ms",
                     title="Boxplot lat_end_to_end_ms por device|op",
                     fname="box_lat_end_to_end_ms_by_device_op.png")

    boxplot_by_group(df, "ms_iota",
                     title="Boxplot ms_iota por device|op",
                     fname="box_ms_iota_by_device_op.png")

    # 3) Histogramas por op
    hist_by_op(df, "lat_end_to_end_ms",
               title="Hist lat_end_to_end_ms por op",
               fname="hist_lat_end_to_end_ms_by_op.png")

    # 4) Gas (si existe)
    if "gas_comp" in df.columns:
        boxplot_by_group(df, "gas_comp",
                         title="Boxplot gas_comp por device|op",
                         fname="box_gas_comp_by_device_op.png")
    if "gas_storage" in df.columns:
        boxplot_by_group(df, "gas_storage",
                         title="Boxplot gas_storage por device|op",
                         fname="box_gas_storage_by_device_op.png")

    # 5) CPU / Memoria (si existe)
    if "cpu_user_ms" in df.columns:
        boxplot_by_group(df, "cpu_user_ms",
                         title="Boxplot cpu_user_ms por device|op",
                         fname="box_cpu_user_ms_by_device_op.png")

    if "rss_bytes" in df.columns:
        # pasa a MB para que sea legible
        df2 = df.copy()
        df2["rss_mb"] = df2["rss_bytes"] / (1024 * 1024)
        boxplot_by_group(df2, "rss_mb",
                         title="Boxplot RSS (MB) por device|op",
                         fname="box_rss_mb_by_device_op.png")

    # 6) Serie temporal (opcional, útil para ver drift / congestión)
    timeseries(df, "lat_end_to_end_ms",
               title="Serie temporal lat_end_to_end_ms (por device)",
               fname="ts_lat_end_to_end_ms_by_device.png")

    print("\n🎯 Listo. Revisa la carpeta plots/")

if __name__ == "__main__":
    main()