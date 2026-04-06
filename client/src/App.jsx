import { useState, useRef, useEffect, useCallback } from "react";
import "./App.css";

// ── Debounce hook ────────────────────────────────────────────────────
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── Sub-components ───────────────────────────────────────────────────

function ModeTag({ mode }) {
  return <span className="mode-tag">{mode}</span>;
}

function ResultCard({ result, index, tokens }) {
  return (
    <a
      href={result.url}
      target="_blank"
      rel="noopener noreferrer"
      className="result-card"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div className="result-top">
        <span className="result-domain">{result.domain}</span>
        <div className="result-badges">
          <span className="badge pr" title="PageRank">
            PR {result.pagerank}
          </span>
          <span className="badge score">{result.score}</span>
        </div>
      </div>
      <h3 className="result-title">{result.title}</h3>
      <p
        className="result-snippet"
        dangerouslySetInnerHTML={{ __html: result.snippet || result.url }}
      />
      <span className="result-date">
        {result.crawled_at
          ? new Date(result.crawled_at).toLocaleDateString()
          : ""}
      </span>
    </a>
  );
}

function Pagination({ page, pageSize, total, onChange }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="pagination">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className="pg-btn"
      >
        ← Prev
      </button>
      {start > 1 && (
        <>
          <button className="pg-btn" onClick={() => onChange(1)}>
            1
          </button>
          <span className="pg-ellipsis">…</span>
        </>
      )}
      {pages.map((p) => (
        <button
          key={p}
          className={`pg-btn ${p === page ? "active" : ""}`}
          onClick={() => onChange(p)}
        >
          {p}
        </button>
      ))}
      {end < totalPages && (
        <>
          <span className="pg-ellipsis">…</span>
          <button className="pg-btn" onClick={() => onChange(totalPages)}>
            {totalPages}
          </button>
        </>
      )}
      <button
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        className="pg-btn"
      >
        Next →
      </button>
    </div>
  );
}

