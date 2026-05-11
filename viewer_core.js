// Shared viewer/manager calculation and report rendering core.
// Keep side effects minimal so this can be reused from standalone viewer.html.
(function initArgAssistViewerCore(globalObj) {
  "use strict";

  function computeGlobalStats(gamesObj) {
    const games = Array.isArray(gamesObj) ? gamesObj : Object.values(gamesObj ?? {});
    let totalSec = 0;
    let clearCount = 0;
    let compCount = 0;

    for (const g of games) {
      const pt = String(g.playtimeText ?? "00:00:00");
      const m = pt.match(/^(\d+):(\d+):(\d+)$/);
      if (m) totalSec += Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      const b = g.progressBadges ?? {};
      if (b.clearAt) clearCount++;
      if (b.completeAt) compCount++;
    }

    const h = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    const totalTimeText = `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;

    return { totalSec, totalTimeText, clearCount, compCount, gamesCount: games.length };
  }

  function formatHMS(ms) {
    const t = Math.max(0, Math.floor(Number(ms) / 1000));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function kindLabel(kind) {
    if (kind === "PAGE_FOUND") return "ページ発見";
    if (kind === "CLEARED") return "CLEAR";
    if (kind === "COMPLETE") return "COMPLETE";
    if (kind === "MANUAL_CLEAR_SET") return "手動CLEAR";
    if (kind === "MANUAL_CLEAR_UNSET") return "手動CLEAR解除";
    if (kind === "MANUAL_COMPLETE_SET") return "手動COMPLETE";
    if (kind === "MANUAL_COMPLETE_UNSET") return "手動COMPLETE解除";
    return String(kind || "EVENT");
  }

  function getSubPrefix(game) {
    const p = String(game?.subPrefix ?? "").trim();
    return p || "S";
  }

  function makeIndexLabel(ev, game) {
    const idxText = String(ev?.indexText ?? "").trim();
    if (idxText) return idxText;

    const idx = Number(ev?.index);
    if (!Number.isFinite(idx)) return "?";

    if (idx >= 501) return `${getSubPrefix(game)}${idx - 500}`;
    return `ページ${idx}`;
  }

  function toLocalStamp(ts) {
    try {
      return new Date(Number(ts) || Date.now()).toLocaleString("ja-JP");
    } catch {
      return String(ts ?? "");
    }
  }

  function computeProgressPoint(ev, game) {
    let mt = Number(ev?.mainTotal);
    let st = Number(ev?.subTotal);
    if (!Number.isFinite(mt) || mt <= 0) mt = Number(game?.totalPages);
    if (!Number.isFinite(st) || st <= 0) st = Number(game?.subTotalPages);
    const mf = Number(ev?.mainFound);
    const sf = Number(ev?.subFound);
    const denom = (Number.isFinite(mt) ? mt : 0) + (Number.isFinite(st) ? st : 0);
    const num = (Number.isFinite(mf) ? mf : 0) + (Number.isFinite(sf) ? sf : 0);
    const rate = denom > 0 ? Math.max(0, Math.min(1, num / denom)) : 0;
    const t = Number(ev?.elapsedMs) || 0;
    return { t, rate };
  }

  function toGraphPointLabel(lbl) {
    const m = String(lbl ?? "").match(/^ページ(\d+)$/);
    if (m) return m[1];
    return String(lbl ?? "");
  }

  function easeOutCubic(x) {
    const t = Math.max(0, Math.min(1, x));
    return 1 - Math.pow(1 - t, 3);
  }

  function buildReportSeries(game, events, width, height) {
    const found = (events ?? []).filter(ev => ev?.kind === "PAGE_FOUND");
    if (found.length < 2) return null;

    const mainTotal = Number(game?.totalPages);
    const subTotal = Number(game?.subTotalPages);
    const hasMainTotal = Number.isFinite(mainTotal) && mainTotal > 0;
    const hasSubTotal = Number.isFinite(subTotal) && subTotal > 0;
    const denom = (hasMainTotal ? mainTotal : 0) + (hasSubTotal ? subTotal : 0);

    const mainSet = new Set();
    const subSet = new Set();

    const pts = found.map((ev) => {
      const idx = Number(ev?.index);
      if (Number.isFinite(idx)) {
        if (hasMainTotal && idx >= 1 && idx <= mainTotal) mainSet.add(idx);
        if (hasSubTotal && idx >= 501 && idx <= (500 + subTotal)) subSet.add(idx);
      }
      const num = mainSet.size + subSet.size;
      const rate = denom > 0 ? Math.max(0, Math.min(1, num / denom)) : 0;
      const t = Number(ev?.elapsedMs) || 0;
      const lbl = makeIndexLabel(ev, game);
      return { t, rate, label: lbl, ev };
    }).filter(p => Number.isFinite(p.t) && Number.isFinite(p.rate));
    if (pts.length < 2) return null;

    const w = width;
    const h = height;
    const padL = 24;
    const padR = 110;
    const padT = 34;
    const padB = 40;

    const t0 = pts[0].t;
    const stampTimes = (events ?? [])
      .filter(ev => ev?.kind === "CLEARED" || ev?.kind === "COMPLETE")
      .map(ev => Number(ev?.elapsedMs) || 0);
    const lastPt = pts[pts.length - 1];
    const manualStampTimes = [];
    const pb = game?.progressBadges ?? {};
    if (pb.manualClear === true && lastPt) manualStampTimes.push(lastPt.t);
    if (pb.manualComplete === true && lastPt) manualStampTimes.push(lastPt.t);
    const tMax = Math.max(...pts.map(p => p.t), ...stampTimes, ...manualStampTimes);
    const dt = Math.max(1, tMax - t0);

    const x = (t) => padL + ((t - t0) / dt) * (w - padL - padR);
    const y = (r) => (h - padB) - (r * (h - padT - padB));

    const px = pts.map((p) => ({ ...p, gx: x(p.t), gy: y(p.rate), gLabel: toGraphPointLabel(p.label) }));

    const guides = [];
    try {
      const est = game?.estPlayHours || {};
      const parseHourField = (v) => {
        if (v === "" || v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const pick = (mn, mx) => {
        const a = parseHourField(mx);
        const b = parseHourField(mn);
        return (a != null) ? a : b;
      };
      const normalH = pick(est.normalMin, est.normalMax);
      const hintH = pick(est.hintMin, est.hintMax);

      const addGuide = (kind, hours) => {
        if (!Number.isFinite(hours) || hours <= 0) return;
        const expectedMs = hours * 3600 * 1000;
        const rate0 = Number(px[0]?.rate) || 0;
        const tStart = t0;
        const tEnd = Math.min(tMax, tStart + expectedMs);
        const frac = Math.max(0, Math.min(1, (tEnd - tStart) / expectedMs));
        const rateEnd = Math.max(0, Math.min(1, rate0 + frac * (1 - rate0)));
        guides.push({ kind, x0: px[0].gx, y0: px[0].gy, x1: x(tEnd), y1: y(rateEnd) });
      };

      addGuide("normal", normalH);
      addGuide("hint", hintH);
    } catch {}

    let half = null;
    for (const pp of px) {
      if (pp.rate >= 0.5) {
        half = { t: pp.t, x: pp.gx };
        break;
      }
    }

    const gaps = [];
    for (let i = 1; i < px.length; i++) gaps.push(Math.max(0, (px[i].t - px[i - 1].t)));
    const minGap = Math.min(...gaps);
    const maxGap = Math.max(...gaps);

    const segs = [];
    let worstIdx = -1;
    let worstGap = -1;
    for (let i = 1; i < px.length; i++) {
      const gap = Math.max(0, (px[i].t - px[i - 1].t));
      if (gap > worstGap) {
        worstGap = gap;
        worstIdx = i;
      }
      const ratio = (maxGap > minGap) ? ((gap - minGap) / (maxGap - minGap)) : 0.5;
      const hue = 120 * (1 - Math.max(0, Math.min(1, ratio)));
      const color = `hsl(${hue}, 70%, 60%)`;
      const x0 = px[i - 1].gx;
      const y0 = px[i - 1].gy;
      const x1 = px[i].gx;
      const y1 = px[i].gy;
      const len = Math.hypot(x1 - x0, y1 - y0);
      segs.push({ i, gap, color, x0, y0, x1, y1, len });
    }

    const stamps = (events ?? [])
      .filter(ev => ev?.kind === "CLEARED" || ev?.kind === "COMPLETE")
      .map((ev) => {
        const p = computeProgressPoint(ev, game);
        const t = Number(p.t) || 0;
        const rate = Number(p.rate) || 0;
        const yy = y(rate) - 18;
        const yClamped = Math.max(padT + 16, Math.min(h - padB - 8, yy));
        return { kind: ev.kind, label: kindLabel(ev.kind) + "!", t, rate, x: x(t), y: yClamped };
      });
    if (lastPt) {
      const bothManual = pb.manualClear === true && pb.manualComplete === true;
      if (pb.manualClear === true) {
        const yBase = lastPt.gy - (bothManual ? 30 : 18);
        const yClamped = Math.max(padT + 16, Math.min(h - padB - 8, yBase));
        stamps.push({
          kind: "MANUAL_CLEARED",
          label: "CLEAR!",
          t: lastPt.t,
          rate: lastPt.rate,
          x: lastPt.gx,
          y: yClamped,
          manual: true,
        });
      }
      if (pb.manualComplete === true) {
        const yBase = lastPt.gy - (bothManual ? 8 : 18);
        const yClamped = Math.max(padT + 16, Math.min(h - padB - 8, yBase));
        stamps.push({
          kind: "MANUAL_COMPLETE",
          label: "COMPLETE!",
          t: lastPt.t,
          rate: lastPt.rate,
          x: lastPt.gx,
          y: yClamped,
          manual: true,
        });
      }
    }

    const totalLen = segs.reduce((s, a) => s + a.len, 0);

    return { w, h, padL, padR, padT, padB, x, y, points: px, half, segs, guides, worstIdx, worstGap, stamps, totalLen };
  }

  function drawReportFrame(ctx, series) {
    const { w, h, padL, padR, padT, padB, y } = series;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#e7eaf0";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.globalAlpha = 0.35;
    for (const rr of [0, 0.5, 1]) {
      const yy = y(rr);
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(w - padR, yy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawBottomMarkerLabel(ctx, series, x, text, color) {
    if (!text) return;
    const y = (series.h - 2);
    ctx.save();
    ctx.font = "700 12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    const tw = ctx.measureText(text).width;
    let lx = Number(x) || 0;
    lx = Math.max(tw / 2 + 6, Math.min(series.w - tw / 2 - 6, lx));

    let fill = color || "rgba(231,234,240,0.95)";
    if (typeof fill === "string") {
      const m = fill.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/i);
      if (m) fill = `rgba(${m[1]},${m[2]},${m[3]},0.95)`;
      else {
        const m2 = fill.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
        if (m2) fill = `rgba(${m2[1]},${m2[2]},${m2[3]},0.95)`;
      }
    }

    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;

    ctx.fillStyle = fill;
    ctx.fillText(text, lx, y);
    ctx.restore();
  }

  function renderReportChart(ctx, series, progressLen, stampState, opts) {
    const hideSpoilers = opts?.hideSpoilers ?? false;
    drawReportFrame(ctx, series);

    if (Array.isArray(series.guides) && series.guides.length) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      for (const g of series.guides) {
        if (!g) continue;
        const isHint = g.kind === "hint";
        ctx.globalAlpha = isHint ? 0.18 : 0.26;
        ctx.strokeStyle = "#e7eaf0";
        ctx.lineWidth = isHint ? 1 : 1.2;
        ctx.beginPath();
        ctx.moveTo(g.x0, g.y0);
        ctx.lineTo(g.x1, g.y1);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    const { points, segs, worstIdx } = series;
    if (!points?.length || !segs?.length) return;

    let remain = Math.max(0, Number(progressLen) || 0);
    let endX = points[0].gx;
    let endY = points[0].gy;
    let lastPointIndexVisible = 0;

    for (const seg of segs) {
      if (remain <= 0 && seg.len > 0) break;
      const drawFull = remain >= seg.len - 0.001;
      const t = drawFull ? 1 : (seg.len > 0 ? (remain / seg.len) : 0);
      const xe = seg.x0 + (seg.x1 - seg.x0) * t;
      const ye = seg.y0 + (seg.y1 - seg.y0) * t;
      ctx.beginPath();
      ctx.moveTo(seg.x0, seg.y0);
      ctx.lineTo(xe, ye);
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = (seg.i === worstIdx) ? 3 : 2;
      ctx.stroke();
      endX = xe;
      endY = ye;
      if (drawFull) lastPointIndexVisible = seg.i;
      remain -= seg.len;
    }

    const allSegmentsDrawn = (lastPointIndexVisible === points.length - 1);
    if (allSegmentsDrawn && series.stamps?.length) {
      const maxStampX = Math.max(...series.stamps.map(st => st.x));
      if (maxStampX > endX) endX = maxStampX;
    }

    ctx.font = "10px system-ui";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= lastPointIndexVisible; i++) {
      const p = points[i];
      ctx.beginPath();
      ctx.arc(p.gx, p.gy, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = "#e7eaf0";
      ctx.fill();

      if (!hideSpoilers) {
        const txt = String(p.gLabel ?? "");
        if (txt) {
          ctx.fillStyle = "rgba(231,234,240,0.75)";
          const tw = ctx.measureText(txt).width;
          let lx = p.gx + 5;
          if (lx + tw > (series.w - 4)) lx = p.gx - 5 - tw;
          lx = Math.max(4, Math.min(series.w - tw - 4, lx));
          let ly = p.gy - 8;
          ly = Math.max(12, Math.min(series.h - 12, ly));
          ctx.fillText(txt, lx, ly);
        }
      }
    }

    if (series.half && endX >= series.half.x) {
      const col = "rgba(200,200,200,0.55)";
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(series.half.x + 0.5, series.padT);
      ctx.lineTo(series.half.x + 0.5, series.h - series.padB);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      drawBottomMarkerLabel(ctx, series, series.half.x, `50% ${formatHMS(series.half.t)}`, col);
    }

    for (const st of (series.stamps ?? [])) {
      if (endX < st.x - 0.5) continue;
      const isClearStamp = (st.kind === "CLEARED" || st.kind === "MANUAL_CLEARED");
      const col = isClearStamp ? "rgba(255,80,80,0.55)" : "rgba(255,200,80,0.55)";
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(st.x + 0.5, series.padT);
      ctx.lineTo(st.x + 0.5, series.h - series.padB);
      ctx.stroke();
      ctx.restore();

      drawBottomMarkerLabel(ctx, series, st.x, formatHMS(st.t), col);

      if (!stampState[st.kind]) stampState[st.kind] = performance.now();
      const born = stampState[st.kind];
      const age = Math.max(0, performance.now() - born);
      const k = Math.min(1, age / 320);
      const scale = 0.85 + 0.25 * easeOutCubic(k);
      const alpha = Math.min(1, age / 90);

      const baseFont = "700 22px system-ui";
      ctx.font = baseFont;
      const tw = ctx.measureText(st.label).width;
      const sx = Math.max(tw / 2 + 8, Math.min(series.w - tw / 2 - 8, st.x));
      const sy = Math.max(series.padT + 18, Math.min(series.h - series.padB - 10, st.y));

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(sx, sy);
      const tilt = isClearStamp ? (-0.18) : (-0.13);
      ctx.rotate(tilt);
      ctx.scale(scale, scale);

      ctx.font = baseFont;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const baseCol = isClearStamp ? "rgba(255,80,80,0.92)" : "rgba(255,200,80,0.92)";
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;

      const tw2 = ctx.measureText(st.label).width;
      const bw = tw2 + 26;
      const bh = 28;
      const r = 7;
      ctx.beginPath();
      ctx.moveTo(-bw / 2 + r, -bh / 2);
      ctx.lineTo(bw / 2 - r, -bh / 2);
      ctx.quadraticCurveTo(bw / 2, -bh / 2, bw / 2, -bh / 2 + r);
      ctx.lineTo(bw / 2, bh / 2 - r);
      ctx.quadraticCurveTo(bw / 2, bh / 2, bw / 2 - r, bh / 2);
      ctx.lineTo(-bw / 2 + r, bh / 2);
      ctx.quadraticCurveTo(-bw / 2, bh / 2, -bw / 2, bh / 2 - r);
      ctx.lineTo(-bw / 2, -bh / 2 + r);
      ctx.quadraticCurveTo(-bw / 2, -bh / 2, -bw / 2 + r, -bh / 2);
      ctx.closePath();
      ctx.strokeStyle = baseCol;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 3;
      ctx.strokeText(st.label, 0, 0);
      ctx.fillStyle = baseCol;
      ctx.fillText(st.label, 0, 0);

      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(endX, endY, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(231,234,240,0.95)";
    ctx.fill();
  }

  function animateReportChart(canvas, game, events, cssW, cssH, opts) {
    const w = Number(cssW) || canvas.width;
    const h = Number(cssH) || canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const onDone = (opts && typeof opts.onDone === "function") ? opts.onDone : null;
    const series = buildReportSeries(game, events, w, h);
    if (!series) {
      const padL = 24, padR = 110, padT = 34, padB = 40;
      drawReportFrame(ctx, { w, h, padL, padR, padT, padB, y: (r) => (h - padB) - (r * (h - padT - padB)) });
      return null;
    }

    const duration = Math.min(4000, Math.max(1100, 900 + series.points.length * 80));
    let token = 0;
    let hideSpoilers = !!(opts && opts.hideSpoilers);
    let lastStampState = Object.create(null);

    const startPlayback = () => {
      token += 1;
      const myToken = token;
      const stampState = Object.create(null);
      lastStampState = stampState;
      const start = performance.now();
      let done = false;

      const loop = () => {
        if (myToken !== token) return;
        const t = performance.now() - start;
        const p = easeOutCubic(Math.min(1, t / duration));
        const len = series.totalLen * p;
        renderReportChart(ctx, series, len, stampState, { hideSpoilers });
        if (!done && t >= duration) {
          done = true;
          try { onDone && onDone(); } catch {}
        }
        if (t < duration + 450) requestAnimationFrame(loop);
      };

      requestAnimationFrame(loop);
    };

    const setHideSpoilers = (v) => {
      hideSpoilers = !!v;
      renderReportChart(ctx, series, series.totalLen, lastStampState, { hideSpoilers });
    };

    startPlayback();
    return { replay: startPlayback, setHideSpoilers };
  }

  function buildReportText(game, events) {
    const evs = Array.isArray(events) ? [...events] : [];
    evs.sort((a, b) => (Number(a?.at) || 0) - (Number(b?.at) || 0));
    if (evs.length === 0) return "（まだログがありません）";

    let prevFoundElapsed = null;
    let worst = null;
    let prev = null;
    for (const ev of evs) {
      if (ev?.kind !== "PAGE_FOUND") continue;
      if (prev) {
        const gap = (Number(ev.elapsedMs) || 0) - (Number(prev.elapsedMs) || 0);
        if (!worst || gap > worst.gap) worst = { gap, from: prev, to: ev };
      }
      prev = ev;
    }

    const lines = [];
    if (worst && Number.isFinite(worst.gap) && worst.gap > 0) {
      lines.push(`難所候補: ${formatHMS(worst.gap)} かかった区間（${makeIndexLabel(worst.from, game)} → ${makeIndexLabel(worst.to, game)}）`);
      lines.push("");
    }

    for (const ev of evs) {
      const elapsed = formatHMS(ev.elapsedMs);
      const cur = Number(ev.elapsedMs) || 0;
      const gap = (prevFoundElapsed == null) ? 0 : Math.max(0, cur - prevFoundElapsed);
      const rel = formatHMS(gap);
      const stamp = toLocalStamp(ev.at);
      if (ev.kind === "PAGE_FOUND") {
        const idx = makeIndexLabel(ev, game);
        const w = String(ev.word ?? "").trim();
        const wtxt = w ? ` 使用ワード: ${w}` : "";
        lines.push(`${elapsed} (Δ${rel}) ${stamp}  ${idx} 発見${wtxt}`);
        prevFoundElapsed = cur;
      } else {
        lines.push(`${elapsed} (Δ${rel}) ${stamp}  ${kindLabel(ev.kind)}!`);
      }
    }
    return lines.join("\n");
  }

  function computeWorstGaps(game, events, limit = 2) {
    const evs = Array.isArray(events) ? [...events] : [];
    evs.sort((a, b) => (Number(a?.at) || 0) - (Number(b?.at) || 0));
    const gaps = [];
    let prev = null;
    for (const ev of evs) {
      if (ev?.kind !== "PAGE_FOUND") continue;
      if (prev) {
        const gap = (Number(ev.elapsedMs) || 0) - (Number(prev.elapsedMs) || 0);
        if (gap > 0) gaps.push({ gap, from: prev, to: ev });
      }
      prev = ev;
    }
    gaps.sort((a, b) => b.gap - a.gap);
    return gaps.slice(0, Math.max(0, Number(limit) || 0));
  }

  function computeReportSummaryData(game, events) {
    const evs = Array.isArray(events) ? [...events] : [];
    evs.sort((a, b) => (Number(a?.at) || 0) - (Number(b?.at) || 0));

    const clearEv = evs.find(ev => ev?.kind === "CLEARED") || null;
    const compEv = evs.find(ev => ev?.kind === "COMPLETE") || null;

    const mainTotal = Number(game?.totalPages);
    const subTotal = Number(game?.subTotalPages);
    const hasMainTotal = Number.isFinite(mainTotal) && mainTotal > 0;
    const hasSubTotal = Number.isFinite(subTotal) && subTotal > 0;
    const denom = (hasMainTotal ? mainTotal : 0) + (hasSubTotal ? subTotal : 0);

    let halfEv = null;
    const mainSet = new Set();
    const subSet = new Set();
    for (const ev of evs) {
      if (ev?.kind !== "PAGE_FOUND") continue;
      const idx = Number(ev?.index);
      if (Number.isFinite(idx)) {
        if (hasMainTotal && idx >= 1 && idx <= mainTotal) mainSet.add(idx);
        if (hasSubTotal && idx >= 501 && idx <= (500 + subTotal)) subSet.add(idx);
      }
      const num = mainSet.size + subSet.size;
      if ((denom > 0 ? (num / denom) : 0) >= 0.5) {
        halfEv = ev;
        break;
      }
    }

    const found = evs.filter(ev => ev?.kind === "PAGE_FOUND");
    const totalElapsed = Number((compEv || clearEv || evs[evs.length - 1] || {}).elapsedMs) || 0;
    let worstGap = 0;
    for (let i = 1; i < found.length; i++) {
      const g = (Number(found[i].elapsedMs) || 0) - (Number(found[i - 1].elapsedMs) || 0);
      if (g > worstGap) worstGap = g;
    }

    const minutes = Math.max(0.001, totalElapsed / 60000);
    const speed = found.length / minutes;
    const titles = [];
    const add = (t) => { if (t && !titles.includes(t)) titles.push(t); };

    try {
      const est = game?.estPlayHours || {};
      const toNum = (v) => {
        if (v === "" || v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const nMin = toNum(est.normalMin);
      const nMax = toNum(est.normalMax);
      let low = null;
      if (nMin != null && nMax != null) low = Math.min(nMin, nMax);
      else if (nMin != null) low = nMin;
      else if (nMax != null) low = nMax;

      if (clearEv && low != null && low > 0) {
        const halfMs = low * 3600000 * 0.5;
        const c = Number(clearEv.elapsedMs) || 0;
        if (c > 0 && c <= halfMs) add("電光石火の調査員");
      }
    } catch {}

    if (clearEv && Number(clearEv.elapsedMs) < 20 * 60 * 1000) add("電光石火の調査員");
    if (speed >= 0.6) add("鋭い観察眼");
    else if (speed >= 0.45) add("敏腕調査員");
    if (worstGap >= 15 * 60 * 1000) add("迷宮踏破者");
    else if (worstGap >= 8 * 60 * 1000) add("粘りの調査員");

    const startAt = Number(evs[0]?.at) || 0;
    const endAt = Number((compEv || clearEv || evs[evs.length - 1] || {}).at) || 0;
    try {
      const ds = new Date(startAt || Date.now());
      const de = new Date(endAt || Date.now());
      const hs = ds.getHours();
      const he = de.getHours();
      const dayChanged = ds.toDateString() !== de.toDateString();
      const nightCount = evs.filter(ev => {
        const h = new Date(Number(ev?.at) || 0).getHours();
        return h >= 0 && h <= 4;
      }).length;
      if (nightCount >= Math.max(2, Math.floor(evs.length * 0.5))) add("不眠の調査員");
      if (dayChanged && hs >= 21 && he <= 7) add("夜明けの観測者");
    } catch {}

    if (titles.length === 0) add("見習い調査員");
    return {
      clearMs: clearEv ? (Number(clearEv.elapsedMs) || 0) : null,
      completeMs: compEv ? (Number(compEv.elapsedMs) || 0) : null,
      halfMs: halfEv ? (Number(halfEv.elapsedMs) || 0) : null,
      titles: titles.slice(0, 3),
    };
  }

  function getBlueMemoWords(page) {
    const out = [];
    for (const m of (page?.memos ?? [])) {
      const text = String(m?.text ?? "").trim();
      if (!text) continue;
      if (String(m?.color ?? "").toLowerCase() !== "blue") continue;
      if (!out.includes(text)) out.push(text);
    }
    return out;
  }

  function buildPageListIndexLabel(page, game) {
    const idxText = String(page?.indexText ?? "").trim();
    if (idxText) return idxText;

    const idx = Number(page?.index);
    if (!Number.isFinite(idx)) return "?";

    const mainPrefix = String(game?.mainPrefix ?? "").trim();
    const subPrefix = String(game?.subPrefix ?? "").trim() || "S";

    // Main: 1..499
    if (idx >= 1 && idx <= 499) {
      return mainPrefix ? `${mainPrefix}${idx}` : String(idx);
    }

    // Sub: 501..999 (stored as 500 + n)
    if (idx >= 501 && idx <= 999) {
      const subNo = idx - 500;
      return `${subPrefix}${subNo}`;
    }

    // Extra/other: 1000+
    if (idx >= 1000) {
      return String(idx);
    }

    // Keep legacy odd values (e.g. 500 or <=0) visible as-is.
    return String(idx);
  }

  function buildPageListRows(game, pages) {
    const arr = Array.isArray(pages) ? pages : [];
    const rows = [];
    for (const p of arr) {
      const url = String(p?.url ?? "").trim();
      if (!url) continue;
      const label = buildPageListIndexLabel(p, game);
      rows.push({
        pageId: String(p?.id ?? ""),
        index: Number(p?.index) || 0,
        indexLabel: label,
        title: String(p?.name ?? ""),
        url,
        prevWord: String(p?.fromPrevWord ?? "").trim(),
        blueWords: getBlueMemoWords(p),
      });
    }
    rows.sort((a, b) => {
      if (a.index !== b.index) return a.index - b.index;
      return a.indexLabel.localeCompare(b.indexLabel, "ja");
    });
    return rows;
  }

  globalObj.ArgAssistViewerCore = {
    computeGlobalStats,
    formatHMS,
    kindLabel,
    makeIndexLabel,
    computeProgressPoint,
    buildReportSeries,
    drawReportFrame,
    drawBottomMarkerLabel,
    renderReportChart,
    animateReportChart,
    buildReportText,
    computeWorstGaps,
    computeReportSummaryData,
    buildPageListRows,
    getBlueMemoWords,
  };
})(window);
