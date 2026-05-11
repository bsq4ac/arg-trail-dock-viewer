(() => {
  "use strict";

  const STORAGE_KEY = "arg_viewer_snapshot_v1";
  const viewerCore = window.ArgAssistViewerCore || {};

  const state = {
    games: {},
    pagesByGame: {},
    reportsByGame: {},
    selectedId: null,
    sourceLabel: "未読込",
  };

  const els = {
    gamesList: document.getElementById("gamesList"),
    activeArea: document.getElementById("activeGameArea"),
    activeMeta: document.getElementById("activeGameMeta"),
    viewerStats: document.getElementById("viewerStats"),
    viewerSource: document.getElementById("viewerSource"),
    btnHelp: document.getElementById("btnHelp"),
    btnLoadJson: document.getElementById("btnLoadJson"),
    btnClearLocal: document.getElementById("btnClearLocal"),
    fileJson: document.getElementById("fileJson"),
  };

  function isSafeUrl(url) {
    try {
      const u = new URL(String(url || "").trim());
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  function formatDateTime(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "--/--/-- --:--";
    const d = new Date(n);
    const p = (v) => String(v).padStart(2, "0");
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function formatPlaytime(ms) {
    if (typeof viewerCore.formatHMS === "function") return viewerCore.formatHMS(ms);
    const sec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function ensureGame(g, id) {
    const gameId = String(g?.id ?? id ?? "");
    return {
      id: gameId,
      title: String(g?.title ?? "(無題)"),
      author: String(g?.author ?? ""),
      introUrl: String(g?.introUrl ?? ""),
      topUrl: String(g?.topUrl ?? ""),
      hintUrl: String(g?.hintUrl ?? ""),
      searchUrl1: String(g?.searchUrl1 ?? ""),
      searchUrl2: String(g?.searchUrl2 ?? ""),
      mainPrefix: String(g?.mainPrefix ?? ""),
      subPrefix: String(g?.subPrefix ?? ""),
      totalPages: Number.isFinite(Number(g?.totalPages)) && Number(g.totalPages) > 0 ? Number(g.totalPages) : null,
      subTotalPages: Number.isFinite(Number(g?.subTotalPages)) && Number(g.subTotalPages) > 0 ? Number(g.subTotalPages) : null,
      tags: Array.isArray(g?.tags) ? g.tags.filter(v => typeof v === "string") : [],
      archived: !!g?.archived,
      playtimeMs: Number.isFinite(Number(g?.playtimeMs)) ? Math.max(0, Number(g.playtimeMs)) : 0,
      playtimeText: String(g?.playtimeText ?? formatPlaytime(g?.playtimeMs)),
      playModeOn: !!g?.playModeOn,
      progressBadges: (g?.progressBadges && typeof g.progressBadges === "object") ? g.progressBadges : {},
      updatedAt: Number(g?.updatedAt) || 0,
      createdAt: Number(g?.createdAt) || 0,
      lastAction: (g?.lastAction && typeof g.lastAction === "object") ? g.lastAction : null,
      estPlayHours: (g?.estPlayHours && typeof g.estPlayHours === "object") ? g.estPlayHours : { normalMin: null, normalMax: null, hintMin: null, hintMax: null },
    };
  }

  function normalizeViewerSnapshot(payload) {
    if (!payload || typeof payload !== "object") throw new Error("bad_payload");

    const games = {};
    const pagesByGame = {};
    const reportsByGame = {};

    if (payload.type === "arg_viewer_snapshot" && payload.data && typeof payload.data === "object") {
      const d = payload.data;
      for (const [id, g] of Object.entries(d.games ?? {})) {
        games[id] = ensureGame(g, id);
      }
      for (const [id, pages] of Object.entries(d.pagesByGame ?? {})) {
        pagesByGame[id] = Array.isArray(pages) ? pages : [];
      }
      for (const [id, events] of Object.entries(d.reportsByGame ?? {})) {
        reportsByGame[id] = Array.isArray(events) ? events : [];
      }
      return { games, pagesByGame, reportsByGame };
    }

    if (payload.type === "arg_game_export" && payload.data && typeof payload.data === "object") {
      const d = payload.data;
      const game = ensureGame(d.game ?? {}, d.game?.id ?? "imported_game");
      const id = game.id || `game_${Date.now()}`;
      game.id = id;
      games[id] = game;
      pagesByGame[id] = Array.isArray(d.pages) ? d.pages : [];
      reportsByGame[id] = Array.isArray(d.report) ? d.report : [];
      return { games, pagesByGame, reportsByGame };
    }

    const rawData = (payload.data && typeof payload.data === "object") ? payload.data : payload;
    const rawGames = rawData?.arg_games;
    if (rawGames && typeof rawGames === "object") {
      for (const [id, g] of Object.entries(rawGames)) {
        games[id] = ensureGame(g, id);
        pagesByGame[id] = Array.isArray(rawData[`arg_pages_${id}`]) ? rawData[`arg_pages_${id}`] : [];
        reportsByGame[id] = Array.isArray(rawData[`arg_report_${id}`]) ? rawData[`arg_report_${id}`] : [];
      }
      return { games, pagesByGame, reportsByGame };
    }

    throw new Error("unsupported_schema");
  }

  function saveLocal() {
    const snapshot = {
      type: "arg_viewer_snapshot",
      version: 1,
      savedAt: Date.now(),
      data: {
        games: state.games,
        pagesByGame: state.pagesByGame,
        reportsByGame: state.reportsByGame,
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }

  function loadLocal() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      const snap = normalizeViewerSnapshot(parsed);
      state.games = snap.games;
      state.pagesByGame = snap.pagesByGame;
      state.reportsByGame = snap.reportsByGame;
      state.selectedId = Object.keys(state.games)[0] || null;
      state.sourceLabel = "localStorage";
      return true;
    } catch {
      return false;
    }
  }

  function setFromPayload(payload, sourceLabel) {
    const snap = normalizeViewerSnapshot(payload);
    state.games = snap.games;
    state.pagesByGame = snap.pagesByGame;
    state.reportsByGame = snap.reportsByGame;
    state.selectedId = Object.keys(state.games)[0] || null;
    state.sourceLabel = sourceLabel || "JSON";
    saveLocal();
    renderAll();
  }

  function openExternal(url) {
    const u = String(url || "").trim();
    if (!isSafeUrl(u)) {
      alert("安全でないURLのため開けません");
      return;
    }
    window.open(u, "_blank", "noopener,noreferrer");
  }

  function escapeCsvCell(value) {
    const s = String(value ?? "");
    if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }

  function downloadTextFile(text, filename, mimeType = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type: mimeType });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportGameCsv(game, pages) {
    const rows = (typeof viewerCore.buildPageListRows === "function")
      ? viewerCore.buildPageListRows(game, pages)
      : [];

    const lines = [
      ["番号", "タイトル", "URL", "遷移ワード", "発見キーワード"].map(escapeCsvCell).join(","),
      ...rows.map((row) => [
        row.indexLabel,
        row.title,
        row.url,
        row.prevWord,
        Array.isArray(row.blueWords) ? row.blueWords.join(" / ") : "",
      ].map(escapeCsvCell).join(",")),
    ];

    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const safeTitle = String(game?.title ?? "ARG").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
    const filename = `ARG_Trail_Dock_${safeTitle}_${stamp}.csv`;
    const csvWithBom = "\uFEFF" + lines.join("\r\n");
    downloadTextFile(csvWithBom, filename, "text/csv;charset=utf-8");
  }

  function renderStats() {
    if (!els.viewerStats) return;
    const fn = viewerCore.computeGlobalStats;
    const stats = (typeof fn === "function") ? fn(state.games) : { totalTimeText: "--:--:--", gamesCount: 0, clearCount: 0, compCount: 0 };
    els.viewerStats.textContent = `🕒${stats.totalTimeText} | 🎮${stats.gamesCount} 🎖${stats.clearCount} 🏆${stats.compCount}`;
    if (els.viewerSource) els.viewerSource.textContent = state.sourceLabel;
  }

  function renderGames() {
    const root = els.gamesList;
    if (!root) return;
    root.replaceChildren();

    const ids = Object.keys(state.games).sort((a, b) => (state.games[b].updatedAt || 0) - (state.games[a].updatedAt || 0));
    if (!ids.length) {
      const empty = document.createElement("div");
      empty.className = "small";
      empty.textContent = "ゲームがありません。JSONを読み込んでください。";
      root.appendChild(empty);
      return;
    }

    for (const id of ids) {
      const g = state.games[id];
      const item = document.createElement("div");
      item.className = `gameItem${state.selectedId === id ? " selected" : ""}`;
      item.dataset.gameId = id;

      const top = document.createElement("div");
      top.className = "giTop";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = String(g.title || "(無題)");
      top.appendChild(name);

      const bottom = document.createElement("div");
      bottom.className = "giBottom";
      const left = document.createElement("div");
      left.className = "giBottomLeft";
      const right = document.createElement("div");
      right.className = "giBottomRight";
      const meta = document.createElement("div");
      meta.className = "meta";
      const scopes = Array.isArray(g.scopes) ? g.scopes.length : 0;
      meta.textContent = `scopes: ${scopes} / panel: ${g.playModeOn ? "ON" : "OFF"} / 🕒 ${g.playtimeText || formatPlaytime(g.playtimeMs)}`;
      right.appendChild(meta);

      const badges = document.createElement("div");
      badges.className = "rowBadges";
      const pb = g.progressBadges || {};
      if (pb.clearAt) {
        const b = document.createElement("span");
        b.className = "badge";
        b.title = "CLEAR!";
        b.textContent = "🎖";
        badges.appendChild(b);
      }
      if (pb.completeAt) {
        const b = document.createElement("span");
        b.className = "badge";
        b.title = "COMPLETE!";
        b.textContent = "🏆";
        badges.appendChild(b);
      }
      right.appendChild(badges);
      bottom.append(left, right);
      item.append(top, bottom);
      item.onclick = () => {
        state.selectedId = id;
        renderGames();
        renderActive();
      };
      root.appendChild(item);
    }
  }

  function addReadonlyRow(grid, label, value) {
    const k = document.createElement("div");
    k.textContent = label;
    const v = document.createElement("input");
    v.type = "text";
    v.readOnly = true;
    v.value = String(value ?? "");
    grid.append(k, v);
  }

  function renderActive() {
    const area = els.activeArea;
    if (!area) return;
    area.replaceChildren();
    if (els.activeMeta) els.activeMeta.textContent = "";

    const id = state.selectedId;
    const g = id ? state.games[id] : null;
    if (!g) {
      const empty = document.createElement("div");
      empty.className = "small";
      empty.textContent = "ゲームを選択してください。";
      area.appendChild(empty);
      return;
    }

    if (els.activeMeta) {
      els.activeMeta.textContent = `更新 ${formatDateTime(g.updatedAt)}\n作成 ${formatDateTime(g.createdAt)}`;
    }

    const wrap = document.createElement("div");
    const kv = document.createElement("div");
    kv.className = "kv";
    addReadonlyRow(kv, "タイトル", g.title);
    addReadonlyRow(kv, "作者", g.author);
    addReadonlyRow(kv, "タグ", (g.tags || []).join(", "));
    addReadonlyRow(kv, "導入URL", g.introUrl);
    addReadonlyRow(kv, "トップURL", g.topUrl);
    addReadonlyRow(kv, "ヒントURL", g.hintUrl);
    addReadonlyRow(kv, "検索URL1", g.searchUrl1);
    addReadonlyRow(kv, "検索URL2", g.searchUrl2);
    addReadonlyRow(kv, "メイン接頭辞", g.mainPrefix);
    addReadonlyRow(kv, "サブ接頭辞", g.subPrefix);
    addReadonlyRow(kv, "ページ総数", g.totalPages ?? "");
    addReadonlyRow(kv, "サブ総数", g.subTotalPages ?? "");
    addReadonlyRow(kv, "想定プレイ時間（通常）", `${g.estPlayHours?.normalMin ?? ""} ~ ${g.estPlayHours?.normalMax ?? ""}`);
    addReadonlyRow(kv, "想定プレイ時間（ヒントあり）", `${g.estPlayHours?.hintMin ?? ""} ~ ${g.estPlayHours?.hintMax ?? ""}`);
    wrap.appendChild(kv);

    const row = document.createElement("div");
    row.className = "inline";
    row.style.marginTop = "10px";

    const btnReport = document.createElement("button");
    btnReport.className = "secondary";
    btnReport.textContent = "調査レポート";
    btnReport.onclick = () => showReportModal(g, state.reportsByGame[id] || []);

    const btnPages = document.createElement("button");
    btnPages.className = "secondary";
    btnPages.textContent = "ページ一覧";
    btnPages.onclick = () => showPageListModal(g, state.pagesByGame[id] || []);

    const btnCsv = document.createElement("button");
    btnCsv.className = "secondary";
    btnCsv.textContent = "CSV出力";
    btnCsv.onclick = () => exportGameCsv(g, state.pagesByGame[id] || []);

    const btnIntro = document.createElement("button");
    btnIntro.className = "secondary";
    btnIntro.textContent = "導入ページを開く";
    btnIntro.onclick = () => openExternal(g.introUrl);

    row.append(btnReport, btnPages, btnCsv, btnIntro);
    wrap.appendChild(row);
    area.appendChild(wrap);
  }

  function buildReportSummaryNode(game, events) {
    const fn = viewerCore.computeReportSummaryData;
    const d = (typeof fn === "function") ? fn(game, events) : { clearMs: null, completeMs: null, halfMs: null, titles: [] };
    const clear = (d.clearMs == null) ? "--:--:--" : formatPlaytime(d.clearMs);
    const comp = (d.completeMs == null) ? "--:--:--" : formatPlaytime(d.completeMs);
    const half = (d.halfMs == null) ? "--:--:--" : formatPlaytime(d.halfMs);
    const est = game?.estPlayHours || {};
    const parseHourField = (v) => {
      if (v === "" || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const nMin = parseHourField(est.normalMin);
    const nMax = parseHourField(est.normalMax);
    const hMin = parseHourField(est.hintMin);
    const hMax = parseHourField(est.hintMax);
    const fmtH = (v) => {
      if (v == null) return "";
      const s = String(Math.round(v * 10) / 10);
      return s.replace(/\.0$/, "");
    };
    const fmtRange = (mn, mx) => {
      if (mn == null && mx == null) return "";
      if (mn != null && mx != null) return (mn === mx) ? `${fmtH(mn)}h` : `${fmtH(mn)}~${fmtH(mx)}h`;
      if (mn != null) return `${fmtH(mn)}h`;
      return `${fmtH(mx)}h`;
    };
    const normalTxt = fmtRange(nMin, nMax);
    const hintTxt = fmtRange(hMin, hMax);
    const frag = document.createDocumentFragment();
    const title = document.createElement("div");
    title.className = "reportSummaryTitle";
    title.textContent = "RESULT";
    frag.appendChild(title);
    const addRow = (label, value, opts = {}) => {
      const row = document.createElement("div");
      row.className = `reportSummaryRow${opts.extraClass ? " " + opts.extraClass : ""}`;
      if (opts.rowStyle) row.style.cssText = opts.rowStyle;
      const k = document.createElement("div");
      k.className = "k";
      k.textContent = label;
      const v = document.createElement("div");
      v.className = "v";
      v.textContent = value;
      if (opts.vStyle) v.style.cssText = opts.vStyle;
      row.append(k, v);
      frag.appendChild(row);
    };
    addRow("CLEAR", clear);
    addRow("COMPLETE", comp);
    addRow("50%", half);
    if (normalTxt) addRow("想定", normalTxt, { vStyle: "font-weight:600; font-size:13px; opacity:.95;" });
    if (hintTxt) addRow("ヒントあり", hintTxt, { vStyle: "font-weight:600; font-size:13px; opacity:.9;" });
    return frag;
  }

  function showReportModal(game, events) {
    document.querySelectorAll(".modalOverlay.viewerReportModal").forEach(n => n.remove());
    const evs = Array.isArray(events) ? [...events] : [];
    evs.sort((a, b) => (Number(a?.at) || 0) - (Number(b?.at) || 0));
    const overlay = document.createElement("div");
    overlay.className = "modalOverlay viewerReportModal";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modalHead">
          <div style="font-weight:700;"><span id="reportTitle"></span></div>
          <div class="inline" style="gap:6px;">
            <label class="spoilerToggle" title="ネタバレ配慮モード（インデックス・称号・ログを非表示）">
              <input type="checkbox" id="chkSpoiler" />
              <span>配慮</span>
            </label>
            <button id="btnSaveReport" class="secondary">Save PNG</button>
            <button id="btnReplayReport" class="secondary">リプレイ</button>
            <button id="btnCloseReport" class="secondary">閉じる</button>
          </div>
        </div>
        <div class="modalBody">
          <canvas id="reportCanvas" class="reportChart" width="860" height="220"></canvas>
          <div class="small" style="margin-top:8px; opacity:.8;">横=経過時間 / 縦=コンプリート率（メイン＋サブ）</div>
          <div class="reportBottom" style="margin-top:10px;">
            <pre id="reportLog" class="reportLog"></pre>
            <div id="reportSummary" class="reportSummary"></div>
          </div>
        </div>
      </div>
    `;
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    const title = String(game?.title ?? "") || "(無題)";
    const titleEl = overlay.querySelector("#reportTitle");
    if (titleEl) titleEl.textContent = `調査レポート : ${title}`;
    const logEl = overlay.querySelector("#reportLog");
    if (logEl) {
      const fn = viewerCore.buildReportText;
      logEl.textContent = (typeof fn === "function") ? fn(game, evs) : "（ログ表示に必要な関数がありません）";
    }
    const summaryEl = overlay.querySelector("#reportSummary");
    if (summaryEl) {
      summaryEl.classList.remove("show");
      summaryEl.replaceChildren();
      summaryEl.appendChild(buildReportSummaryNode(game, evs));
    }
    const btnClose = overlay.querySelector("#btnCloseReport");
    if (btnClose) btnClose.onclick = close;
    const canvas = overlay.querySelector("#reportCanvas");
    let controller = null;
    if (canvas && typeof viewerCore.animateReportChart === "function") {
      const cssW = canvas.clientWidth || 860;
      const cssH = 220;
      const dpr = Math.max(1, Number(devicePixelRatio) || 1);
      canvas.width = Math.max(320, Math.floor(cssW * dpr));
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.height = `${cssH}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      controller = viewerCore.animateReportChart(canvas, game, evs, cssW, cssH, {
        onDone: () => { if (summaryEl) summaryEl.classList.add("show"); },
        hideSpoilers: true,
      });
    }
    const btnReplay = overlay.querySelector("#btnReplayReport");
    if (btnReplay) {
      btnReplay.onclick = () => {
        if (summaryEl) {
          summaryEl.classList.remove("show");
          summaryEl.replaceChildren();
          summaryEl.appendChild(buildReportSummaryNode(game, evs));
        }
        controller?.replay?.();
      };
    }
    const chkSpoiler = overlay.querySelector("#chkSpoiler");
    if (chkSpoiler) {
      const apply = () => {
        const hide = !!chkSpoiler.checked;
        controller?.setHideSpoilers?.(hide);
        if (logEl) logEl.classList.toggle("hideSpoilers", hide);
      };
      chkSpoiler.checked = true;
      chkSpoiler.onchange = apply;
      apply();
    }
    const btnSave = overlay.querySelector("#btnSaveReport");
    if (btnSave) {
      const safeName = (s) => {
        const t = String(s || "").trim();
        if (!t) return "report";
        return t.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 64);
      };
      const stamp = () => {
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
      };
      const getInvestigatorId = () => {
        try {
          const raw = localStorage.getItem("arg_investigator_id");
          const v = String(raw || "").trim();
          return v || "";
        } catch {
          return "";
        }
      };
      const makeExportCanvas = () => {
        if (!canvas) return null;
        const out = document.createElement("canvas");
        out.width = canvas.width;
        out.height = canvas.height;
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#0f1115";
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(canvas, 0, 0);
        const dpr = out.width / Math.max(1, canvas.clientWidth || out.width);
        const pad = Math.max(6, Math.round(10 * dpr));
        const fontSize = Math.max(12, Math.round(14 * dpr));
        ctx.save();
        ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(231,234,240,0.95)";
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = Math.round(6 * dpr);
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = Math.round(2 * dpr);
        const label = `調査レポート：${String(title || "")}`;
        let y = pad;
        ctx.fillText(label, pad, y);
        ctx.save();
        const underlineCol = "rgba(255,210,80,0.85)";
        const textW = ctx.measureText(label).width;
        const uY = y + Math.round(fontSize * 1.05);
        ctx.strokeStyle = underlineCol;
        ctx.lineWidth = Math.max(1, Math.round(2 * dpr));
        ctx.beginPath();
        ctx.moveTo(pad, uY);
        ctx.lineTo(pad + textW, uY);
        ctx.stroke();
        ctx.restore();
        y += Math.round((fontSize + 6) * dpr);
        const spoilersOn = chkSpoiler && chkSpoiler.checked;
        if (!spoilersOn && typeof viewerCore.computeWorstGaps === "function" && typeof viewerCore.makeIndexLabel === "function") {
          const gaps = viewerCore.computeWorstGaps(game, evs, 2);
          if (gaps.length > 0) {
            const smallSize = Math.max(10, Math.round(11 * dpr));
            const gapX = pad + Math.max(16, Math.round(22 * dpr));
            y += Math.max(6, Math.round(6 * dpr));
            ctx.font = `600 ${smallSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
            for (const g of gaps) {
              const fromLbl = viewerCore.makeIndexLabel(g.from, game);
              const toLbl = viewerCore.makeIndexLabel(g.to, game);
              const line = `難所 Δ${formatPlaytime(g.gap)} ${fromLbl} → ${toLbl}`;
              ctx.fillText(line, gapX, y);
              y += Math.round((smallSize + 4) * dpr);
            }
          }
        }
        const invId = getInvestigatorId();
        if (invId) {
          const idSize = Math.max(10, Math.round(11 * dpr));
          ctx.font = `600 ${idSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
          ctx.textBaseline = "bottom";
          ctx.fillStyle = "rgba(231,234,240,0.6)";
          ctx.fillText(`ID: ${invId}`, pad, out.height - pad);
        }
        ctx.restore();
        return out;
      };
      btnSave.onclick = async () => {
        const exp = makeExportCanvas();
        if (!exp) return;
        const blob = await new Promise((resolve) => exp.toBlob(resolve, "image/png"));
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `report_${safeName(title)}_${stamp()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      };
    }
  }

  function showPageListModal(game, pages) {
    document.querySelectorAll(".modalOverlay.pageListModal").forEach(n => n.remove());
    const rows = (typeof viewerCore.buildPageListRows === "function")
      ? viewerCore.buildPageListRows(game, pages)
      : [];

    const overlay = document.createElement("div");
    overlay.className = "modalOverlay pageListModal";
    overlay.innerHTML = `
      <div class="modal pageListModalContent" role="dialog" aria-modal="true">
        <div class="modalHead">
          <div style="font-weight:700;"><span id="pageListTitle"></span></div>
          <button id="btnClosePageList" class="secondary">閉じる</button>
        </div>
        <div class="modalBody">
        <div class="small" style="margin-bottom:8px; opacity:.85;">番号 / タイトル / URL / 遷移ワード / 発見キーワード</div>
        <table class="pageListTable">
          <colgroup>
            <col class="colPageNo" />
            <col class="colPageTitle" />
            <col class="colPageUrl" />
            <col class="colPagePrev" />
            <col class="colPageKw" />
            <col class="colPageAct" />
          </colgroup>
          <thead>
            <tr>
                <th>番号</th>
                <th>タイトル</th>
                <th>URL</th>
              <th>遷移ワード</th>
              <th>発見キーワード</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody id="pageListBody"></tbody>
          </table>
        </div>
      </div>
    `;

    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);

    const titleEl = overlay.querySelector("#pageListTitle");
    if (titleEl) titleEl.textContent = `ページ一覧 : ${String(game?.title ?? "(無題)")}`;
    const btnClose = overlay.querySelector("#btnClosePageList");
    if (btnClose) btnClose.onclick = close;

    const body = overlay.querySelector("#pageListBody");
    if (!body) return;
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.className = "pageListEmpty";
      td.textContent = "登録済みページがありません。";
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }

    for (const r of rows) {
      const tr = document.createElement("tr");
      const vals = [
        String(r.indexLabel ?? ""),
        String(r.title ?? ""),
        String(r.url ?? ""),
        String(r.prevWord ?? ""),
        Array.isArray(r.blueWords) ? r.blueWords.join(", ") : "",
      ];
      for (let i = 0; i < vals.length; i++) {
        const td = document.createElement("td");
        if (i === 2) {
          const div = document.createElement("div");
          div.className = "pageListUrl";
          div.textContent = vals[i];
          div.title = vals[i];
          td.appendChild(div);
        } else {
          td.textContent = vals[i];
        }
        tr.appendChild(td);
      }
      const tdAct = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary pageListOpenBtn";
      btn.textContent = "開く";
      btn.onclick = () => openExternal(r.url);
      tdAct.appendChild(btn);
      tr.appendChild(tdAct);
      body.appendChild(tr);
    }
  }

  function renderAll() {
    renderStats();
    renderGames();
    renderActive();
  }

  function showHelpModal() {
    document.querySelectorAll(".modalOverlay.viewerHelpModal").forEach(n => n.remove());
    const overlay = document.createElement("div");
    overlay.className = "modalOverlay viewerHelpModal";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modalHead">
          <div style="font-weight:700;">このページについて</div>
          <button id="btnCloseHelp" class="secondary">閉じる</button>
        </div>
        <div class="modalBody">
          <div style="line-height:1.7;">
            <p>これは、ブラウザ拡張「ARG Trail Dock」からエクスポートしたバックアップJSON（<code>ARG_Trail_Dock_backup_～.JSON</code>）を読み込み、拡張本体がなくてもプレイ記録を閲覧できるページです。読み込んだデータはブラウザのローカルストレージにのみ保存され、サーバー等へ保存・送信されることはありません。</p>
            <p>「CSV出力」ボタンでは、ARG作品ごとに、登録したページ情報・遷移ワード・発見キーワードなどをCSVとして出力できます。Excelへデータを移行する際などにご利用ください。</p>
          </div>
        </div>
      </div>
    `;
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    const btnClose = overlay.querySelector("#btnCloseHelp");
    if (btnClose) btnClose.onclick = close;
  }

  function setupEvents() {
    if (els.btnHelp) {
      els.btnHelp.onclick = () => showHelpModal();
    }

    if (els.btnLoadJson && els.fileJson) {
      els.btnLoadJson.onclick = () => els.fileJson.click();
      els.fileJson.onchange = async () => {
        const f = els.fileJson.files?.[0];
        if (!f) return;
        try {
          const text = await f.text();
          const payload = JSON.parse(text);
          setFromPayload(payload, `JSON: ${f.name}`);
        } catch (e) {
          console.error(e);
          alert("JSONの読み込みに失敗しました");
        } finally {
          els.fileJson.value = "";
        }
      };
    }

    if (els.btnClearLocal) {
      els.btnClearLocal.onclick = () => {
        const ok = confirm("viewer のローカル保存データを削除します。よろしいですか？");
        if (!ok) return;
        localStorage.removeItem(STORAGE_KEY);
        state.games = {};
        state.pagesByGame = {};
        state.reportsByGame = {};
        state.selectedId = null;
        state.sourceLabel = "未読込";
        renderAll();
      };
    }
  }

  setupEvents();
  if (!loadLocal()) renderAll();
  else renderAll();
})();