function StatsBar({ stats }) {
  if (!stats) return null;
  return (
    <div className="stats-bar">
      <span>📄 {stats.pages.toLocaleString()} pages</span>
      <span>🔤 {stats.terms.toLocaleString()} terms</span>
      <span>🌐 {stats.domains.toLocaleString()} domains</span>
      <span>⏳ {stats.queued.toLocaleString()} queued</span>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────
export default function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [suggestions, setSuggestions] = useState([]);
  const [showSug, setShowSug] = useState(false);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({ domain: "", from: "", to: "" });
  const [showFilters, setShowFilters] = useState(false);

  const inputRef = useRef(null);
  const sugRef = useRef(null);
  const debouncedQ = useDebounce(query, 200);

  const PAGE_SIZE = 10;

  // Fetch stats on mount
  useEffect(() => {
    fetch("/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  // Autocomplete
  useEffect(() => {
    if (debouncedQ.length < 2) {
      setSuggestions([]);
      return;
    }
    fetch(`/autocomplete?q=${encodeURIComponent(debouncedQ)}`)
      .then((r) => r.json())
      .then((d) => {
        setSuggestions(d.suggestions || []);
        setShowSug(true);
      })
      .catch(() => {});
  }, [debouncedQ]);

  // Close suggestions on outside click
  useEffect(() => {
    function handler(e) {
      if (
        !sugRef.current?.contains(e.target) &&
        !inputRef.current?.contains(e.target)
      ) {
        setShowSug(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const doSearch = useCallback(
    async (q = query, p = 1) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setLoading(true);
      setError(null);
      setShowSug(false);
      setPage(p);

      const params = new URLSearchParams({
        q: trimmed,
        page: p,
        pageSize: PAGE_SIZE,
      });
      if (filters.domain) params.set("domain", filters.domain);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);

      try {
        const res = await fetch(`/search?${params}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setResults(data);
        setMeta({ mode: data.mode, total: data.total, tokens: data.tokens });
        // Refresh stats after search
        fetch("/stats")
          .then((r) => r.json())
          .then(setStats)
          .catch(() => {});
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [query, filters],
  );

  function pickSuggestion(s) {
    setQuery(s);
    setShowSug(false);
    doSearch(s, 1);
  }

  function handlePageChange(p) {
    setPage(p);
    doSearch(query, p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app">
      <div className="bg-grid" />

      {/* Header */}
      <header className="header">
        <div className="logo">
          <span className="logo-bracket">[</span>AI Search
          <span className="logo-bracket">]</span>
        </div>
        <p className="tagline">TF-IDF · PageRank · Continuous Crawling</p>
        <StatsBar stats={stats} />
      </header>

      <main className="main">
        {/* Search bar */}
        <div className="search-wrap">
          <div className="search-row">
            <div className="search-box-wrap">
              <div className="search-box">
                <span className="search-icon">›_</span>
                <input
                  ref={inputRef}
                  className="search-input"
                  type="text"
                  placeholder="Search anything…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setShowSug(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doSearch(query, 1);
                    if (e.key === "Escape") setShowSug(false);
                  }}
                  onFocus={() => suggestions.length && setShowSug(true)}
                  autoFocus
                />
                <button
                  className="filter-toggle"
                  onClick={() => setShowFilters((v) => !v)}
                  title="Filters"
                >
                  ⚙
                </button>
                <button
                  className="search-btn"
                  onClick={() => doSearch(query, 1)}
                  disabled={loading}
                >
                  {loading ? <span className="spinner" /> : "Search"}
                </button>
              </div>

              {/* Autocomplete dropdown */}
              {showSug && suggestions.length > 0 && (
                <div className="suggestions" ref={sugRef}>
                  {suggestions.map((s, i) => (
                    <div
                      key={i}
                      className="suggestion-item"
                      onMouseDown={() => pickSuggestion(s)}
                    >
                      <span className="sug-icon">↗</span>
                      {s}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Filters */}
          {showFilters && (
            <div className="filters">
              <div className="filter-group">
                <label>Domain</label>
                <input
                  type="text"
                  placeholder="e.g. en.wikipedia.org"
                  value={filters.domain}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, domain: e.target.value }))
                  }
                />
              </div>
              <div className="filter-group">
                <label>From</label>
                <input
                  type="date"
                  value={filters.from}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, from: e.target.value }))
                  }
                />
              </div>
              <div className="filter-group">
                <label>To</label>
                <input
                  type="date"
                  value={filters.to}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, to: e.target.value }))
                  }
                />
              </div>
              <button
                className="clear-filters"
                onClick={() => setFilters({ domain: "", from: "", to: "" })}
              >
                Clear
              </button>
            </div>
          )}

          {/* Meta bar */}
          {meta && (
            <div className="meta-bar">
              <span>{meta.total.toLocaleString()} results</span>
              <ModeTag mode={meta.mode} />
              <span className="meta-tokens">{meta.tokens.join(" · ")}</span>
            </div>
          )}
        </div>

        {/* Error */}
        {error && <div className="error-msg">⚠ {error}</div>}

        {/* No results */}
        {results && results.results.length === 0 && (
          <div className="no-results">
            No results found. The crawler may still be indexing — try again in a
            moment.
          </div>
        )}

        {/* Results */}
        {results && results.results.length > 0 && (
          <>
            <div className="results-grid">
              {results.results.map((r, i) => (
                <ResultCard
                  key={r.url}
                  result={r}
                  index={i}
                  tokens={meta?.tokens || []}
                />
              ))}
            </div>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={meta?.total || 0}
              onChange={handlePageChange}
            />
          </>
        )}

        {/* Empty state */}
        {!results && !loading && !error && (
          <div className="empty-state">
            <div className="empty-orb" />
            <p>
              Enter a query to search {stats?.pages?.toLocaleString() || "…"}{" "}
              indexed pages
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
