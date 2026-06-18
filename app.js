(function () {
  "use strict";

  const STORAGE_KEY = "collend_entries_v1";
  const THEME_KEY = "collend_theme";
  const SORT_KEY = "collend_sort";

  /** @type {string|null} */
  let activeTagFilter = null;

  /** @type {HTMLElement} */
  const elInput = document.getElementById("input");
  const elBtnAdd = document.getElementById("btnAdd");
  const elStatus = document.getElementById("status");
  const elSearch = document.getElementById("search");
  const elList = document.getElementById("list");
  const elEmpty = document.getElementById("empty");
  const elCount = document.getElementById("count");
  const elBtnImport = document.getElementById("btnImport");
  const elImportFile = document.getElementById("importFile");
  const elBtnExport = document.getElementById("btnExport");
  const elBtnTheme = document.getElementById("btnTheme");
  const elSortSelect = document.getElementById("sortSelect");
  const elStatTotal = document.getElementById("statTotal");
  const elStatTags = document.getElementById("statTags");
  const elBtnClearTagFilter = document.getElementById("btnClearTagFilter");
  const tplCard = document.getElementById("tplCard");

  const STOP_ZH = new Set(
    "的了在是和与或及等也又就都还而于对以从中为可以这个一个我们你们他们它们自己之其被把让从到去来着要会能可着过说要做成时后前里上下面这那哪什么怎么哪么吗呢吧啊哦嗯呀很非常最更再已经如果因为所以但是然而虽然如此因此只是只是并并且以及以及或或者".split("")
  );
  const STOP_EN = new Set(
    "a an the and or but if in on at to for of as is are was were be been being it its this that these those with from by about into through over after before between under again further then once here there when where why how all both each few more most other some such no nor not only own same so than too very can could should would may might must will just also what which who whom whose".split(" ")
  );

  function isLikelyUrl(s) {
    const t = s.trim();
    return /^https?:\/\//i.test(t) && t.length < 2048;
  }

  async function fetchUrlAsText(url) {
    const u = url.trim();
    const jina = "https://r.jina.ai/" + u;
    const res = await fetch(jina, { headers: { Accept: "text/plain" } });
    if (!res.ok) throw new Error("无法读取链接内容（HTTP " + res.status + "）");
    const text = await res.text();
    if (!text || text.length < 20) throw new Error("页面内容过短或无法解析");
    return text.slice(0, 120_000);
  }

  function splitSentences(text) {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
    let parts = normalized.split(/(?<=[。！？!?])\s+|(?<=[.!?])\s+(?=[A-Z\u4e00-\u9fff"'])/);
    if (parts.length <= 1 && normalized.length > 80) {
      parts = normalized.split(/\.\s+/);
    }
    return parts.map((p) => p.trim()).filter((p) => p.length > 8);
  }

  function tokenizeForFreq(text) {
    const out = [];
    const lower = text.toLowerCase();
    const en = lower.match(/[a-z][a-z'-]{2,}/g);
    if (en) {
      for (const w of en) {
        if (!STOP_EN.has(w)) out.push(w);
      }
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/[\u4e00-\u9fff]/.test(ch)) {
        if (i + 1 < text.length && /[\u4e00-\u9fff]/.test(text[i + 1])) {
          const bigram = ch + text[i + 1];
          if (!STOP_ZH.has(ch) && !STOP_ZH.has(text[i + 1])) out.push(bigram);
        }
      }
    }
    return out;
  }

  function wordFreq(tokens) {
    const m = new Map();
    for (const t of tokens) {
      m.set(t, (m.get(t) || 0) + 1);
    }
    return m;
  }

  function scoreSentences(sentences, freq) {
    return sentences.map((s, idx) => {
      const toks = tokenizeForFreq(s);
      let score = 0;
      for (const t of toks) score += freq.get(t) || 0;
      const len = s.length;
      const posBoost = 1 - Math.min(idx, 6) * 0.04;
      const lenNorm = Math.min(len / 120, 2);
      return { s, score: score * posBoost * (0.6 + lenNorm * 0.2) };
    });
  }

  function summarize(text, maxChars) {
    const sentences = splitSentences(text);
    if (sentences.length === 0) {
      const t = text.replace(/\s+/g, " ").trim();
      return t.slice(0, maxChars) + (t.length > maxChars ? "…" : "");
    }
    const freq = wordFreq(tokenizeForFreq(text));
    const ranked = scoreSentences(sentences, freq).sort((a, b) => b.score - a.score);
    const pick = new Set();
    pick.add(0);
    for (const r of ranked) {
      if (pick.size >= 4) break;
      const i = sentences.indexOf(r.s);
      if (i >= 0) pick.add(i);
    }
    const ordered = [...pick].sort((a, b) => a - b).map((i) => sentences[i]);
    let out = ordered.join(" ");
    if (out.length > maxChars) out = out.slice(0, maxChars).trim() + "…";
    return out;
  }

  function extractTags(text, maxTags) {
    const freq = wordFreq(tokenizeForFreq(text));
    const arr = [...freq.entries()].filter(([w]) => w.length >= 2);
    arr.sort((a, b) => b[1] - a[1]);
    const tags = [];
    const seen = new Set();
    for (const [w] of arr) {
      if (tags.length >= maxTags) break;
      if (seen.has(w)) continue;
      seen.add(w);
      tags.push(/^[a-z]/.test(w) ? w : w);
    }
    return tags;
  }

  function titleFromText(text, url) {
    if (url) {
      const s = url.trim();
      return s.length > 80 ? s.slice(0, 80) + "…" : s;
    }
    const line = text.split(/\n/)[0].trim();
    return line.length > 72 ? line.slice(0, 72) + "…" : line;
  }

  function migrateEntry(e) {
    if (!e || typeof e !== "object") return e;
    const o = Object.assign({}, e);
    o.pinned = !!o.pinned;
    o.tags = Array.isArray(o.tags) ? o.tags : [];
    o.notes = typeof o.notes === "string" ? o.notes.slice(0, 2000) : "";
    return o;
  }

  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.map(migrateEntry);
    } catch {
      return [];
    }
  }

  function saveEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.map(migrateEntry)));
  }

  function getSortMode() {
    return localStorage.getItem(SORT_KEY) || "time-desc";
  }

  function setSortMode(mode) {
    localStorage.setItem(SORT_KEY, mode);
    if (elSortSelect) elSortSelect.value = mode;
  }

  function tagSortKey(entry) {
    const tags = (entry.tags || []).slice().sort(function (a, b) {
      return a.localeCompare(b, "zh-CN");
    });
    if (tags.length) return tags[0].toLowerCase();
    return String(entry.title || "").toLowerCase();
  }

  function sortEntries(arr, mode) {
    const pinned = arr.filter(function (e) {
      return e.pinned;
    });
    const rest = arr.filter(function (e) {
      return !e.pinned;
    });
    function rank(sub) {
      const copy = sub.slice();
      if (mode === "time-asc") {
        copy.sort(function (a, b) {
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
      } else if (mode === "tags-asc") {
        copy.sort(function (a, b) {
          return tagSortKey(a).localeCompare(tagSortKey(b), "zh-CN");
        });
      } else {
        copy.sort(function (a, b) {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
      }
      return copy;
    }
    return rank(pinned).concat(rank(rest));
  }

  function computeLibraryStats(entries) {
    const tagSet = new Set();
    for (let i = 0; i < entries.length; i++) {
      const tags = entries[i].tags || [];
      for (let j = 0; j < tags.length; j++) tagSet.add(tags[j]);
    }
    return { total: entries.length, uniqueTags: tagSet.size };
  }

  function updateStatsBar(allEntries) {
    const s = computeLibraryStats(allEntries);
    if (elStatTotal) elStatTotal.textContent = String(s.total);
    if (elStatTags) elStatTags.textContent = String(s.uniqueTags);
  }

  function updateTagFilterChrome() {
    if (!elBtnClearTagFilter) return;
    if (activeTagFilter) {
      elBtnClearTagFilter.classList.remove("hidden");
      elBtnClearTagFilter.textContent = "清除「" + activeTagFilter + "」";
    } else {
      elBtnClearTagFilter.classList.add("hidden");
    }
  }

  function applyTheme(theme) {
    const t = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute("content", t === "light" ? "light dark" : "dark light");
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch (_) {}
    if (elBtnTheme) {
      if (t === "light") {
        elBtnTheme.textContent = "深色";
        elBtnTheme.setAttribute("aria-label", "切换到深色模式");
      } else {
        elBtnTheme.textContent = "浅色";
        elBtnTheme.setAttribute("aria-label", "切换到浅色模式");
      }
    }
  }

  function exportFilenameForToday() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return "collend-export-" + y + "-" + m + "-" + day + ".json";
  }

  function downloadJsonExport(entries) {
    const payload = {
      app: "Collend",
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      entries,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilenameForToday();
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function extractEntriesArrayFromParsed(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && Array.isArray(data.entries)) return data.entries;
    throw new Error("JSON 中缺少 entries 数组。");
  }

  function normalizeImportedEntry(obj) {
    if (!obj || typeof obj !== "object") return null;
    let id = typeof obj.id === "string" && obj.id.length ? obj.id : null;
    if (!id) id = crypto.randomUUID();
    const title = typeof obj.title === "string" ? obj.title : "";
    const summary = typeof obj.summary === "string" ? obj.summary : "";
    let raw = typeof obj.raw === "string" ? obj.raw : "";
    if (raw.length > 50_000) raw = raw.slice(0, 50_000);
    const createdAt =
      typeof obj.createdAt === "string" && !Number.isNaN(Date.parse(obj.createdAt))
        ? obj.createdAt
        : new Date().toISOString();
    const tags = Array.isArray(obj.tags) ? obj.tags.filter(function (t) { return typeof t === "string"; }) : [];
    let sourceUrl = null;
    if (typeof obj.sourceUrl === "string" && obj.sourceUrl.length) sourceUrl = obj.sourceUrl;
    if (!title.trim() && !summary.trim() && !raw.trim()) return null;
    const pinned = typeof obj.pinned === "boolean" ? obj.pinned : false;
    const notes = typeof obj.notes === "string" ? obj.notes.slice(0, 2000) : "";
    return {
      id: id,
      title: title,
      summary: summary,
      raw: raw,
      tags: tags,
      createdAt: createdAt,
      sourceUrl: sourceUrl,
      pinned: pinned,
      notes: notes,
    };
  }

  function mergeImportFromText(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("不是有效的 JSON 文件。");
    }
    const rawEntries = extractEntriesArrayFromParsed(data);
    const existing = loadEntries();
    const existingIds = new Set(existing.map(function (e) { return e.id; }));
    const toAdd = [];
    for (let i = 0; i < rawEntries.length; i++) {
      const norm = normalizeImportedEntry(rawEntries[i]);
      if (!norm) continue;
      if (existingIds.has(norm.id)) continue;
      existingIds.add(norm.id);
      toAdd.push(norm);
    }
    const merged = sortEntries(
      existing.concat(toAdd).map(migrateEntry),
      getSortMode()
    );
    saveEntries(merged);
    return toAdd.length;
  }

  async function mergeImportFromFile(file) {
    const text = await file.text();
    return mergeImportFromText(text);
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function entryMatchesQuery(entry, q) {
    if (!q) return true;
    const hay = [
      entry.title,
      entry.summary,
      entry.raw,
      entry.notes || "",
      ...(entry.tags || []),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function addTagToEntrySave(entryId, raw) {
    const v = raw.trim();
    if (!v) return;
    const next = loadEntries().map(function (x) {
      if (x.id !== entryId) return x;
      const arr = (x.tags || []).slice();
      if (arr.indexOf(v) !== -1) return x;
      arr.push(v);
      return Object.assign({}, x, { tags: arr });
    });
    saveEntries(next);
    render();
  }

  function bindTagsEditor(ul, entryId) {
    ul.innerHTML = "";
    const entry = loadEntries().find(function (x) {
      return x.id === entryId;
    });
    const tags = entry ? (entry.tags || []).slice() : [];

    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      const li = document.createElement("li");
      li.className = "tag-pill";
      const span = document.createElement("span");
      span.className = "tag-text";
      span.textContent = t;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tag-remove";
      btn.setAttribute("aria-label", "删除标签「" + t + "」");
      btn.textContent = "×";
      btn.addEventListener("click", function () {
        const next = loadEntries().map(function (x) {
          if (x.id !== entryId) return x;
          return Object.assign({}, x, {
            tags: (x.tags || []).filter(function (tag) {
              return tag !== t;
            }),
          });
        });
        saveEntries(next);
        render();
      });
      span.classList.add("tag-text--filterable");
      span.setAttribute("role", "button");
      span.setAttribute("tabindex", "0");
      span.title = "点击只显示含此标签的收藏；再点同一标签或「清除」取消";
      if (activeTagFilter === t) {
        li.classList.add("tag-pill--filter-active");
      }
      span.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (activeTagFilter === t) activeTagFilter = null;
        else activeTagFilter = t;
        render();
      });
      span.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          if (activeTagFilter === t) activeTagFilter = null;
          else activeTagFilter = t;
          render();
        }
      });
      li.appendChild(span);
      li.appendChild(btn);
      ul.appendChild(li);
    }

    const addLi = document.createElement("li");
    addLi.className = "tag-add-cell";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "tag-add";
    addBtn.setAttribute("aria-label", "添加标签");
    addBtn.textContent = "+";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tag-input hidden";
    input.setAttribute("maxlength", "48");
    input.placeholder = "新标签";
    input.setAttribute("aria-label", "输入新标签");

    function showInput() {
      addBtn.classList.add("hidden");
      input.classList.remove("hidden");
      input.focus();
    }

    function hideInput() {
      input.value = "";
      input.classList.add("hidden");
      addBtn.classList.remove("hidden");
    }

    function commitIfValue() {
      const v = input.value.trim();
      if (!v) {
        hideInput();
        return;
      }
      addTagToEntrySave(entryId, v);
    }

    addBtn.addEventListener("click", function () {
      showInput();
    });

    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commitIfValue();
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        hideInput();
      }
    });

    input.addEventListener("blur", function () {
      setTimeout(function () {
        if (!input.isConnected || input.classList.contains("hidden")) return;
        const v = input.value.trim();
        if (v) addTagToEntrySave(entryId, v);
        else hideInput();
      }, 0);
    });

    addLi.appendChild(addBtn);
    addLi.appendChild(input);
    ul.appendChild(addLi);
  }

  function saveNotesForEntry(entryId, text) {
    const v = typeof text === "string" ? text.slice(0, 2000) : "";
    const next = loadEntries().map(function (x) {
      if (x.id !== entryId) return x;
      return Object.assign({}, x, { notes: v });
    });
    saveEntries(next);
    render();
  }

  function bindCardNotes(wrap, entryId) {
    const display = wrap.querySelector(".notes-display");
    const field = wrap.querySelector(".notes-edit");
    if (!display || !field) return;

    function readNote() {
      const ent = loadEntries().find(function (x) {
        return x.id === entryId;
      });
      return ent && typeof ent.notes === "string" ? ent.notes : "";
    }

    function fillDisplay(text) {
      if (text) {
        display.textContent = text;
        display.classList.remove("notes-display--empty");
      } else {
        display.textContent = "点击添加备注…";
        display.classList.add("notes-display--empty");
      }
    }

    fillDisplay(readNote());

    function openEditor() {
      field.value = readNote();
      display.classList.add("hidden");
      field.classList.remove("hidden");
      field.focus();
    }

    function closeEditor() {
      field.classList.add("hidden");
      display.classList.remove("hidden");
    }

    display.addEventListener("click", function () {
      if (!field.classList.contains("hidden")) return;
      openEditor();
    });

    display.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        if (!field.classList.contains("hidden")) return;
        openEditor();
      }
    });

    field.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        field.value = readNote();
        closeEditor();
        fillDisplay(readNote());
      }
    });

    field.addEventListener("blur", function () {
      setTimeout(function () {
        if (!field.isConnected || field.classList.contains("hidden")) return;
        const nextVal = field.value.slice(0, 2000);
        if (nextVal === readNote()) {
          closeEditor();
          fillDisplay(readNote());
          return;
        }
        saveNotesForEntry(entryId, nextVal);
      }, 0);
    });
  }

  function render() {
    const all = loadEntries();
    updateStatsBar(all);
    updateTagFilterChrome();

    const q = elSearch.value.trim().toLowerCase();
    let filtered = all.filter(function (e) {
      return entryMatchesQuery(e, q);
    });
    if (activeTagFilter) {
      filtered = filtered.filter(function (e) {
        return (e.tags || []).indexOf(activeTagFilter) !== -1;
      });
    }
    const ordered = sortEntries(filtered, getSortMode());

    elList.innerHTML = "";
    const countBits = [String(ordered.length) + " 条"];
    if (q) countBits.push("搜索");
    if (activeTagFilter) countBits.push("标签");
    elCount.textContent = countBits.join(" · ");

    if (ordered.length === 0) {
      elEmpty.classList.remove("hidden");
      if (activeTagFilter && !q) {
        elEmpty.textContent = "没有带该标签的收藏。";
      } else if (q && activeTagFilter) {
        elEmpty.textContent = "没有同时满足搜索与标签筛选的条目。";
      } else if (q) {
        elEmpty.textContent = "没有匹配的条目，试试别的关键词。";
      } else {
        elEmpty.textContent = "还没有条目。在上方粘贴内容后点击「解析并保存」。";
      }
    } else {
      elEmpty.classList.add("hidden");
    }

    for (let i = 0; i < ordered.length; i++) {
      const e = ordered[i];
      const node = tplCard.content.firstElementChild.cloneNode(true);
      node.dataset.id = e.id;
      node.querySelector(".card-time").textContent = formatTime(e.createdAt);
      node.querySelector(".card-source").textContent = e.title;
      node.querySelector(".card-summary").textContent = e.summary;
      const notesWrap = node.querySelector(".card-notes");
      if (notesWrap) bindCardNotes(notesWrap, e.id);
      const ul = node.querySelector(".tags");
      bindTagsEditor(ul, e.id);
      const pinBtn = node.querySelector(".pin");
      if (pinBtn) {
        const pinned = !!e.pinned;
        pinBtn.classList.toggle("is-pinned", pinned);
        pinBtn.textContent = pinned ? "★" : "☆";
        pinBtn.setAttribute("aria-pressed", pinned ? "true" : "false");
        pinBtn.setAttribute("aria-label", pinned ? "取消置顶" : "置顶");
        pinBtn.addEventListener("click", function () {
          const next = loadEntries().map(function (x) {
            if (x.id !== e.id) return x;
            return Object.assign({}, x, { pinned: !x.pinned });
          });
          saveEntries(next);
          render();
        });
      }
      node.querySelector(".delete").addEventListener("click", function () {
        const next = loadEntries().filter(function (x) {
          return x.id !== e.id;
        });
        saveEntries(next);
        render();
      });
      elList.appendChild(node);
    }
  }

  function setStatus(msg, isError) {
    elStatus.textContent = msg || "";
    elStatus.classList.toggle("error", !!isError);
  }

  elBtnAdd.addEventListener("click", async () => {
    const rawInput = elInput.value.trim();
    if (!rawInput) {
      setStatus("请先粘贴内容或链接。", true);
      return;
    }
    elBtnAdd.disabled = true;
    setStatus("处理中…");
    try {
      let bodyText = rawInput;
      let sourceUrl = null;
      if (isLikelyUrl(rawInput)) {
        sourceUrl = rawInput;
        bodyText = await fetchUrlAsText(rawInput);
      }
      const summary = summarize(bodyText, 420);
      const tags = extractTags(bodyText, 8);
      const entry = {
        id: crypto.randomUUID(),
        title: titleFromText(bodyText, sourceUrl),
        raw: bodyText.slice(0, 50_000),
        summary,
        tags,
        createdAt: new Date().toISOString(),
        sourceUrl,
        pinned: false,
        notes: "",
      };
      const all = [entry, ...loadEntries()];
      saveEntries(all);
      elInput.value = "";
      setStatus("已保存。");
      render();
    } catch (err) {
      setStatus(err.message || "保存失败", true);
    } finally {
      elBtnAdd.disabled = false;
    }
  });

  elSearch.addEventListener("input", function () {
    render();
  });

  elBtnExport.addEventListener("click", () => {
    downloadJsonExport(loadEntries());
  });

  elBtnImport.addEventListener("click", function () {
    elImportFile.value = "";
    elImportFile.click();
  });

  elImportFile.addEventListener("change", async function () {
    const file = elImportFile.files && elImportFile.files[0];
    if (!file) return;
    try {
      const n = await mergeImportFromFile(file);
      setStatus(
        n > 0 ? "已导入 " + n + " 条，已与现有收藏合并。" : "没有新条目可导入（可能已全部存在或文件无有效数据）。",
        false
      );
      render();
    } catch (err) {
      setStatus(err.message || "导入失败", true);
    }
    elImportFile.value = "";
  });

  if (elBtnTheme) {
    elBtnTheme.addEventListener("click", function () {
      const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      applyTheme(next);
    });
  }

  if (elSortSelect) {
    elSortSelect.addEventListener("change", function () {
      setSortMode(elSortSelect.value);
      render();
    });
  }

  if (elBtnClearTagFilter) {
    elBtnClearTagFilter.addEventListener("click", function () {
      activeTagFilter = null;
      render();
    });
  }

  try {
    applyTheme(localStorage.getItem(THEME_KEY) || "dark");
  } catch (_) {
    applyTheme("dark");
  }
  if (elSortSelect) elSortSelect.value = getSortMode();

  render();
})();
