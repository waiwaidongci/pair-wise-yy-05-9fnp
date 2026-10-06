import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, distinctUntilChanged, filter, map, of, switchMap, tap, withLatestFrom } from 'rxjs';
import { MockTableApiService } from '../data/mock-table-api.service';
import { NetworkService } from '../services/network.service';
import * as TableActions from './table.actions';
import { selectPendingCommits, selectTableState } from './table.selectors';

@Injectable()
export class TableEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);
  private readonly api = inject(MockTableApiService);
  private readonly network = inject(NetworkService);

  loadPage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        TableActions.loadPage,
        TableActions.setPage,
        TableActions.setPageSize,
        TableActions.setSort,
        TableActions.setFilter,
        TableActions.setSearch,
        TableActions.setGroupBy,
        TableActions.toggleTreeMode,
        TableActions.toggleExpanded,
      ),
      withLatestFrom(this.store.select(selectTableState)),
      switchMap(([, state]) =>
        this.api
          .query({
            page: state.page,
            pageSize: state.pageSize,
            sort: state.sort,
            filter: state.filter,
            groupBy: state.groupBy,
            treeMode: state.treeMode,
            expandedIds: state.expandedIds,
            search: state.search,
          })
          .pipe(
            map((result) => TableActions.loadPageSuccess({ result })),
            catchError((error: unknown) =>
              of(TableActions.loadPageFailure({ error: String(error) })),
            ),
          ),
      ),
    ),
  );

  /** 网络状态：回网时按订单号合并补交待同步提交 */
  online$ = createEffect(() =>
    this.network.online$.pipe(
      distinctUntilChanged(),
      tap((online) => this.store.dispatch(TableActions.setOnline({ online }))),
      filter((online) => online),
      withLatestFrom(this.store.select(selectPendingCommits)),
      filter(([, pending]) => pending.length > 0),
      map(() => TableActions.syncCommits()),
    ),
  );

  /**
   * 同步提交：待同步 / 失败的提交已在 reducer 中按订单号归并为单条，
   * 这里直接提交；服务端按提交号幂等处理，重复提交只入库一次。
   */
  syncCommits$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.syncCommits, TableActions.retryCommit),
      withLatestFrom(this.store.select(selectTableState)),
      filter(([, state]) => state.online),
      switchMap(([, state]) => {
        const toSync = state.commits.filter((commit) => commit.status === 'syncing');
        if (!toSync.length) {
          return of(
            TableActions.syncCommitsSuccess({
              results: [],
              syncedAt: new Date().toISOString(),
            }),
          );
        }
        return this.api.commit(toSync).pipe(
          switchMap((results) => {
            const succeeded = results.some((result) => result.status === 'synced');
            return succeeded
              ? [
                  TableActions.syncCommitsSuccess({ results, syncedAt: new Date().toISOString() }),
                  TableActions.loadPage({ refresh: true }),
                ]
              : [TableActions.syncCommitsSuccess({ results, syncedAt: new Date().toISOString() })];
          }),
          catchError((error: unknown) =>
            of(
              TableActions.syncCommitsFailure({
                error: String((error as Error)?.message ?? error),
                failedAt: new Date().toISOString(),
              }),
            ),
          ),
        );
      }),
    ),
  );
}
