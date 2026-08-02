/* ============================================================
   tables.js — A reusable, dependency-free DataTable component.
   Handles live search, column sorting, filter chips, pagination,
   CSV export and print. Each module (users.js, documents.js, …)
   instantiates one of these against its own dataset + columns.
   ============================================================ */
import { debounce, toCSV, downloadFile, printHTML, getPath } from "./utils.js";
import { skeletonRows, emptyState, initDropdown } from "./ui.js";

export class DataTable {
  /**
   * @param {Object} cfg
   * @param {HTMLElement} cfg.root - container element to render into
   * @param {Array<Object>} cfg.columns - [{key,label,sortable,render(row),csv:true}]
   * @param {Array<string>} cfg.searchFields - object paths matched by the search box
   * @param {Array<Object>} cfg.filters - [{key,label,options:[{value,label}], match(row,value)}]
   * @param {number} cfg.pageSize
   * @param {string} cfg.title - used for CSV filename / print title
   * @param {boolean} cfg.showExportCsv - set false to hide the Export CSV button entirely
   * @param {Function} cfg.onPrintClick - if provided, the Print button calls this instead of the built-in _print()
   * @param {string} cfg.emptyTitle
   * @param {string} cfg.emptyDesc
   * @param {Function} cfg.rowActionsHTML(row) -> string
   * @param {Function} cfg.onRowClick(row)
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.root = cfg.root;
    this.allRows = [];
    this.filtered = [];
    this.search = "";
    this.activeFilters = {};
    this.sortKey = cfg.defaultSort || null;
    this.sortDir = cfg.defaultSortDir || "desc";
    this.page = 1;
    this.pageSize = cfg.pageSize || 10;
    this.loading = true;
    this._buildShell();
  }

  _buildShell() {
    this.root.innerHTML = `
      <div class="table-toolbar">
        <div class="table-toolbar__left">
          <div class="table-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>
            <input type="text" placeholder="Search ${this.cfg.title ? this.cfg.title.toLowerCase() : "records"}…" data-role="search">
          </div>
        </div>
        <div class="table-toolbar__right">
          ${
            this.cfg.showExportCsv !== false
              ? `
          <button class="btn btn-secondary btn-sm" data-role="export-csv">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Export CSV
          </button>`
              : ""
          }
          <button class="btn btn-secondary btn-sm" data-role="print">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" stroke-linejoin="round"/></svg>
            Print
          </button>
        </div>
      </div>
      ${this.cfg.filters?.length ? `<div class="filter-bar" data-role="filter-bar"></div>` : ""}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>${this.cfg.columns.map((c) => this._thHTML(c)).join("")}</tr></thead>
          <tbody data-role="tbody"></tbody>
        </table>
      </div>
      <div class="table-footer">
        <div class="table-footer__info" data-role="info"></div>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
          <div class="page-size-select">
            <span>Rows per page</span>
            <select data-role="page-size">
              ${[10, 25, 50, 100].map((n) => `<option value="${n}" ${n === this.pageSize ? "selected" : ""}>${n}</option>`).join("")}
            </select>
          </div>
          <div class="pagination" data-role="pagination"></div>
        </div>
      </div>
    `;

    this.$tbody = this.root.querySelector('[data-role="tbody"]');
    this.$info = this.root.querySelector('[data-role="info"]');
    this.$pagination = this.root.querySelector('[data-role="pagination"]');

    this.root.querySelector('[data-role="search"]').addEventListener(
      "input",
      debounce((e) => {
        this.search = e.target.value.trim().toLowerCase();
        this.page = 1;
        this._apply();
      }, 220),
    );

    const exportBtn = this.root.querySelector('[data-role="export-csv"]');
    if (exportBtn) exportBtn.addEventListener("click", () => this._exportCSV());

    this.root
      .querySelector('[data-role="print"]')
      .addEventListener("click", () => {
        // If the host page supplied its own print handler (e.g. a date-range
        // modal), defer to it instead of the generic built-in _print().
        if (typeof this.cfg.onPrintClick === "function")
          this.cfg.onPrintClick();
        else this._print();
      });

    this.root
      .querySelector('[data-role="page-size"]')
      .addEventListener("change", (e) => {
        this.pageSize = Number(e.target.value);
        this.page = 1;
        this._render();
      });

    this.root.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if (this.sortKey === key)
          this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
        else {
          this.sortKey = key;
          this.sortDir = "asc";
        }
        this._apply();
      });
    });

    if (this.cfg.filters?.length) this._buildFilterBar();
    this._renderLoading();
  }

  _thHTML(c) {
    const sortIcon = `<svg class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `<th class="${c.sortable ? "sortable" : ""}" data-key="${c.key}">${c.label}${c.sortable ? sortIcon : ""}</th>`;
  }

  _buildFilterBar() {
    const bar = this.root.querySelector('[data-role="filter-bar"]');
    bar.innerHTML = this.cfg.filters
      .map(
        (f) => `
      <div class="dropdown" data-filter-key="${f.key}">
        <button class="chip" data-dropdown-trigger>${f.label} ${this.activeFilters[f.key] ? `· ${this._filterValueLabel(f, this.activeFilters[f.key])}` : ""}</button>
        <div class="dropdown__menu">
          <button class="dropdown__item" data-filter-value="">All</button>
          <div class="dropdown__divider"></div>
          ${f.options.map((o) => `<button class="dropdown__item" data-filter-value="${o.value}">${o.label}</button>`).join("")}
        </div>
      </div>`,
      )
      .join("");

    bar.querySelectorAll(".dropdown").forEach((dd) => {
      initDropdown(dd);
      const key = dd.dataset.filterKey;
      dd.querySelectorAll("[data-filter-value]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const val = btn.dataset.filterValue;
          if (val) this.activeFilters[key] = val;
          else delete this.activeFilters[key];
          this.page = 1;
          this._buildFilterBar();
          this._apply();
        });
      });
    });
  }

  _filterValueLabel(f, value) {
    return f.options.find((o) => o.value === value)?.label || value;
  }

  setData(rows) {
    this.allRows = rows || [];
    this.loading = false;
    this._apply();
  }

  setLoading(isLoading) {
    this.loading = isLoading;
    if (isLoading) this._renderLoading();
  }

  _renderLoading() {
    this.$tbody.innerHTML = skeletonRows(
      this.pageSize > 8 ? 8 : this.pageSize,
      this.cfg.columns.length,
    );
    this.$info.textContent = "Loading…";
    this.$pagination.innerHTML = "";
  }

  _apply() {
    let rows = [...this.allRows];

    // search
    if (this.search) {
      const fields = this.cfg.searchFields || [];
      rows = rows.filter((r) =>
        fields.some((f) =>
          String(getPath(r, f, ""))
            .toLowerCase()
            .includes(this.search),
        ),
      );
    }

    // filters
    Object.entries(this.activeFilters).forEach(([key, value]) => {
      const filterCfg = this.cfg.filters.find((f) => f.key === key);
      if (filterCfg?.match)
        rows = rows.filter((r) => filterCfg.match(r, value));
    });

    // sort
    if (this.sortKey) {
      const col = this.cfg.columns.find((c) => c.key === this.sortKey);
      rows.sort((a, b) => {
        const av = col?.sortValue
          ? col.sortValue(a)
          : getPath(a, this.sortKey, "");
        const bv = col?.sortValue
          ? col.sortValue(b)
          : getPath(b, this.sortKey, "");
        if (av < bv) return this.sortDir === "asc" ? -1 : 1;
        if (av > bv) return this.sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }

    this.filtered = rows;
    this._render();
  }

  _render() {
    // update sort header classes
    this.root.querySelectorAll("th.sortable").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.key === this.sortKey)
        th.classList.add(this.sortDir === "asc" ? "sorted-asc" : "sorted-desc");
    });

    const total = this.filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
    this.page = Math.min(this.page, totalPages);
    const start = (this.page - 1) * this.pageSize;
    const pageRows = this.filtered.slice(start, start + this.pageSize);

    if (!this.loading && total === 0) {
      this.$tbody.innerHTML = `<tr><td colspan="${this.cfg.columns.length}">${emptyState(
        {
          title: this.cfg.emptyTitle || "No records found",
          desc: this.cfg.emptyDesc || "Try adjusting your search or filters.",
        },
      )}</td></tr>`;
    } else if (!this.loading) {
      this.$tbody.innerHTML = pageRows
        .map(
          (row) =>
            `<tr data-row-id="${row.id || ""}">${this.cfg.columns.map((c) => `<td>${c.render ? c.render(row) : (getPath(row, c.key, "") ?? "")}</td>`).join("")}</tr>`,
        )
        .join("");

      if (this.cfg.onRowClick) {
        this.$tbody.querySelectorAll("tr[data-row-id]").forEach((tr) => {
          tr.style.cursor = "pointer";
          tr.addEventListener("click", (e) => {
            if (e.target.closest("[data-stop-row-click]")) return;
            const row = this.filtered.find(
              (r) => String(r.id) === tr.dataset.rowId,
            );
            if (row) this.cfg.onRowClick(row);
          });
        });
      }
      if (this.cfg.afterRender) this.cfg.afterRender(pageRows, this.$tbody);
    }

    this.$info.textContent =
      total === 0
        ? "0 records"
        : `Showing ${start + 1}–${Math.min(start + this.pageSize, total)} of ${total}`;
    this._renderPagination(totalPages);
  }

  _renderPagination(totalPages) {
    const p = this.page;
    const btn = (label, page, opts = {}) =>
      `<button class="pagination__btn ${opts.active ? "active" : ""}" ${opts.disabled ? "disabled" : ""} data-page="${page}">${label}</button>`;

    let pages = [];
    const windowSize = 1;
    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= p - windowSize && i <= p + windowSize)
      )
        pages.push(i);
      else if (pages[pages.length - 1] !== "…") pages.push("…");
    }

    this.$pagination.innerHTML = `
      ${btn("‹", p - 1, { disabled: p === 1 })}
      ${pages.map((pg) => (pg === "…" ? `<span class="pagination__btn" style="cursor:default;">…</span>` : btn(pg, pg, { active: pg === p }))).join("")}
      ${btn("›", p + 1, { disabled: p === totalPages })}
    `;
    this.$pagination.querySelectorAll("[data-page]").forEach((b) => {
      b.addEventListener("click", () => {
        const pg = Number(b.dataset.page);
        if (pg >= 1 && pg <= totalPages) {
          this.page = pg;
          this._render();
        }
      });
    });
  }

  _exportCSV() {
    const cols = (this.cfg.csvColumns || this.cfg.columns).filter(
      (c) => c.csv !== false,
    );
    const csv = toCSV(
      this.filtered,
      cols.map((c) => ({ label: c.label, value: c.csvValue || c.key })),
    );
    downloadFile(
      `${(this.cfg.title || "export").toLowerCase().replace(/\s+/g, "-")}.csv`,
      csv,
    );
  }

  _print() {
    const cols = (this.cfg.csvColumns || this.cfg.columns).filter(
      (c) => c.csv !== false,
    );
    const rowsHTML = this.filtered
      .map(
        (r) =>
          `<tr>${cols.map((c) => `<td>${(c.csvValue ? c.csvValue(r) : getPath(r, c.key, "")) ?? ""}</td>`).join("")}</tr>`,
      )
      .join("");
    const tableHTML = `<table><thead><tr>${cols.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead><tbody>${rowsHTML}</tbody></table>`;
    printHTML(this.cfg.title || "Report", tableHTML);
  }
}
