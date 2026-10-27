import type { LoadMore } from "../api/useLoadMore";
import { Button } from "./Button";
import styles from "./ShowMore.module.css";
import { ErrorBanner } from "./States";

/** "Show more" under an offset-paginated list, with the error of the last attempt. */
export function ShowMore({ more, list = false }: { more: LoadMore; list?: boolean }) {
  return (
    <>
      {more.loadMoreError && <ErrorBanner>{more.loadMoreError.message}</ErrorBanner>}
      {more.hasMore && (
        <div className={list ? undefined : styles.more}>
          <Button className={list ? styles.loadMore : undefined} disabled={more.loadingMore} onClick={more.loadMore}>
            {list ? "Load more" : "Show more"}
          </Button>
        </div>
      )}
    </>
  );
}
