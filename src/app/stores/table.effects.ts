import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { from, merge, of } from 'rxjs';
import {
  catchError,
  concatMap,
  debounceTime,
  delay,
  exhaustMap,
  filter,
  map,
  switchMap,
  toArray,
  withLatestFrom,
} from 'rxjs/operators';
import { MockTableApiService } from '../data/mock-table-api.service';
import { OrderChange } from '../types/table.models';
import * as TableActions from './table.actions';
import { selectTableState } from './table.selectors';

@Injectable()
export class TableEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);
  private readonly api = inject(MockTableApiService);

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

  /**
   * 同步触发源：编辑防抖后、回网、手动重试、冲突保留本地、
   * 页面加载后补交离线暂存、上一批结束后补交排队变更、失败延时自动重试
   */
  private readonly syncTriggers$ = merge(
    this.actions$.pipe(ofType(TableActions.updateCell), debounceTime(600)),
    this.actions$.pipe(
      ofType(
        TableActions.retryFailedChanges,
        TableActions.resolveConflict,
        TableActions.flushChanges,
        TableActions.loadPageSuccess,
        TableActions.syncSucceeded,
      ),
    ),
    this.actions$.pipe(
      ofType(TableActions.setOnline),
      filter(({ online }) => online),
    ),
    this.actions$.pipe(ofType(TableActions.syncFailed), delay(3000)),
  );

  /** 收集待同步的变更（含排队中的 syncing，commitId 幂等保证重复提交只入库一次） */
  requestSync$ = createEffect(() =>
    this.syncTriggers$.pipe(
      withLatestFrom(this.store.select(selectTableState)),
      map(([, state]) =>
        state.online
          ? state.changes
              .filter((change) => ['pending', 'failed', 'syncing'].includes(change.status))
              .map((change) => change.commitId)
          : [],
      ),
      filter((commitIds) => commitIds.length > 0),
      map((commitIds) => TableActions.syncStarted({ commitIds })),
    ),
  );

  /** 执行同步：按订单号分组合并补交，同一订单的字段变更作为一批提交 */
  performSync$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.syncStarted),
      withLatestFrom(this.store.select(selectTableState)),
      map(([action, state]) =>
        state.changes.filter((change) => action.commitIds.includes(change.commitId)),
      ),
      filter((batch) => batch.length > 0),
      exhaustMap((batch) => {
        const groups = new Map<string, OrderChange[]>();
        batch.forEach((change) => {
          const group = groups.get(change.orderNo) ?? [];
          group.push(change);
          groups.set(change.orderNo, group);
        });
        return from([...groups.values()]).pipe(
          concatMap((group) => this.api.submitChanges(group)),
          toArray(),
          map((results) => TableActions.syncSucceeded({ results: results.flat() })),
          catchError((error: unknown) =>
            of(
              TableActions.syncFailed({
                commitIds: batch.map((change) => change.commitId),
                error: error instanceof Error ? error.message : String(error),
              }),
            ),
          ),
        );
      }),
    ),
  );

  /** 变更入库后刷新：列表、订单总额与导出都基于服务端数据重算 */
  refreshAfterSync$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.syncSucceeded),
      filter(({ results }) => results.some((result) => result.outcome === 'applied')),
      map(() => TableActions.loadPage({ refresh: true })),
    ),
  );

  /** 冲突处理或撤销变更后刷新回显 */
  refreshAfterResolve$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.resolveConflict, TableActions.discardChange),
      map(() => TableActions.loadPage({ refresh: true })),
    ),
  );
}
