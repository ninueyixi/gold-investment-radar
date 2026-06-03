const priorityLabel = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

const impactLabel = {
  bullish: "利多黄金",
  bearish: "利空黄金",
  neutral: "中性"
};

const scopeLabel = {
  global: "国际黄金",
  china: "国内黄金",
  both: "国际 / 国内"
};

const state = {
  filter: "all",
  daily: null,
  history: []
};

const els = {
  updatedAt: document.querySelector("#updatedAt"),
  dominantSignal: document.querySelector("#dominantSignal"),
  dominantSignalReason: document.querySelector("#dominantSignalReason"),
  highCount: document.querySelector("#highCount"),
  bullishCount: document.querySelector("#bullishCount"),
  bearishCount: document.querySelector("#bearishCount"),
  historyCount: document.querySelector("#historyCount"),
  newsList: document.querySelector("#newsList"),
  historyList: document.querySelector("#historyList"),
  filters: [...document.querySelectorAll(".filter-button")]
};

async function loadJson(path, fallback) {
  try {
    const response = await fetch(`${path}?v=${Date.now()}`);
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(error);
    return fallback;
  }
}

function formatDateTime(value) {
  if (!value) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false
  }).format(new Date(value));
}

function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeUrl(value, fallback = "#") {
  if (!value) return fallback;

  try {
    const parsed = new URL(value, window.location.href);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function matchesFilter(item) {
  if (state.filter === "all") return true;
  if (state.filter === "high") return item.priority === "high";
  if (state.filter === "bullish" || state.filter === "bearish") return item.impact === state.filter;
  if (state.filter === "global") return item.scope === "global" || item.scope === "both";
  if (state.filter === "china") return item.scope === "china" || item.scope === "both";
  return true;
}

function getDominantSignal(news) {
  const high = news.filter((item) => item.priority === "high");
  const sample = high[0] ?? news[0];
  const bullish = news.filter((item) => item.impact === "bullish").length;
  const bearish = news.filter((item) => item.impact === "bearish").length;

  if (!sample) {
    return {
      title: "暂无明确信号",
      reason: "今日尚未抓取到可用于判断的重点新闻。"
    };
  }

  if (bullish > bearish) {
    return {
      title: "偏利多黄金",
      reason: sample.reason
    };
  }

  if (bearish > bullish) {
    return {
      title: "偏利空黄金",
      reason: sample.reason
    };
  }

  return {
    title: "多空交织",
    reason: sample.reason
  };
}

function renderSummary() {
  const news = state.daily?.news ?? [];
  const signal = getDominantSignal(news);

  els.updatedAt.textContent = `更新时间：${formatDateTime(state.daily?.generatedAt)}`;
  els.dominantSignal.textContent = signal.title;
  els.dominantSignalReason.textContent = signal.reason;
  els.highCount.textContent = news.filter((item) => item.priority === "high").length;
  els.bullishCount.textContent = news.filter((item) => item.impact === "bullish").length;
  els.bearishCount.textContent = news.filter((item) => item.impact === "bearish").length;
  els.historyCount.textContent = state.history.length;
}

function renderNews() {
  const news = (state.daily?.news ?? []).filter(matchesFilter);

  if (news.length === 0) {
    els.newsList.innerHTML = '<div class="empty-state">当前筛选条件下暂无新闻。</div>';
    return;
  }

  els.newsList.innerHTML = news
    .map(
      (item) => `
        <article class="news-card" data-priority="${escapeHtml(item.priority)}">
          <div class="news-card__top">
            <div>
              <div class="news-card__meta">
                <span class="priority priority--${escapeHtml(item.priority)}">${priorityLabel[item.priority]}</span>
                <span class="impact impact--${escapeHtml(item.impact)}">${impactLabel[item.impact]}</span>
                <span class="tag">${scopeLabel[item.scope]}</span>
              </div>
              <h3>${escapeHtml(item.title)}</h3>
            </div>
          </div>
          <p class="news-card__reason">${escapeHtml(item.reason)}</p>
          <div class="news-card__footer">
            <span>${escapeHtml(item.source)} · ${formatDateTime(item.publishedAt)}</span>
            <a href="${escapeHtml(sanitizeUrl(item.url))}" target="_blank" rel="noreferrer noopener">查看来源</a>
          </div>
        </article>
      `
    )
    .join("");
}

function renderHistory() {
  if (state.history.length === 0) {
    els.historyList.innerHTML = "<li>暂无历史记录。</li>";
    return;
  }

  els.historyList.innerHTML = state.history
    .slice(0, 30)
    .map(
      (item) => `
        <li>
          <a href="./data/archive/${escapeHtml(item.date)}.json" target="_blank" rel="noreferrer noopener">
            ${escapeHtml(item.date)}
          </a>
          · ${item.total} 条新闻 · 高优先级 ${item.highPriority} 条
        </li>
      `
    )
    .join("");
}

function bindFilters() {
  els.filters.forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      els.filters.forEach((item) => item.classList.toggle("is-active", item === button));
      renderNews();
    });
  });
}

async function init() {
  const [daily, history] = await Promise.all([
    loadJson("./data/daily.json", { generatedAt: new Date().toISOString(), news: [] }),
    loadJson("./data/history.json", [])
  ]);

  state.daily = daily;
  state.history = history;
  bindFilters();
  renderSummary();
  renderNews();
  renderHistory();
}

init();
