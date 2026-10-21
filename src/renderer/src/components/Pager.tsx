import { PAGE_SIZES } from '../lib/paging';

/**
 * The foot of every list: how many rows a page holds, which page this is, and
 * the way to the next one.
 */
export function Pager({
  page,
  pages,
  total,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  /** Changing the size always returns to the first page. */
  onPageSize: (size: number) => void;
}) {
  // Nothing to page and nothing to choose: a list this short is all of it.
  if (total <= PAGE_SIZES[0]) return null;

  return (
    <div className="pager">
      <label className="pager-size">
        Rows
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <span className="pager-count">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>

      <div className="pager-steps">
        <button
          className="btn-secondary small"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page === 1}
        >
          Previous
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button
          className="btn-secondary small"
          onClick={() => onPage(Math.min(pages, page + 1))}
          disabled={page === pages}
        >
          Next
        </button>
      </div>
    </div>
  );
}
