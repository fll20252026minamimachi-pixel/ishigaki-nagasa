import React, { useEffect, useMemo, useRef, useState } from "react";

// ===== Types =====
type Pt = { x: number; y: number };

type Measurement = {
  a: Pt;
  b: Pt;
  pixel: number;
  real: number | null;
  unit: "mm" | "cm" | "m" | null;
};

export default function App() {
  // 画像／表示
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [widthPct, setWidthPct] = useState(70);

  // 線トレース & 勾配
  const [points, setPoints] = useState<Pt[]>([]);
  const [mode, setMode] = useState<"fit" | "endpoints">("fit");
  const [metricsOpen, setMetricsOpen] = useState(true);

  // 参照
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 校正／測長
  const [scalePerPx, setScalePerPx] = useState<number | null>(null);
  const [scaleUnit, setScaleUnit] = useState<"mm" | "cm" | "m" | null>(null);
  const [history, setHistory] = useState<Measurement[]>([]);
  const [status, setStatus] = useState<string>("");

  // 従来方式（先入力）
  const [inputVal, setInputVal] = useState<string>("");
  const [inputUnit, setInputUnit] = useState<"mm" | "cm" | "m">("cm");

  // ツール
  const [tool, setTool] = useState<"trace" | "calib" | "measure">("trace");
  const [armed, setArmed] = useState<"none" | "calib" | "measure">("none");

  // 可視化（クリック直後に点線を出す）
  const [pendingCalib, setPendingCalib] = useState<{ a: Pt; b: Pt } | null>(null);
  const [pendingMeasure, setPendingMeasure] = useState<{ a: Pt; b: Pt } | null>(null);
  const [lastCalibPx, setLastCalibPx] = useState<number | null>(null);
  const [lastMeasurePx, setLastMeasurePx] = useState<number | null>(null);
  const [calibLengthInput, setCalibLengthInput] = useState<string>("");
  const [calibLengthUnit, setCalibLengthUnit] = useState<"mm" | "cm" | "m">("cm");
  const [lengthInput, setLengthInput] = useState<string>("");
  const [lengthUnit, setLengthUnit] = useState<"mm" | "cm" | "m">("cm");

  // ヘルプ
  const [showHelp, setShowHelp] = useState(false);

  // 画像の実寸取得
  useEffect(() => {
    if (!imgSrc) return;
    const im = new Image();
    im.onload = () => setNat({ w: im.naturalWidth, h: im.naturalHeight });
    im.src = imgSrc;
  }, [imgSrc]);

  // キーボード
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "c") setArmed("calib");
      if (k === "m") setArmed("measure");
      if (k === "escape") setArmed("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // スケール（表示倍率）
  const scale = useMemo(() => {
    if (!imgRef.current || !nat) return 1;
    const dispW = imgRef.current.clientWidth || nat.w;
    return dispW / nat.w;
  }, [imgSrc, nat, widthPct]);

  // util
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  function fit(pts: Pt[]) {
    const n = pts.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
    const d = n * sxx - sx * sx;
    if (d === 0) return { a: 0, b: pts[0]?.y ?? 0 };
    const a = (n * sxy - sx * sy) / d;
    const b = (sy - a * sx) / n;
    return { a, b };
  }

  // メトリクス
  const metrics = useMemo(() => {
    if (points.length < 2) return null;
    let slope: number;
    if (mode === "fit") {
      slope = fit(points).a;
    } else {
      const p1 = points[0], p2 = points[points.length - 1];
      slope = (p2.y - p1.y) / ((p2.x - p1.x) || 1e-9);
    }
    const angleRad = -Math.atan(slope);
    const angleDeg = (angleRad * 180) / Math.PI;
    const grade = Math.tan(angleRad) * 100;
    const ratio = 1 / Math.abs(Math.tan(angleRad));

    const segAngles: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i], p2 = points[i + 1];
      const s = (p2.y - p1.y) / ((p2.x - p1.x) || 1e-9);
      segAngles.push((-Math.atan(s) * 180) / Math.PI);
    }
    const minSeg = Math.min(...segAngles);
    const maxSeg = Math.max(...segAngles);
    const diffSeg = maxSeg - minSeg;
    const maxAbsAngle = segAngles.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), segAngles[0]);
    const maxAbsGrade = Math.abs(Math.tan((maxAbsAngle * Math.PI) / 180) * 100);

    return { angleDeg, grade, ratio, minSeg, maxSeg, diffSeg, maxAbsAngle, maxAbsGrade };
  }, [points, mode]);

  // 画像読み込み
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setImgSrc(reader.result as string);
    reader.readAsDataURL(f);
    // リセット
    setPoints([]);
    setScalePerPx(null);
    setScaleUnit(null);
    setHistory([]);
    setStatus("");
    setPendingCalib(null);
    setPendingMeasure(null);
    setLastCalibPx(null);
    setLastMeasurePx(null);
    setCalibLengthInput("");
    setLengthInput("");
  }

  // クリック
  function onOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!imgRef.current || !nat) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    const wantCalib = tool === "calib" || e.altKey || armed === "calib";
    const wantMeasure = tool === "measure" || e.shiftKey || armed === "measure";

    if (wantCalib) {
      setPendingCalib((prev) => {
        if (!prev) return { a: { x, y }, b: { x, y } };
        const next = { a: prev.a, b: { x, y } };
        const px = dist(next.a, next.b);
        setLastCalibPx(px);
        setStatus(`校正対象の範囲: ${px.toFixed(2)} px → 実長を入力して「この長さで校正」`);
        setArmed("none");
        return next;
      });
      return;
    }

    if (wantMeasure) {
      setPendingMeasure((prev) => {
        if (!prev) return { a: { x, y }, b: { x, y } };
        const next = { a: prev.a, b: { x, y } };
        const px = dist(next.a, next.b);
        setLastMeasurePx(px);
        if (scalePerPx != null && scaleUnit) {
          const real = px * scalePerPx;
          setStatus(`長さ: ${px.toFixed(2)} px / 実長(概算): ${real.toFixed(2)} ${scaleUnit}`);
        } else {
          setStatus(`長さ: ${px.toFixed(2)} px`);
        }
        setArmed("none");
        return next;
      });
      return;
    }

    setPoints((prev) => [...prev, { x, y }]);
  }

  return (
    <div style={{ padding: "8px" }}>
      {/* ===== Help Modal（画像未選択でも開ける） ===== */}
      {showHelp && (
        <div role="dialog" aria-modal="true" aria-labelledby="help-title"
             style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'grid', placeItems:'center', zIndex:9999}}
             onClick={()=>setShowHelp(false)}>
          <div style={{width:'min(860px, 92vw)', maxHeight:'88vh', overflow:'auto', background:'#fff', borderRadius:12, padding:16, boxShadow:'0 10px 40px rgba(0,0,0,0.25)'}}
               onClick={(e)=>e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
              <h2 id="help-title" style={{fontSize:18, fontWeight:700}}>使い方ガイド</h2>
              <button className="badge" onClick={()=>setShowHelp(false)} aria-label="閉じる">閉じる</button>
            </div>
            <div style={{fontSize:14, lineHeight:1.7}}>
              <ol style={{paddingLeft:18}}>
                <li><b>画像を選択</b>：上部の「画像を選択」から jpg/png/webp を読み込みます。</li>
                <li><b>表示サイズ</b>：スライダーで画像の幅（30%〜150%）を調整します。</li>
                <li><b>線トレース</b>：点をクリックで追加（緑）。モード切替で角度算出方法を変更。</li>
                <li><b>尺度合わせ</b>：青の2点をクリック後に実長入力で校正、または先に実長入力→2点クリックでも可。</li>
                <li><b>長さ計測</b>：オレンジの2点クリック。実長入力で校正・記録が可能。</li>
              </ol>
              <div style={{marginTop:8}}>
                <b>ショートカット</b>：C（尺度） / M（長さ） / Esc（解除） / Alt×2（尺度） / Shift×2（長さ）
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
  html,body,#root{background:#ffffff!important;}
  .container,.card{background:#ffffff!important;}
  .toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
  /* 読みやすさ向上: バッジの背景と境界を強化 */
  .badge{background:#ffffff;color:#111;border:1px solid #888;border-radius:10px;padding:6px 10px;box-shadow:0 2px 8px rgba(0,0,0,.15)}
  .badge input,.badge select{margin-left:4px}
  /* 画像上のパネルを強コントラストに */
  .floating-panel{background:#ffffff;border:1px solid #000;border-radius:12px;padding:10px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
  .status-badge{background:#eef6ff;border:1px solid #7bb3ff;color:#012;padding:6px 10px;border-radius:10px}
`}</style>

      <div className="container">
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="toolbar">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {/* 画像選択 */}
              <label className="badge" htmlFor="filePicker" role="button" aria-label="画像を選択" style={{ cursor: "pointer" }}>
                画像を選択
              </label>
              <input
                id="filePicker"
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp,image/*"
                onChange={onFile}
                style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
              />

              {/* 既定の校正値（従来方式） */}
              <label className="badge">
                実長(mm/cm/m):
                <input type="number" value={inputVal} onChange={(e)=>setInputVal(e.target.value)} style={{ width: 70, marginLeft: 4 }} />
                <select value={inputUnit} onChange={(e)=>setInputUnit(e.target.value as any)} style={{ marginLeft: 4 }}>
                  <option value="mm">mm</option>
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                </select>
              </label>

              {/* 新方式：尺度合わせ（クリック後に決定） */}
              {pendingCalib && lastCalibPx != null && (
                <label className="badge" title="この範囲の実長を入力して校正" style={{ display:'flex', alignItems:'center', gap: 8 }}>
                  校正範囲: {lastCalibPx.toFixed(2)} px → 実長
                  <input type="number" value={calibLengthInput} onChange={(e)=>setCalibLengthInput(e.target.value)} placeholder="数値" style={{ width: 80 }} />
                  <select value={calibLengthUnit} onChange={(e)=>setCalibLengthUnit(e.target.value as any)}>
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                  </select>
                  <button className="badge" onClick={()=>{
                    const v = Number(calibLengthInput);
                    if (!isFinite(v) || v <= 0) { setStatus("実長は正の数で入力してください"); return; }
                    const perPx = v / lastCalibPx!;
                    setScalePerPx(perPx); setScaleUnit(calibLengthUnit);
                    setStatus(`校正完了: 1px ≈ ${perPx.toFixed(4)} ${calibLengthUnit}`);
                    setPendingCalib(null); setLastCalibPx(null); setCalibLengthInput("");
                  }}>この長さで校正</button>
                  <button className="badge" onClick={()=>{ setPendingCalib(null); setLastCalibPx(null); setCalibLengthInput(""); setStatus(""); }}>クリア</button>
                </label>
              )}

              {/* 測長：後から実長指定 */}
              {pendingMeasure && lastMeasurePx != null && (
                <label className="badge" title="この区間の実長を入力して適用" style={{ display:'flex', alignItems:'center', gap: 8 }}>
                  この区間: {lastMeasurePx.toFixed(2)} px → 実長
                  <input type="number" value={lengthInput} onChange={(e)=>setLengthInput(e.target.value)} placeholder="数値" style={{ width: 80 }} />
                  <select value={lengthUnit} onChange={(e)=>setLengthUnit(e.target.value as any)}>
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                  </select>
                  <button className="badge" onClick={()=>{
                    const v = Number(lengthInput);
                    if (!isFinite(v) || v <= 0) { setStatus("実長は正の数で入力してください"); return; }
                    const perPx = v / lastMeasurePx!;
                    setScalePerPx(perPx); setScaleUnit(lengthUnit);
                    setStatus(`校正完了: 1px ≈ ${perPx.toFixed(4)} ${lengthUnit}`);
                  }}>この長さで校正</button>
                  <button className="badge" onClick={()=>{
                    const rec: Measurement = {
                      a: pendingMeasure!.a,
                      b: pendingMeasure!.b,
                      pixel: lastMeasurePx!,
                      real: scalePerPx ? lastMeasurePx! * scalePerPx : (Number(lengthInput) || null),
                      unit: scalePerPx ? scaleUnit : (lengthInput ? lengthUnit : null),
                    };
                    setHistory((h)=>[rec, ...h].slice(0,50));
                    setStatus(`記録: ${rec.pixel.toFixed(2)} px` + (rec.real ? ` / ${rec.real.toFixed(2)} ${rec.unit}` : ""));
                    setPendingMeasure(null); setLastMeasurePx(null); setLengthInput("");
                  }}>記録</button>
                  <button className="badge" onClick={()=>{ setPendingMeasure(null); setLastMeasurePx(null); setLengthInput(""); setStatus(""); }}>クリア</button>
                </label>
              )}

              {/* 表示サイズ */}
              <label className="badge" title="表示サイズ">
                表示サイズ
                <input type="range" min={30} max={150} step={1} value={widthPct} onChange={(e)=>setWidthPct(parseInt(e.target.value))} style={{ marginLeft: 8 }} />
                <span style={{ marginLeft: 6 }}>{widthPct}%</span>
              </label>

              {/* 既存動作 */}
              <button className="badge" onClick={()=>setMode(m => m === 'fit' ? 'endpoints' : 'fit')}>
                モード: {mode === 'fit' ? '最小二乗' : '始点-終点'}
              </button>
              <button className="badge" onClick={()=>setPoints([])}>リセット</button>
              <button className="badge" onClick={()=>setMetricsOpen(v => !v)}>{metricsOpen ? '結果を隠す' : '結果を表示'}</button>
              <button className="badge" onClick={()=>setShowHelp(true)}>使い方</button>

              {/* ツール切替 */}
              <button className="badge" aria-pressed={tool==='trace'}
                style={tool==='trace'?{ outline:'2px solid #22c55e', background:'#eafff1'}:undefined}
                onClick={()=>{ setTool('trace'); setStatus('線トレースモード'); }}>線トレース</button>
              <button className="badge" aria-pressed={tool==='calib'}
                style={tool==='calib'?{ outline:'2px solid #22c55e', background:'#eafff1'}:undefined}
                onClick={()=>{ setTool('calib'); setArmed('none'); setStatus('尺度合わせ: 画像上を2回クリック'); }}>尺度合わせ</button>
              <button className="badge" aria-pressed={tool==='measure'}
                style={tool==='measure'?{ outline:'2px solid #22c55e', background:'#eafff1'}:undefined}
                onClick={()=>{ setTool('measure'); setArmed('none'); setStatus('長さ計測: 画像上を2回クリック'); }}>長さ計測</button>

              {/* ステータスとスケール表示 */}
              {scalePerPx != null && scaleUnit && (
                <span className="badge" title="現在のスケール">1px ≈ {scalePerPx.toFixed(3)} {scaleUnit}</span>
              )}
              {status && (<span className="status-badge">{status}</span>)}
            </div>
          </div>
        </div>

        {/* 画像カード */}
        <div className="card" style={{ position: 'relative', minHeight: 320 }}>
          {!imgSrc ? (
            <div style={{ height: 300, display:'grid', placeItems:'center', color:'#666' }}>画像を選択してください</div>
          ) : (
            <div style={{ position:'relative', display:'flex', justifyContent:'center' }}>
              <div style={{ position:'relative', width: `${widthPct}%` }}>
                <img ref={imgRef} src={imgSrc} alt="uploaded" style={{ width:'100%', userSelect:'none' }} />
                {nat && (
                  <div className="overlay" onClick={onOverlayClick} style={{ position:'absolute', inset:0, cursor:'crosshair' }}>
                    <svg width="100%" height="100%" style={{ position:'absolute', inset:0, pointerEvents:'none' }}>
                      {/* 線トレース（緑） */}
                      {points.map((p, i) => {
                        const cx = p.x * scale, cy = p.y * scale;
                        return (
                          <g key={`trace-${i}`}>
                            {i>0 && (
                              <line x1={points[i-1].x*scale} y1={points[i-1].y*scale} x2={cx} y2={cy} stroke="#22c55e" strokeWidth={2} />
                            )}
                            <circle cx={cx} cy={cy} r={3} fill="#22c55e" />
                          </g>
                        );
                      })}

                      {/* 尺度合わせ（青） */}
                      {pendingCalib && (
                        <g>
                          <line x1={pendingCalib.a.x*scale} y1={pendingCalib.a.y*scale} x2={pendingCalib.b.x*scale} y2={pendingCalib.b.y*scale} stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 3" />
                          <circle cx={pendingCalib.a.x*scale} cy={pendingCalib.a.y*scale} r={3.5} fill="#3b82f6" />
                          {(pendingCalib.a.x !== pendingCalib.b.x || pendingCalib.a.y !== pendingCalib.b.y) && (
                            <circle cx={pendingCalib.b.x*scale} cy={pendingCalib.b.y*scale} r={3.5} fill="#3b82f6" />
                          )}
                        </g>
                      )}

                      {/* 長さ計測（オレンジ） */}
                      {pendingMeasure && (
                        <g>
                          <line x1={pendingMeasure.a.x*scale} y1={pendingMeasure.a.y*scale} x2={pendingMeasure.b.x*scale} y2={pendingMeasure.b.y*scale} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 3" />
                          <circle cx={pendingMeasure.a.x*scale} cy={pendingMeasure.a.y*scale} r={3.5} fill="#f59e0b" />
                          {(pendingMeasure.a.x !== pendingMeasure.b.x || pendingMeasure.a.y !== pendingMeasure.b.y) && (
                            <circle cx={pendingMeasure.b.x*scale} cy={pendingMeasure.b.y*scale} r={3.5} fill="#f59e0b" />
                          )}
                        </g>
                      )}
                    </svg>
                  </div>
                )}

                {/* 計測結果カード */}
                {metrics && metricsOpen && (
                  <div className="floating-panel" style={{ position:'absolute', right:12, top:12, fontSize:14 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>計測結果</div>
                    <div>角度: {metrics.angleDeg.toFixed(2)}°</div>
                    <div>勾配: {metrics.grade.toFixed(2)}%</div>
                    <div>比: 1:{metrics.ratio.toFixed(2)}</div>
                    <div style={{ borderTop: '1px solid #eee', marginTop: 6, paddingTop: 6, color: '#666' }}>
                      最小角度: {metrics.minSeg.toFixed(2)}°<br/>
                      最大角度: {metrics.maxSeg.toFixed(2)}°<br/>
                      差: {metrics.diffSeg.toFixed(2)}°<br/>
                      最大勾配: {metrics.maxAbsAngle.toFixed(2)}° / {metrics.maxAbsGrade.toFixed(2)}%
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
