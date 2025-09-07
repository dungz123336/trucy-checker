\
  import React, { useEffect, useMemo, useRef, useState } from "react";

  // --- helpers ---
  const fmt = (n?: number, d = 4) => (n == null || isNaN(n as any) ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));

  async function getJSON(url: string, { timeoutMs = 8000 } = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(id);
    }
  }

  async function searchDex(q: string) {
    const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`;
    const data = await getJSON(url);
    return data?.pairs ?? [];
  }

  function normalizePair(p: any) {
    if (!p) return null as any;
    return {
      chain: (p.chainId || p.chain || "").toLowerCase(),
      dexId: p.dexId,
      url: p.url,
      pairAddress: p.pairAddress || p.pair?.address,
      baseToken: p.baseToken?.symbol,
      baseAddress: p.baseToken?.address,
      quoteToken: p.quoteToken?.symbol,
      priceUsd: Number(p.priceUsd ?? p.price?.usd ?? NaN),
      liquidityUsd: p.liquidity?.usd ?? null,
      fdv: p.fdv ?? null,
      priceChange: p.priceChange,
    };
  }

  async function fetchCandles({ chain, pairAddress, tf = "15m", limit = 200 }: { chain: string; pairAddress: string; tf?: string; limit?: number }) {
    const url = `https://api.dexscreener.com/latest/dex/candles/${tf}/${chain}/${pairAddress}?limit=${limit}`;
    const data = await getJSON(url);
    const cs = data?.candles || data?.data || [];
    return cs.map((c: any) => ({
      t: c.t || c.timestamp,
      o: Number(c.o ?? c.open),
      h: Number(c.h ?? c.high),
      l: Number(c.l ?? c.low),
      c: Number(c.c ?? c.close),
      v: Number((c.v ?? c.volume) || 0),
    }));
  }

  function ema(vals: number[], period: number) {
    const k = 2 / (period + 1);
    const out: number[] = [];
    let prev: number | undefined;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      prev = i === 0 ? v : v * k + (prev as number) * (1 - k);
      out.push(prev);
    }
    return out;
  }
  function atr(c: any[], period = 14) {
    if (c.length < 2) return 0;
    const trs: number[] = [];
    let prevClose = c[0].c;
    for (let i = 1; i < c.length; i++) {
      const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - prevClose), Math.abs(c[i].l - prevClose));
      trs.push(tr);
      prevClose = c[i].c;
    }
    const e = ema(trs, period);
    return e[e.length - 1] || 0;
  }
  function computeSignal(c: any[]) {
    if (c.length < 50) return { signal: "NEUTRAL", entry: null, levels: null } as any;
    const closes = c.map((x: any) => x.c);
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const last = closes[closes.length - 1];
    const m20 = e20[e20.length - 1];
    const m20p = e20[e20.length - 4] ?? e20[0];
    const m50 = e50[e50.length - 1];
    const slope = m20 - m20p;
    let signal: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
    if (m20 > m50 && slope > 0 && last > m20) signal = "LONG";
    else if (m20 < m50 && slope < 0 && last < m20) signal = "SHORT";
    const a = atr(c, 14);
    const entry = last;
    const levels = signal === "LONG"
      ? { sl: entry - 1.5 * a, tps: [entry + 1 * a, entry + 2 * a, entry + 3 * a] }
      : signal === "SHORT"
        ? { sl: entry + 1.5 * a, tps: [entry - 1 * a, entry - 2 * a, entry - 3 * a] }
        : null;
    return { signal, entry, atr: a, ema20: m20, ema50: m50, levels };
  }

  async function fetchTrending() {
    const d = await getJSON("https://api.coingecko.com/api/v3/search/trending");
    return (d?.coins ?? []).map((x: any) => ({
      id: x.item.id, name: x.item.name, symbol: x.item.symbol, rank: x.item.market_cap_rank, thumb: x.item.thumb
    }));
  }

  export default function App() {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [best, setBest] = useState<any>(null);
    const [pairs, setPairs] = useState<any[]>([]);
    const [trend, setTrend] = useState<any[]>([]);
    const [idea, setIdea] = useState<any>(null);
    const [taLoading, setTaLoading] = useState(false);
    const deb = useRef<any>(null);

    useEffect(() => { fetchTrending().then(setTrend).catch(()=>{}); }, []);

    function debounceSearch(v: string) {
      setQuery(v);
      if (deb.current) clearTimeout(deb.current);
      deb.current = setTimeout(() => { if (v.trim()) handleSearch(v); }, 500);
    }

    async function handleSearch(qOpt?: string) {
      const q = (qOpt ?? query).trim();
      if (!q) return;
      setLoading(true); setError(""); setBest(null); setPairs([]); setIdea(null);
      try {
        const found = await searchDex(q);
        if (!found?.length) { setError("Không tìm thấy pair phù hợp."); return; }
        const sorted = [...found].sort((a:any,b:any)=> (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0));
        const top = normalizePair(sorted[0]);
        setBest(top);
        setPairs(sorted.slice(0,8).map(normalizePair));

        setTaLoading(true);
        const candles = await fetchCandles({ chain: top.chain, pairAddress: top.pairAddress, tf: "15m", limit: 200 });
        setIdea(computeSignal(candles));
      } catch(e:any) {
        setError(e.message || "Lỗi không xác định");
      } finally { setTaLoading(false); setLoading(false); }
    }

    const riskFlags = useMemo(()=>{
      if (!best) return [] as string[];
      const out: string[] = [];
      if ((best.liquidityUsd ?? 0) < 50000) out.push("Thanh khoản mỏng (<$50k)");
      const h24 = Math.abs(best?.priceChange?.h24 ?? 0);
      if (!best.priceChange || h24 > 80) out.push("Biến động mạnh (>80%/24h)");
      if ((best.fdv ?? 0) < 200000) out.push("FDV thấp (<$200k)");
      return out;
    }, [best]);

    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
        <header className="sticky top-0 z-20 backdrop-blur border-b border-white/5 bg-slate-900/60">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-white/10 grid place-items-center font-bold">TC</div>
              <div>
                <h1 className="text-lg font-semibold">TruCy Checker</h1>
                <p className="text-xs text-slate-400">Dán tên token / symbol / contract → phân tích nhanh.</p>
              </div>
            </div>
            <a href="#trending" className="text-xs text-slate-400 hover:text-slate-200">Xu hướng</a>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-6 space-y-8">
          <section className="bg-white/5 rounded-2xl p-4 shadow-lg ring-1 ring-white/10">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <input
                className="flex-1 bg-white/5 rounded-xl px-4 py-3 outline-none ring-1 ring-white/10 focus:ring-white/20 placeholder:text-slate-400"
                placeholder="Ví dụ: somnia, pepe, 0x..."
                value={query}
                onChange={(e) => debounceSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <button
                onClick={() => handleSearch()}
                className="px-5 py-3 rounded-xl bg-emerald-500/90 hover:bg-emerald-400 text-slate-950 font-semibold"
                disabled={loading}
              >{loading ? "Đang tìm..." : "Phân tích"}</button>
            </div>
            <p className="mt-2 text-xs text-slate-400">Tip: Dán contract address để chính xác nhất.</p>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white/5 rounded-2xl p-5 ring-1 ring-white/10">
                <h2 className="text-base font-semibold">Kết quả</h2>
                {!best && !loading && !error && (<p className="text-sm text-slate-400 mt-2">Nhập từ khoá phía trên để bắt đầu.</p>)}
                {error && <p className="mt-2 text-rose-300 text-sm">{error}</p>}
                {best && (
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
                    <Stat label="Symbol" value={best.baseToken} />
                    <Stat label="Chain" value={best.chain?.toUpperCase()} />
                    <Stat label="DEX" value={best.dexId} />
                    <Stat label="Giá (USD)" value={fmt(best.priceUsd)} />
                    <Stat label="FDV" value={fmt(best.fdv)} />
                    <Stat label="Thanh khoản" value={fmt(best.liquidityUsd)} />
                  </div>
                )}
              </div>

              {best && (
                <div className="bg-white/5 rounded-2xl p-5 ring-1 ring-white/10">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">Gợi ý giao dịch (alpha) – 15m</h3>
                    {taLoading && <span className="text-xs text-slate-400">Đang tính toán…</span>}
                  </div>
                  {idea && (
                    <div className="grid md:grid-cols-3 gap-3 items-start text-sm">
                      <div className="md:col-span-1">
                        <div className={`inline-flex items-center px-2 py-1 rounded-lg text-slate-900 font-semibold ${idea.signal==='LONG'?'bg-emerald-400':idea.signal==='SHORT'?'bg-rose-400':'bg-slate-400'}`}>{idea.signal}</div>
                        <div className="mt-2 text-xs text-slate-400">EMA20: {fmt(idea.ema20)} · EMA50: {fmt(idea.ema50)} · ATR14: {fmt(idea.atr)}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-xs">Entry (gần nhất)</div>
                        <div className="font-semibold">{fmt(idea.entry,6)}</div>
                        {idea.levels && (<div className="mt-2 space-y-1"><div className="text-slate-400 text-xs">SL</div><div className="font-semibold">{fmt(idea.levels.sl,6)}</div></div>)}
                      </div>
                      <div>
                        <div className="text-slate-400 text-xs">TP (1x/2x/3x ATR)</div>
                        {idea.levels ? (
                          <ul className="space-y-1">{idea.levels.tps.map((t:number,i:number)=>(<li key={i} className="font-semibold">TP{i+1}: {fmt(t,6)}</li>))}</ul>
                        ) : (<div className="text-xs text-slate-400">Trung lập – chưa gợi ý TP/SL</div>)}
                      </div>
                    </div>
                  )}
                  {!idea && !taLoading && <div className="text-xs text-slate-400">Chưa có dữ liệu để gợi ý.</div>}
                  <p className="mt-3 text-[11px] text-slate-500">* Heuristic đơn giản: EMA20/EMA50 + độ dốc EMA20 + ATR14 (15m). Không phải khuyến nghị đầu tư.</p>
                </div>
              )}

              {best && (
                <div className="bg-white/5 rounded-2xl p-5 ring-1 ring-white/10">
                  <h3 className="text-sm font-semibold mb-3">Cờ rủi ro nhanh</h3>
                  {riskFlags.length ? (
                    <ul className="text-sm list-disc pl-5 space-y-1 text-amber-200">{riskFlags.map((f,i)=>(<li key={i}>{f}</li>))}</ul>
                  ) : (
                    <p className="text-sm text-slate-400">Chưa phát hiện rủi ro cơ bản.</p>
                  )}
                </div>
              )}

              {pairs?.length > 0 && (
                <div className="bg-white/5 rounded-2xl p-5 ring-1 ring-white/10">
                  <h3 className="text-sm font-semibold mb-3">Cặp giao dịch liên quan</h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {pairs.map((p:any, idx:number) => (
                      <div key={idx} className="rounded-xl p-4 bg-black/20 ring-1 ring-white/10">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold">{p.baseToken} / {p.quoteToken}</div>
                            <div className="text-xs text-slate-400">{p.chain?.toUpperCase()} · {p.dexId}</div>
                          </div>
                          <a className="text-xs underline text-emerald-300" href={p.url} target="_blank" rel="noreferrer">Dexscreener</a>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                          <Stat small label="Giá" value={fmt(p.priceUsd)} />
                          <Stat small label="FDV" value={fmt(p.fdv)} />
                          <Stat small label="TVL" value={fmt(p.liquidityUsd)} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <aside className="space-y-4" id="trending">
              <div className="bg-white/5 rounded-2xl p-5 ring-1 ring-white/10">
                <h3 className="text-sm font-semibold">Xu hướng (Coingecko)</h3>
                {!trend.length ? <p className="text-xs text-slate-400 mt-2">Đang tải xu hướng…</p> : (
                  <ul className="mt-3 space-y-2">
                    {trend.map((t:any)=>(
                      <li key={t.id} className="flex items-center gap-3">
                        <img src={t.thumb} alt={t.name} className="w-6 h-6 rounded-full"/>
                        <div className="flex-1">
                          <div className="text-sm font-medium">{t.name} <span className="text-slate-400">· {t.symbol.toUpperCase()}</span></div>
                          <div className="text-xs text-slate-500">Rank #{t.rank ?? "—"}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          </section>
        </main>

        <footer className="max-w-6xl mx-auto px-4 py-10 text-center text-xs text-slate-500">
          Built for Dũng · TruCy Checker (lite) v0.1
        </footer>
      </div>
    );
  }

  function Stat({ label, value, small }: { label: string; value: any; small?: boolean }) {
    return (
      <div className={"rounded-xl bg-black/20 ring-1 ring-white/10 " + (small ? "p-2" : "p-3") }>
        <div className={"text-slate-400 " + (small ? "text-[11px]" : "text-xs")}>{label}</div>
        <div className={small ? "text-sm font-semibold" : "text-base font-semibold"}>{value ?? "—"}</div>
      </div>
    );
  }
